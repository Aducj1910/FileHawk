import math
import re
from collections import Counter
from typing import Callable, Dict, List, Tuple, Any, Optional
import numpy as np

# Config defaults for Gist file-level re-ranking
GIST_RANKING_CONFIG: Dict[str, Any] = {
    "R": 200,
    "M": 50,
    "k": 5,
    "tau": 0.08,
    "t": 0.30,
    "strong_threshold": 0.5,
    "density_window": 2,
    "q": 1.5,
    "weights": (0.55, 0.20, 0.10, 0.15)
}

def _normalize_confidence(s: float, t: float) -> float:
    if s <= t:
        return 0.0
    denom = max(1e-9, 1.0 - t)
    x = (s - t) / denom
    if x < 0:
        return 0.0
    if x > 1:
        return 1.0
    return x

def _soft_top_k_core(x_values: List[float], k: int, tau: float) -> float:
    if not x_values:
        return 0.0
    top = sorted(x_values, reverse=True)[:k]
    max_val = max(top)
    exps = [math.exp((v - max_val) / max(1e-9, tau)) for v in top]
    denom = sum(exps) or 1.0
    weights = [e / denom for e in exps]
    return sum(w * (v * v) for w, v in zip(weights, top))

def _compute_coverage(x_values: List[float], strong_threshold: float, total_chunks: int) -> float:
    if total_chunks <= 0:
        return 0.0
    hits = sum(1 for v in x_values if v >= strong_threshold)
    denom = math.log2(2.0 + max(0, total_chunks))
    if denom <= 0:
        return 0.0
    return math.sqrt(hits) / denom

def _cluster_indices(indices: List[int], window: int) -> List[List[int]]:
    if not indices:
        return []
    indices_sorted = sorted(indices)
    clusters: List[List[int]] = []
    current: List[int] = [indices_sorted[0]]
    for idx in indices_sorted[1:]:
        if idx - current[-1] <= window:
            current.append(idx)
        else:
            clusters.append(current)
            current = [idx]
    clusters.append(current)
    return clusters

def _compute_density_and_span(hit_indices: List[int], window: int) -> Tuple[float, Tuple[int, int]]:
    if not hit_indices:
        return 1.0, (None, None)
    clusters = _cluster_indices(hit_indices, window)
    lengths = [len(c) for c in clusters]
    avg_cluster_size = sum(lengths) / len(lengths)
    density = 1.0 + 0.10 * avg_cluster_size
    best = None
    for c in clusters:
        span = (c[0], c[-1])
        key = (len(c), -(span[1] - span[0]))
        if best is None or key > best[0]:
            best = (key, span)
    densest_span = best[1] if best else (None, None)
    return density, densest_span

def _compute_noisy_or(x_values: List[float], q: float) -> float:
    prod = 1.0
    for v in x_values:
        prod *= (1.0 - (v ** q))
    return 1.0 - prod

def _length_norm(total_chunks: int) -> float:
    return 1.0 / max(1e-9, math.log2(3.0 + max(0, total_chunks)))

def get_total_chunks_from_metadata(file_path: str, gist_centroids_collection) -> int:
    """Helper function to get total chunks for a file from gist centroids collection"""
    try:
        centroid_results = gist_centroids_collection.get(where={"path": file_path})
        if centroid_results['metadatas'] and len(centroid_results['metadatas']) > 0:
            return centroid_results['metadatas'][0].get('n_chunks', 1)
        return 1
    except Exception:
        return 1

def cosine_similarity(vec1: List[float], vec2: List[float]) -> float:
    """Compute cosine similarity between two vectors"""
    if len(vec1) != len(vec2):
        return 0.0
    
    dot_product = sum(a * b for a, b in zip(vec1, vec2))
    norm_a = math.sqrt(sum(a * a for a in vec1))
    norm_b = math.sqrt(sum(b * b for b in vec2))
    
    if norm_a == 0 or norm_b == 0:
        return 0.0
    
    return dot_product / (norm_a * norm_b)

def tokenize_query(query: str) -> List[str]:
    """Tokenize query for BM25 scoring - extract unigrams and bigrams"""
    words = re.findall(r'\b\w{2,}\b', query.lower())
    unigrams = words
    bigrams = [f"{words[i]}_{words[i+1]}" for i in range(len(words)-1)]
    return unigrams + bigrams

def compute_bm25_lite_score(
    query_terms: List[str], 
    file_top_terms: List[str], 
    file_length: int,
    avg_file_length: float = 100.0,
    k1: float = 1.2,
    b: float = 0.75
) -> float:
    """
    Compute lightweight BM25 score using file's top terms.
    
    Args:
        query_terms: Tokenized query terms
        file_top_terms: Top TF-IDF terms for the file
        file_length: Number of chunks in file (proxy for length)
        avg_file_length: Average file length across corpus
        k1: Term frequency saturation parameter
        b: Length normalization parameter
    
    Returns:
        BM25 score normalized to approximately [0,1]
    """
    if not query_terms or not file_top_terms:
        return 0.0
    
    # Convert file terms to frequency counts (simple approximation)
    file_term_counts = Counter(file_top_terms)
    
    # Length normalization factor
    length_norm = k1 * (1 - b + b * (file_length / avg_file_length))
    
    score = 0.0
    for term in query_terms:
        if term in file_term_counts:
            tf = file_term_counts[term]
            # Simplified IDF (we don't have full corpus statistics)
            idf = 1.0  # Could be enhanced with global term frequencies
            
            # BM25 term score
            term_score = idf * (tf * (k1 + 1)) / (tf + length_norm)
            score += term_score
    
    # Normalize to [0,1] range using log scaling
    return min(1.0, score / (1.0 + math.log(1.0 + len(query_terms))))

def compute_holistic_file_score(
    query_embedding: List[float],
    chunk_similarities: List[float],
    file_centroid: List[float],
    file_top_terms: List[str],
    query_terms: List[str],
    n_chunks: int,
    scoring_weights: Dict[str, float],
    topk_config: Dict[str, Any]
) -> Dict[str, float]:
    """
    Compute holistic file score using multiple signals.
    
    Returns:
        Dictionary with component scores and final score
    """
    
    if not chunk_similarities:
        return {
            "s_max": 0.0,
            "s_topk_mean": 0.0, 
            "s_centroid": 0.0,
            "s_bm25": 0.0,
            "len_norm": 1.0,
            "score_raw": 0.0,
            "score_final": 0.0
        }
    
    # Component 1: Maximum chunk similarity (bullseye chunk)
    s_max = max(chunk_similarities)
    
    # Component 2: Top-k mean similarity
    # m = min(max(1, ceil(0.1 * n_chunks)), 5)
    topk_count = min(
        max(topk_config["min"], math.ceil(topk_config["ratio"] * n_chunks)),
        topk_config["max"]
    )
    
    sorted_similarities = sorted(chunk_similarities, reverse=True)
    s_topk_mean = sum(sorted_similarities[:topk_count]) / topk_count
    
    # Component 3: File centroid similarity
    s_centroid = cosine_similarity(query_embedding, file_centroid)
    
    # Component 4: BM25-lite score
    s_bm25 = compute_bm25_lite_score(query_terms, file_top_terms, n_chunks)
    
    # Length normalization to avoid long-file bias
    len_norm = 1.0 / math.sqrt(1.0 + math.log(1.0 + n_chunks))
    
    # Combine components
    score_raw = (
        scoring_weights["s_max"] * s_max +
        scoring_weights["s_topk_mean"] * s_topk_mean +
        scoring_weights["s_centroid"] * s_centroid +
        scoring_weights["s_bm25"] * s_bm25
    )
    
    # Apply length normalization
    score_final = score_raw * len_norm
    
    # Clamp to [0,1]
    score_final = max(0.0, min(1.0, score_final))
    
    return {
        "s_max": s_max,
        "s_topk_mean": s_topk_mean,
        "s_centroid": s_centroid,
        "s_bm25": s_bm25,
        "len_norm": len_norm,
        "score_raw": score_raw,
        "score_final": score_final,
        "best_chunk_idx": chunk_similarities.index(s_max) if chunk_similarities else 0
    }

def scoreGistFiles(hits: List[Dict[str, Any]], getTotalChunksForFile: Callable[[str], int], config: Dict[str, Any] = GIST_RANKING_CONFIG, max_chunk_display_length: int = 500) -> List[Dict[str, Any]]:
    if not hits:
        return []

    R = config.get("R", 200)
    M = config.get("M", 50)
    k = config.get("k", 5)
    tau = config.get("tau", 0.08)
    t = config.get("t", 0.30)
    strong_threshold = config.get("strong_threshold", 0.5)
    density_window = config.get("density_window", 2)
    q = config.get("q", 1.5)
    w1, w2, w3, w4 = config.get("weights", (0.55, 0.20, 0.10, 0.15))

    top_hits = sorted(hits, key=lambda h: h.get("confidence", 0.0), reverse=True)[:R]

    files: Dict[str, List[Dict[str, Any]]] = {}
    file_meta: Dict[str, Tuple[str, str]] = {}
    for h in top_hits:
        fpath = h["file_path"]
        files.setdefault(fpath, []).append(h)
        if fpath not in file_meta:
            file_meta[fpath] = (h.get("file_name", ""), h.get("file_type", ""))

    scored_files: List[Dict[str, Any]] = []

    for fpath, fhits in files.items():
        fhits_sorted = sorted(fhits, key=lambda h: h.get("confidence", 0.0), reverse=True)[:M]
        total_chunks = max(1, int(getTotalChunksForFile(fpath) or 1))

        xs = [_normalize_confidence(h.get("confidence", 0.0), t) for h in fhits_sorted]
        indices = [int(h.get("chunk_index", 0)) for h in fhits_sorted]

        core = _soft_top_k_core(xs, k, tau)
        coverage = _compute_coverage(xs, strong_threshold, total_chunks)
        hit_indices = [idx for idx, v in zip(indices, xs) if v > 0]
        density, densest_span = _compute_density_and_span(hit_indices, density_window)
        noisy_or = _compute_noisy_or(xs, q)
        len_norm = _length_norm(total_chunks)
        final_score = len_norm * (w1 * core + w2 * coverage + w3 * density + w4 * noisy_or)
        best_x = max(xs) if xs else 0.0
        best_idx = None
        if xs:
            max_pos = max(range(len(xs)), key=lambda ii: xs[ii])
            best_idx = indices[max_pos] if 0 <= max_pos < len(indices) else None

        candidates = list(zip(xs, indices, [h.get("content", "") for h in fhits_sorted]))
        candidates.sort(key=lambda c: c[0], reverse=True)
        mmr_lambda = 0.7
        max_snippets = 3
        def _sim_idx(a: int, b: int) -> float:
            return math.exp(-0.5 * abs(a - b))
        mmr_candidates: List[Tuple[float, int, str, float]] = []
        for xval, idx, content in candidates:
            red = 0.0
            if mmr_candidates:
                red = max((_sim_idx(idx, existing_idx) for _, existing_idx, _, _ in mmr_candidates), default=0.0)
            mmr_score = mmr_lambda * xval - (1 - mmr_lambda) * red
            mmr_candidates.append((xval, idx, content, mmr_score))
        mmr_candidates.sort(key=lambda t4: t4[3], reverse=True)
        reps_raw = [c[2] for c in mmr_candidates[:max_snippets]]
        reps = []
        for s in reps_raw:
            s2 = s[:max_chunk_display_length] + ("..." if len(s) > max_chunk_display_length else "")
            reps.append(s2)

        file_name, file_type = file_meta.get(fpath, ("", ""))
        evidence = {
            "best_chunk_score": best_x,
            "best_chunk_index": best_idx,
            "hits": sum(1 for v in xs if v >= strong_threshold),
            "densest_span": [densest_span[0], densest_span[1]],
            "snippets": reps
        }

        matches = []
        for h in fhits_sorted[:10]:
            display_chunk = h.get("content", "")
            if len(display_chunk) > max_chunk_display_length:
                display_chunk = display_chunk[:max_chunk_display_length] + "..."
            matches.append({
                "type": "chunk",
                "chunk_id": h.get("chunk_index"),
                "chunk_size": h.get("chunk_size", 0),
                "content": display_chunk.strip(),
                "confidence": h.get("confidence", 0.0)
            })

        scored_files.append({
            "file_path": fpath,
            "file_name": file_name,
            "file_type": file_type,
            "final_score": final_score,
            "best_x": best_x,
            "evidence": evidence,
            "matches": matches
        })

    scored_files.sort(key=lambda f: (f.get("final_score", 0.0), f.get("best_x", 0.0)), reverse=True)
    return scored_files


