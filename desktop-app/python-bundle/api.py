"""
FileFinder API Server

Flask-based HTTP API server that wraps the FileFinder functionality
for use with the Electron desktop application.
"""

import os
import sys
import json
import threading
import time
from flask import Flask, request, jsonify
from flask_cors import CORS
import chromadb
from sentence_transformers import SentenceTransformer

# Configure console encoding for Windows compatibility
if sys.platform == "win32":
    try:
        # Try to set UTF-8 encoding for Windows console
        import locale
        os.environ['PYTHONIOENCODING'] = 'utf-8'
        # Reconfigure stdout/stderr to handle Unicode properly
        import io
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception as e:
        print(f"Warning: Could not configure console encoding: {e}")
        # Continue without Unicode support

# Import the existing FileFinder modules
try:
    from config import *
    from metadata_tracker import MetadataTracker
    from sync_tracker import SyncTracker
    from realtime_monitor import RealtimeMonitor
    from main import (
        extract_text, create_large_chunks, create_gist_chunks, create_pinpoint_chunks,
        granular_collection, filelevel_collection,
        model_loading_status
    )
except ImportError as e:
    print(f"Error importing FileFinder modules: {e}")
    sys.exit(1)

app = Flask(__name__)
CORS(app)  # Enable CORS for Electron app

# Global state
indexing_status = {
    "is_indexing": False,
    "progress": 0,
    "total_files": 0,
    "current_file": "",
    "message": "Ready",
    "chunking_mode": None
}

# Initialize metadata tracker and real-time sync system
metadata_tracker = MetadataTracker(APP_NAME)
sync_tracker = SyncTracker(metadata_tracker)
realtime_monitor = RealtimeMonitor(sync_tracker)

def initialize_collections():
    """Initialize ChromaDB collections for different chunking modes"""
    try:
        db_dir = metadata_tracker.get_db_directory()
        print(f"Initializing ChromaDB with persistent storage at: {db_dir}")
        
        # Use PersistentClient for ChromaDB 1.0+
        client = chromadb.PersistentClient(path=str(db_dir))
        
        # Create separate collections for each chunking mode
        gist_collection = client.get_or_create_collection("filefinder_gist")
        gist_centroids_collection = client.get_or_create_collection("filefinder_gist_centroids")
        pinpoint_collection = client.get_or_create_collection("filefinder_pinpoint")
        
        if ENABLE_GRANULAR_CHUNKING:
            granular_col = client.get_or_create_collection("filefinder_granular")
            filelevel_col = client.get_or_create_collection("filefinder_filelevel")
            
            # Store client reference
            initialize_collections.client = client
            return granular_col, filelevel_col, gist_collection, gist_centroids_collection, pinpoint_collection
        else:
            filelevel_col = client.get_or_create_collection("filefinder_filelevel")
            
            # Store client reference
            initialize_collections.client = client
            return None, filelevel_col, gist_collection, gist_centroids_collection, pinpoint_collection
    except Exception as e:
        print(f"Error initializing collections: {e}")
        return None, None, None, None, None

# Initialize the models and collections
print("Initializing FileFinder API...")
print("Loading MSMarco model for gist mode...")
gist_model = SentenceTransformer(GIST_EMBEDDING_MODEL)
print("Loading AllMiniLM model for pinpoint mode...")
pinpoint_model = SentenceTransformer(PINPOINT_EMBEDDING_MODEL)
print("Both models loaded successfully!")

# Optional: warm up models to reduce first-query latency
try:
    _ = gist_model.encode("warmup")
    _ = pinpoint_model.encode("warmup")
    print("Models warmed up successfully")
except Exception as _warmup_err:
    print(f"Model warmup skipped due to error: {_warmup_err}")

granular_collection, filelevel_collection, gist_collection, gist_centroids_collection, pinpoint_collection = initialize_collections()

def get_model_for_mode(chunking_mode):
    """Get the appropriate model for the given chunking mode"""
    if chunking_mode == 'gist':
        return gist_model
    elif chunking_mode == 'pinpoint':
        return pinpoint_model

# suggestions endpoint removed
    else:
        # Fallback to pinpoint model for legacy modes
        return pinpoint_model

# ------------------------------
# Helper: filtering utilities
# ------------------------------
from datetime import datetime, timedelta

def _parse_date_to_ts(date_str: str, end_of_day: bool = False) -> float:
    """Parse YYYY-MM-DD into epoch seconds. If end_of_day, set time to 23:59:59."""
    try:
        dt = datetime.strptime(date_str, "%Y-%m-%d")
        if end_of_day:
            dt = dt + timedelta(hours=23, minutes=59, seconds=59)
        return dt.timestamp()
    except Exception:
        return 0.0

def _is_under_folder(file_path: str, folder_path: str) -> bool:
    try:
        file_abs = os.path.abspath(file_path)
        folder_abs = os.path.abspath(folder_path)
        common = os.path.commonpath([file_abs, folder_abs])
        return common == folder_abs
    except Exception:
        return False

def file_matches_filters(file_path: str, file_type: str, filters: dict) -> bool:
    """
    Apply server-side filters to a file path using available metadata.
    - fileTypes: list like ['py','md'] (compare against extension without dot)
    - searchFolder: string path; require file under this folder
    - timeRange: { type: 'all'|'before'|'after'|'range', before/after/startDate/endDate: 'YYYY-MM-DD' }
    Uses MetadataTracker for last_modified; falls back to os.stat if needed.
    """
    if not filters or not isinstance(filters, dict):
        return True

    # File types filter
    try:
        wanted_types = filters.get('fileTypes') or []
        if isinstance(wanted_types, list) and len(wanted_types) > 0:
            ext_no_dot = (file_type or '').lower().lstrip('.')
            wanted_norm = [str(t).lower().lstrip('.') for t in wanted_types]
            if ext_no_dot not in wanted_norm:
                return False
    except Exception:
        pass

    # Folder scoping
    try:
        search_folder = filters.get('searchFolder') or None
        if isinstance(search_folder, str) and search_folder.strip():
            if not _is_under_folder(file_path, search_folder):
                return False
    except Exception:
        pass

    # Time range filtering
    try:
        time_range = filters.get('timeRange') or {}
        tr_type = time_range.get('type', 'all')
        if tr_type != 'all':
            # obtain last_modified from metadata tracker, fallback to os.stat
            last_mod = 0.0
            try:
                meta = metadata_tracker.metadata.get(file_path, {})
                last_mod = float(meta.get('last_modified', 0.0))
                if not last_mod and os.path.exists(file_path):
                    last_mod = os.stat(file_path).st_mtime
            except Exception:
                if os.path.exists(file_path):
                    try:
                        last_mod = os.stat(file_path).st_mtime
                    except Exception:
                        last_mod = 0.0

            if tr_type == 'before':
                before_str = time_range.get('before')
                if before_str:
                    before_ts = _parse_date_to_ts(before_str, end_of_day=True)
                    if last_mod > before_ts:
                        return False
            elif tr_type == 'after':
                after_str = time_range.get('after')
                if after_str:
                    after_ts = _parse_date_to_ts(after_str, end_of_day=False)
                    if last_mod < after_ts:
                        return False
            elif tr_type == 'range':
                start_str = time_range.get('startDate')
                end_str = time_range.get('endDate')
                if start_str:
                    start_ts = _parse_date_to_ts(start_str, end_of_day=False)
                    if last_mod < start_ts:
                        return False
                if end_str:
                    end_ts = _parse_date_to_ts(end_str, end_of_day=True)
                    if last_mod > end_ts:
                        return False
    except Exception:
        pass

    return True

@app.route('/api/status', methods=['GET'])
def get_status():
    """Get current indexing status"""
    return jsonify(indexing_status)

@app.route('/api/health', methods=['GET'])
def health_check():
    """Basic health endpoint with model and DB info"""
    try:
        db_dir = str(metadata_tracker.get_db_directory())
        return jsonify({
            "ok": True,
            "models": {
                "gist": GIST_EMBEDDING_MODEL,
                "pinpoint": PINPOINT_EMBEDDING_MODEL
            },
            "db_directory": db_dir
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.route('/api/model-status', methods=['GET'])
def get_model_status():
    """Get current model loading status"""
    return jsonify(model_loading_status)

@app.route('/api/index', methods=['POST'])
def index_folders():
    """Index selected folders"""
    global indexing_status
    
    if indexing_status["is_indexing"]:
        return jsonify({"error": "Indexing already in progress"}), 400
    
    data = request.get_json()
    folders = data.get('folders', [])
    chunking_mode = data.get('chunking_mode', 'gist') # Default to 'gist'
    
    if not folders:
        return jsonify({"error": "No folders provided"}), 400
    
    # Start indexing in background thread
    thread = threading.Thread(target=index_folders_background, args=(folders, chunking_mode))
    thread.daemon = True
    thread.start()
    
    return jsonify({"message": "Indexing started", "folders": folders, "chunking_mode": chunking_mode})

def index_folders_background(folders, chunking_mode='gist'):
    """Background indexing function"""
    global indexing_status, granular_collection, filelevel_collection, gist_collection, gist_centroids_collection, pinpoint_collection
    
    indexing_status.update({
        "is_indexing": True,
        "progress": 0,
        "total_files": 0,
        "current_file": "",
        "message": f"Scanning folders for {chunking_mode} mode...",
        "chunking_mode": chunking_mode
    })
    
    try:
        # First, scan all folders for files
        all_files = []
        for folder in folders:
            if os.path.exists(folder):
                for root, dirs, files in os.walk(folder):
                    for fname in files:
                        all_files.append((root, fname))
        
        indexing_status.update({
            "total_files": len(all_files),
            "message": f"Found {len(all_files)} files to index in {chunking_mode} mode"
        })
        
        # Get file paths for metadata checking
        file_paths = [os.path.join(root, fname) for root, fname in all_files]
        
        # Check which files need indexing vs can be skipped
        files_to_index, files_to_skip = metadata_tracker.get_files_to_index(file_paths, chunking_mode)
        
        if files_to_skip:
            indexing_status.update({
                "message": f"+ {len(files_to_skip)} files unchanged, skipping re-indexing"
            })
        
        if not files_to_index:
            indexing_status.update({
                "is_indexing": False,
                "progress": 100,
                "current_file": "",
                "message": f"All files are up to date in {chunking_mode} mode!",
                "chunking_mode": chunking_mode
            })
            return
        
        indexing_status.update({
            "message": f"Processing {len(files_to_index)} files that need indexing in {chunking_mode} mode..."
        })
        
        files_indexed = 0
        chunks_created = 0
        skipped_files = len(files_to_skip)
        
        # Select the appropriate collection and chunking function based on mode
        if chunking_mode == 'gist':
            target_collection = gist_collection
            chunking_function = create_gist_chunks
            mode_description = "gist (large chunks)"
        elif chunking_mode == 'pinpoint':
            target_collection = pinpoint_collection
            chunking_function = create_pinpoint_chunks
            mode_description = "pinpoint (small chunks)"
        else:
            # Fallback to legacy mode
            target_collection = filelevel_collection
            chunking_function = create_large_chunks
            mode_description = "legacy (mixed chunks)"
        
        # Process only files that need indexing
        for file_idx, (root, fname) in enumerate(all_files):
            fpath = os.path.join(root, fname)
            
            # Skip if file doesn't need indexing
            if fpath not in files_to_index:
                continue
                
            file_ext = os.path.splitext(fname)[1].lower()
            
            # Update progress
            indexing_status.update({
                "progress": (file_idx / len(all_files)) * 100,
                "current_file": fname,
                "message": f"Indexing {fname} in {mode_description} mode..."
            })
            
            # Skip hidden/system files if configured
            if SKIP_HIDDEN_FILES and fname.startswith('.'):
                skipped_files += 1
                continue
            if SKIP_SYSTEM_FILES and fname.startswith('~'):
                skipped_files += 1
                continue
            
            # Check file size if limit is set
            if MAX_FILE_SIZE_MB > 0:
                try:
                    file_size_mb = os.path.getsize(fpath) / (1024 * 1024)
                    if file_size_mb > MAX_FILE_SIZE_MB:
                        skipped_files += 1
                        continue
                except OSError:
                    continue
            
            content = extract_text(fpath)
            if not content.strip() or len(content.strip()) < MIN_CONTENT_LENGTH:
                skipped_files += 1
                continue
            
            # Create chunks using the selected chunking function
            chunks = chunking_function(content, file_ext)
            if not chunks:
                skipped_files += 1
                continue
            
            # Index chunks in the target collection
            # Select appropriate model for the chunking mode
            current_model = get_model_for_mode(chunking_mode)
            
            for chunk_idx, (chunk_text, line_ranges) in enumerate(chunks):
                embedding = current_model.encode(chunk_text)
                
                unique_id = f"{chunking_mode}-{fpath}-{chunk_idx+1}"
                print(f"DEBUG: Adding chunk with path: {fpath}")  # Debug path format
                target_collection.add(
                    embeddings=[embedding],
                    documents=[chunk_text],
                    metadatas=[{
                        "path": fpath, 
                        "fname": fname, 
                        "file_type": file_ext,
                        "chunk_id": chunk_idx + 1,
                        "chunk_index": chunk_idx + 1,  # For compatibility with gist_ranking
                        "line_ranges": str(line_ranges),
                        "chunk_size": len(line_ranges),
                        "chunking_mode": chunking_mode
                    }],
                    ids=[unique_id]
                )
                chunks_created += 1
            
            # Skip gist-mode centroid/metadata computation to keep gist indexing simple
            
            # Update metadata for this file
            chunk_sizes = [len(line_ranges) for _, line_ranges in chunks]
            metadata_tracker.update_file_metadata(fpath, chunking_mode, len(chunks), chunk_sizes)
            
            files_indexed += 1
        
        # Note: ChromaDB 1.0+ automatically persists data when using persist_directory
        print("+ ChromaDB data will be automatically persisted")
        
        # Update final status
        indexing_status.update({
            "is_indexing": False,
            "progress": 100,
            "current_file": "",
            "message": f"Indexing complete! {files_indexed} files indexed in {chunking_mode} mode, {chunks_created} chunks created",
            "chunking_mode": chunking_mode
        })
        
        # Log telemetry for gist mode
        if chunking_mode == 'gist':
            try:
                gist_centroids_count = gist_centroids_collection.count()
                print(f"TELEMETRY: Gist mode indexing completed")
                print(f"  - Files indexed: {files_indexed}")
                print(f"  - Chunks created: {chunks_created}")
                print(f"  - File centroids: {gist_centroids_count}")
                print(f"  - Model: {GIST_EMBEDDING_MODEL}")
                print(f"  - Chunk size: {GIST_CHUNK_SIZE} (overlap: {GIST_CHUNK_OVERLAP})")
                print(f"  - Deduplication: {GIST_ENABLE_DEDUPLICATION}")
            except Exception as e:
                print(f"TELEMETRY: Error logging gist stats: {e}")
        
        # Add newly indexed folders to real-time monitoring
        for folder in folders:
            if os.path.exists(folder):
                realtime_monitor.add_folder(folder, chunking_mode)
        
    except Exception as e:
        indexing_status.update({
            "is_indexing": False,
            "message": f"Error during indexing: {str(e)}",
            "chunking_mode": chunking_mode
        })

def compute_enhanced_pinpoint_confidence(query: str, chunk_content: str, file_path: str, raw_distance: float) -> float:
    """
    Pinpoint-specific confidence calculation optimized for exact phrase matching
    and line-level precision. Adapts the gist approach for smaller chunks.
    """
    import re
    import os
    
    # Step 1: PINPOINT-OPTIMIZED BASE SCORE
    # AllMiniLM distances typically range differently than MSMarco
    # More aggressive scoring for exact matches due to smaller chunks
    if raw_distance <= 0.3:  # Tighter threshold for pinpoint
        base_semantic = 1.0 - (raw_distance / 0.3) * 0.1  # 0.9-1.0 range
    elif raw_distance <= 0.6:
        base_semantic = 0.9 - ((raw_distance - 0.3) / 0.3) * 0.2  # 0.7-0.9 range
    elif raw_distance <= 1.0:
        base_semantic = 0.7 - ((raw_distance - 0.6) / 0.4) * 0.3  # 0.4-0.7 range
    elif raw_distance <= 1.4:
        base_semantic = 0.4 - ((raw_distance - 1.0) / 0.4) * 0.25  # 0.15-0.4 range
    else:
        base_semantic = max(0.0, 0.15 - ((raw_distance - 1.4) / 1.0) * 0.15)  # 0-0.15 range
    
    # Step 2: EXACT PHRASE MATCHING BOOST (crucial for pinpoint)
    query_lower = query.lower()
    content_lower = chunk_content.lower()
    
    exact_boost = 1.0
    if query_lower in content_lower:
        # Stronger boost for exact phrase matches in small chunks
        exact_boost = 1.5  # 50% boost for exact phrase presence
    else:
        # Check for partial word matches
        query_words = re.findall(r'\b\w+\b', query_lower)
        content_words = set(re.findall(r'\b\w+\b', content_lower))
        matches = sum(1 for word in query_words if word in content_words)
        if matches > 0:
            exact_boost = 1.0 + (matches / len(query_words)) * 0.3  # Up to 30% boost
    
    # Step 3: FILENAME RELEVANCE (adapted from gist)
    filename_boost = 1.0
    filename_lower = os.path.basename(file_path).lower()
    if query_lower in filename_lower:
        filename_boost = 1.4  # Significant boost for filename matches
    
    # Step 4: POSITION-BASED SCORING (unique to pinpoint)
    # Prefer matches at the beginning of chunks (more likely to be important)
    position_boost = 1.0
    if query_lower in content_lower:
        position = content_lower.find(query_lower)
        relative_position = position / len(content_lower)
        if relative_position < 0.2:  # In first 20% of chunk
            position_boost = 1.15
    
    # Step 5: CHUNK SIZE NORMALIZATION
    # Smaller chunks should get slight preference for exact matches
    chunk_length = len(chunk_content)
    size_multiplier = 1.0
    if chunk_length < 100 and exact_boost > 1.2:  # Small chunk with exact match
        size_multiplier = 1.1
    
    # Combine all factors
    final_confidence = base_semantic * exact_boost * filename_boost * position_boost * size_multiplier
    
    return max(0.0, min(1.0, final_confidence))

def aggregate_pinpoint_chunks_for_file(chunks_with_confidence, query: str) -> float:
    """
    Aggregate multiple pinpoint chunks for a file into a single confidence score.
    Optimized for pinpoint's small chunk characteristics.
    """
    if not chunks_with_confidence:
        return 0.0
    
    # Sort by confidence
    sorted_chunks = sorted(chunks_with_confidence, key=lambda x: x['confidence'], reverse=True)
    
    # Primary score from best chunk
    primary_score = sorted_chunks[0]['confidence']
    
    # Secondary score from coverage
    coverage_bonus = 0.0
    if len(sorted_chunks) > 1:
        # For pinpoint, multiple good chunks indicate strong file relevance
        high_confidence_chunks = [c for c in sorted_chunks if c['confidence'] > 0.6]
        if len(high_confidence_chunks) > 1:
            # More conservative boost than gist (since chunks are smaller)
            coverage_bonus = min(0.15, len(high_confidence_chunks) * 0.05)
    
    # Exact match distribution bonus
    exact_match_bonus = 0.0
    query_lower = query.lower()
    exact_matches = sum(1 for c in sorted_chunks if query_lower in c['content'].lower())
    if exact_matches > 1:
        exact_match_bonus = min(0.1, exact_matches * 0.03)
    
    final_score = primary_score + coverage_bonus + exact_match_bonus
    return max(0.0, min(1.0, final_score))

def rank_pinpoint_files(file_results, query: str):
    """
    Ranking system optimized for pinpoint mode characteristics.
    """
    import os
    
    # Add file-level metrics
    for file_result in file_results:
        chunks = file_result.get('matches', [])
        
        # Calculate file-level confidence
        file_result['aggregated_confidence'] = aggregate_pinpoint_chunks_for_file(chunks, query)
        
        # Add exact match indicators
        query_lower = query.lower()
        file_result['exact_matches'] = sum(
            1 for chunk in chunks if query_lower in chunk['content'].lower()
        )
        
        # Add filename relevance
        filename_lower = os.path.basename(file_result['file_path']).lower()
        file_result['filename_relevance'] = 1.0 if query_lower in filename_lower else 0.0
    
    # Sort by composite score: aggregated confidence + exact matches + filename relevance
    def sort_key(file_result):
        return (
            file_result['aggregated_confidence'],
            file_result['exact_matches'],
            file_result['filename_relevance'],
            file_result['confidence']  # Original confidence as tiebreaker
        )
    
    return sorted(file_results, key=sort_key, reverse=True)

def compute_enhanced_gist_confidence(query: str, chunk_content: str, file_path: str, raw_distance: float) -> float:
    """
    Semantically intelligent confidence calculation that prioritizes semantic understanding
    while appropriately boosting exact matches. Handles query variations like barbarian vs barbarians.
    """
    import re
    
    # Step 1: PRECISION-FOCUSED BASE SCORE (production-grade discrimination)
    # ChromaDB cosine distances: 0 = identical, ~2+ = very different
    # More conservative scoring to prevent over-scoring and improve discrimination
    if raw_distance <= 0.4:
        base_semantic = 1.0 - (raw_distance / 0.4) * 0.15  # 0.85-1.0 range (truly excellent matches only)
    elif raw_distance <= 0.8:
        base_semantic = 0.85 - ((raw_distance - 0.4) / 0.4) * 0.25  # 0.6-0.85 range (good matches)
    elif raw_distance <= 1.2:
        base_semantic = 0.6 - ((raw_distance - 0.8) / 0.4) * 0.25  # 0.35-0.6 range (moderate matches)
    elif raw_distance <= 1.6:
        base_semantic = 0.35 - ((raw_distance - 1.2) / 0.4) * 0.2  # 0.15-0.35 range (weak matches)
    elif raw_distance <= 2.0:
        base_semantic = 0.15 - ((raw_distance - 1.6) / 0.4) * 0.1  # 0.05-0.15 range (very weak)
    else:
        base_semantic = max(0.0, 0.05 - ((raw_distance - 2.0) / 1.0) * 0.05)  # 0-0.05 range (irrelevant)
    
    # Step 2: SMART QUERY PROCESSING (handle variations like barbarian/barbarians)
    def normalize_word(word):
        """Normalize words to handle plural/singular variations"""
        word = word.lower().strip()
        # Handle common plural patterns
        if word.endswith('ies') and len(word) > 4:
            return word[:-3] + 'y'  # stories -> story
        elif word.endswith('s') and len(word) > 3 and not word.endswith('ss'):
            return word[:-1]  # barbarians -> barbarian, soldiers -> soldier
        return word
    
    # Extract and normalize query words
    stop_words = {'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who', 'boy', 'did', 'she', 'use', 'way', 'will', 'about', 'file', 'files', 'document', 'text'}
    
    query_words_raw = [word for word in re.split(r'[^\w]+', query) if word.strip()]
    query_words_filtered = [word.lower() for word in query_words_raw if len(word) >= 2 and word.lower() not in stop_words]
    query_words_normalized = [normalize_word(word) for word in query_words_filtered]
    
    # CRITICAL: Adjust base semantic score if query had many stop words
    # This compensates for the fact that ChromaDB embedding includes stop words
    stop_word_ratio = len([w for w in query_words_raw if w.lower() in stop_words]) / max(1, len(query_words_raw))
    if stop_word_ratio > 0.4:  # Query like "file about barbarian" has 66% stop words
        # Boost base semantic to compensate for stop word dilution
        semantic_compensation = 1.0 + (stop_word_ratio * 0.6)  # Up to 60% boost
        base_semantic = min(1.0, base_semantic * semantic_compensation)
    
    # SEMANTIC EQUIVALENCE BOOST: Reduce gaps between singular/plural and related terms
    # Check if this appears to be a high-quality semantic match that might need boosting
    content_lower = chunk_content.lower()
    has_direct_word_match = any(
        re.search(r'\b' + re.escape(word) + r'\b', content_lower) 
        for word in query_words_normalized
    )
    
    # ENHANCED SEMANTIC EQUIVALENCE: Boost relevant content more aggressively
    if has_direct_word_match and base_semantic > 0.5:
        # Strong boost for high semantic + word match combination
        base_semantic = min(1.0, base_semantic * 1.25)  # 25% boost for semantic+word consistency
    elif has_direct_word_match and base_semantic > 0.3:
        # Moderate boost for decent semantic + word match
        base_semantic = min(1.0, base_semantic * 1.15)  # 15% boost for moderate semantic+word
    elif has_direct_word_match and base_semantic > 0.15:
        # Small boost even for weak semantic if there's exact word match
        base_semantic = min(1.0, base_semantic * 1.08)  # 8% boost for weak semantic+word
    
    # Additional boost for files that are clearly relevant but might have lower base scores
    # This helps with the comprehensive dataset where distances are more spread out
    if base_semantic > 0.4:
        base_semantic = min(1.0, base_semantic * 1.1)   # 10% general boost for good matches
    
    if not query_words_normalized:
        return base_semantic
    
    # Step 3: INTELLIGENT FILENAME SIMILARITY (exact + semantic)
    filename = os.path.basename(file_path).lower()
    filename_without_ext = os.path.splitext(filename)[0].replace('_', ' ')
    filename_normalized = normalize_word(filename_without_ext)
    
    filename_boost = 1.0
    
    # A) Exact normalized matches (barbarian matches barbarians_2.txt)
    exact_filename_matches = 0
    for query_word in query_words_normalized:
        if query_word in filename_normalized or filename_normalized in query_word:
            exact_filename_matches += 1
    
    # B) Semantic filename similarity (soldiers -> warriors.txt)
    semantic_filename_boost = 0.0
    try:
        # Get the global model from the search function context
        # For now, we'll use a simpler approach based on word relationships
        # AI-MODEL-DRIVEN semantic relationships - let the model decide!
        # Use the embedding model to determine semantic relationships between query and filename
        if 'gist_model' in globals():
            model = gist_model
        else:
            # Fallback: load model if not available
            from sentence_transformers import SentenceTransformer, util
            model = SentenceTransformer("sentence-transformers/msmarco-MiniLM-L6-cos-v5")
        
        # Compare query words to filename words using AI embeddings
        filename_words = re.findall(r'\b\w+\b', filename_normalized)
        
        for query_word in query_words_normalized:
            if len(query_word) < 3:  # Skip very short words
                continue
                
            query_embedding = model.encode([query_word])
            
            for filename_word in filename_words:
                if len(filename_word) < 3:  # Skip very short words
                    continue
                    
                filename_embedding = model.encode([filename_word])
                
                # Calculate semantic similarity using the AI model
                similarity = util.cos_sim(query_embedding, filename_embedding).item()
                
                # If AI model finds high semantic similarity (>0.7), apply boost
                if similarity > 0.7:
                    semantic_filename_boost += similarity * 0.2  # Boost based on AI confidence
                    break  # One boost per query word

    except Exception as e:
        pass  # Fall back to exact matching only
    
    # Combine exact and semantic filename boosts
    total_filename_boost = exact_filename_matches * 0.4 + semantic_filename_boost
    
    if total_filename_boost > 0:
        # Apply filename boost, but only if semantic baseline exists
        if base_semantic > 0.3:
            filename_boost = 1.0 + total_filename_boost  # Full boost for good semantic match
        elif base_semantic > 0.1:
            filename_boost = 1.0 + (total_filename_boost * 0.5)  # Reduced boost for weak semantic
        else:
            filename_boost = 1.0 + (total_filename_boost * 0.2)  # Minimal boost for very weak semantic
    
    # Step 4: CONTENT WORD MATCHING (with normalization)
    content_lower = chunk_content.lower()
    content_boost = 1.0
    
    # Check for normalized word matches in content (more sophisticated matching)
    content_matches = 0
    for query_word in query_words_normalized:
        # Check both exact and plural/singular variations
        variations = [query_word]
        
        # Add plural/singular variations
        if query_word.endswith('s') and len(query_word) > 3:
            variations.append(query_word[:-1])  # barbarians -> barbarian
        else:
            variations.append(query_word + 's')  # barbarian -> barbarians
            
        if query_word.endswith('y'):
            variations.append(query_word[:-1] + 'ies')  # story -> stories
        
        # Check for any variation match
        found_match = False
        for variation in variations:
            if re.search(r'\b' + re.escape(variation) + r'\b', content_lower):
                content_matches += 1
                found_match = True
                break
        
        # If no exact match, check for root word matches (more semantic flexibility)
        if not found_match and len(query_word) >= 4:
            root_word = query_word[:4]  # Check first 4 letters
            if re.search(r'\b' + re.escape(root_word) + r'\w*', content_lower):
                content_matches += 0.5  # Half credit for root matches
    
    if content_matches > 0:
        # More generous content boost for high-quality matches
        if content_matches >= 1.5:  # Strong matches (exact + root)
            content_boost = 1.0 + (content_matches * 0.3)  # 30% boost per concept
        else:
            content_boost = 1.0 + (content_matches * 0.25)  # 25% boost per concept
    
    # Step 5: ENHANCED SEMANTIC COHERENCE (more generous for relevant content)
    coherence_multiplier = 1.0
    total_matches = exact_filename_matches + content_matches
    
    if base_semantic > 0.5 and total_matches > 0:
        coherence_multiplier = 1.3  # 30% bonus for good semantic + exact matches
    elif base_semantic > 0.3 and total_matches > 0:
        coherence_multiplier = 1.2  # 20% bonus for moderate semantic + exact matches
    elif base_semantic > 0.2 and total_matches > 1:
        coherence_multiplier = 1.15 # 15% bonus for weak semantic + multiple matches
    elif base_semantic > 0.4:
        coherence_multiplier = 1.1  # 10% bonus for good semantic even without exact matches
    elif base_semantic < 0.1 and total_matches == 0:
        coherence_multiplier = 0.2  # Heavy penalty for poor semantic + no matches
    
    # Step 6: COMBINE FACTORS (semantic-first approach)
    final_confidence = base_semantic * filename_boost * content_boost * coherence_multiplier
    
    # Ensure confidence stays in [0, 1] range
    return max(0.0, min(1.0, final_confidence))

def search_gist_mode(query: str, query_embedding, model, top_files: int, page: int = 1, page_size: int = 10, filters: dict = None):
    """
    Enhanced gist mode with improved confidence calculation, filename matching, and term overlap boosts.
    Returns one best chunk match per file.
    """
    try:
        # Query across all gist chunks
        chunk_results = gist_collection.query(
            query_embeddings=[query_embedding],
            n_results=MAX_SEARCH_RESULTS
        )

        if not chunk_results["metadatas"][0]:
            return jsonify({
                "results": [],
                "message": "No files found in gist mode",
                "query": query,
                "chunking_mode": "gist",
                "total_files": 0,
                "has_more": False,
                "page": page,
                "page_size": page_size,
                "total_pages": 0
            })

        # Prepare hits for gist_ranking processing
        hits = []
        documents = chunk_results["documents"][0]
        metadatas = chunk_results["metadatas"][0]
        distances = chunk_results["distances"][0]

        for j, meta in enumerate(metadatas):
            file_path = meta.get("path")
            if not file_path:
                continue

            # Apply server-side filters early
            if filters is not None:
                if not file_matches_filters(file_path, meta.get("file_type", ""), filters):
                    continue

            # Use enhanced confidence calculation
            # Ensure we have corresponding data for this metadata entry
            if j >= len(documents) or j >= len(distances):
                print(f"Warning: Index {j} out of range for documents/distances")
                continue
                
            content = documents[j]
            raw_distance = float(distances[j])
            confidence = compute_enhanced_gist_confidence(query, content, file_path, raw_distance)

            # Create hit entry for gist_ranking
            hits.append({
                    "file_path": file_path,
                    "file_name": meta.get("fname", os.path.basename(file_path)),
                    "file_type": meta.get("file_type", ""),
                "confidence": confidence,
                "content": content,
                "chunk_index": meta.get("chunk_id", 1),
                "start_line": meta.get("line_ranges", "1")
            })

        # Group hits by file for multi-chunk boosting
        files_data = {}
        for hit in hits:
            file_path = hit["file_path"]
            if file_path not in files_data:
                files_data[file_path] = {
                    "file_name": hit["file_name"],
                    "file_type": hit["file_type"],
                    "chunks": []
                }
            files_data[file_path]["chunks"].append(hit)
        
        # Apply multi-chunk boosting logic
        ranked = []
        for file_path, file_data in files_data.items():
            chunks = file_data["chunks"]
            if not chunks:
                continue
                
            # Sort chunks by confidence (best first)
            chunks.sort(key=lambda c: c["confidence"], reverse=True)
            
            # Primary score from best chunk
            primary_score = chunks[0]["confidence"]
            
            # INTELLIGENT Multi-chunk boosting (prevents large file dominance)
            boost = 0.0
            chunk_count = len(chunks)
            
            if chunk_count > 1:
                # Only boost if primary chunk is already decent (prevents boosting irrelevant files)
                if primary_score > 0.3:
                    # Add diminishing boost from additional chunks, but more conservative
                    significant_additional_chunks = 0
                    for i, chunk in enumerate(chunks[1:min(4, chunk_count)]):  # Max 3 additional chunks
                        chunk_conf = chunk["confidence"]
                        if chunk_conf > 0.5:  # Higher threshold - only boost from truly good chunks
                            # More conservative diminishing returns: 30%, 15%, 7.5%
                            boost_factor = 0.3 / (2 ** i)
                            boost += chunk_conf * boost_factor
                            significant_additional_chunks += 1
                    
                    # Coverage boost only for files with multiple GOOD chunks
                    if significant_additional_chunks >= 2 and primary_score > 0.5:
                        coverage_boost = min(0.1, significant_additional_chunks * 0.02)  # Max 10% coverage boost
                        boost += coverage_boost
                        
                elif primary_score > 0.15:
                    # Small boost for moderate primary score with additional chunks
                    for i, chunk in enumerate(chunks[1:min(2, chunk_count)]):  # Max 1 additional chunk
                        chunk_conf = chunk["confidence"]
                        if chunk_conf > 0.4:
                            boost += chunk_conf * 0.1  # Small 10% boost
            
            # QUALITY-BASED FINAL SCORING (prioritizes semantic relevance)
            if primary_score > 0.7:
                # High-quality matches get full boost
                final_score = min(1.0, primary_score + boost)
            elif primary_score > 0.4:
                # Medium-quality matches get reduced boost
                final_score = min(1.0, primary_score + (boost * 0.7))
            elif primary_score > 0.2:
                # Low-quality matches get minimal boost
                final_score = min(1.0, primary_score + (boost * 0.3))
            else:
                # Very low quality gets no boost (prevents irrelevant large files from ranking high)
                final_score = primary_score
            
            # Use best chunk for display
            best_chunk = chunks[0]
            excerpt = best_chunk["content"][:GIST_EXCERPT_MAX_LENGTH]
            if len(best_chunk["content"]) > GIST_EXCERPT_MAX_LENGTH:
                excerpt += "..."
            
            ranked.append({
                "file_path": file_path,
                "file_name": file_data["file_name"],
                "file_type": file_data["file_type"], 
                "confidence": final_score,
                    "best_chunk": {
                        "content": excerpt,
                    "chunk_id": best_chunk["chunk_index"],
                    "start_line": best_chunk["start_line"]
                    }
            })

        # Sort by final confidence score
        ranked.sort(key=lambda r: r["confidence"], reverse=True)
        total_files = len(ranked)

        # Apply pagination
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated = ranked[start_idx:end_idx]

        total_pages = (total_files + page_size - 1) // page_size
        has_more = page < total_pages

        # Format response: one chunk match per file
        formatted_results = []
        for result in paginated:
            formatted_results.append({
                "file_path": result["file_path"],
                "file_name": result["file_name"],
                "file_type": result["file_type"],
                "confidence": result["confidence"],
                "matches": [{
                    "type": "chunk",
                    "content": result["best_chunk"]["content"],
                    "chunk_id": result["best_chunk"]["chunk_id"],
                    "start_line": result["best_chunk"]["start_line"]
                }]
            })

        return jsonify({
            "results": formatted_results,
            "query": query,
            "total_files": total_files,
            "has_more": has_more,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "chunking_mode": "gist",
            "search_method": "chunk_top"
        })

    except Exception as e:
        print(f"GIST SEARCH: Fatal error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "error": f"Gist search error: {str(e)}",
            "query": query,
            "chunking_mode": "gist"
        }), 500

@app.route('/api/search', methods=['POST'])
def search_files():
    """Perform semantic search with pagination support"""
    data = request.get_json()
    query = data.get('query', '')
    include_granular = data.get('include_granular', True)
    chunking_mode = data.get('chunking_mode', 'gist')  # Default to 'gist'
    page = data.get('page', 1)
    page_size = data.get('page_size', 10)
    top_files = data.get('top_files', TOP_FILES_COUNT)
    top_chunks_per_file = data.get('top_chunks_per_file', CHUNKS_PER_FILE)
    # Accept optional filters from UI
    filters = data.get('filters', None)
    
    # Debug option for gist mode (temporary override)
    debug_scoring = data.get('debug_scoring', False)
    if debug_scoring:
        global GIST_DEBUG_SCORING
        GIST_DEBUG_SCORING = True
    
    if not query.strip():
        return jsonify({"error": "Query is required"}), 400
    
    try:
        # Encode query using appropriate model for the chunking mode
        current_model = get_model_for_mode(chunking_mode)
        q_emb = current_model.encode(query)
        
        # Route to specialized search implementations
        print(f"SEARCH DEBUG: chunking_mode='{chunking_mode}', query='{query}'")
        if chunking_mode == 'gist':
            print(f"ROUTING TO GIST MODE")
            return search_gist_mode(query, q_emb, current_model, top_files, page, page_size, filters)
        elif chunking_mode == 'pinpoint':
            target_collection = pinpoint_collection
            mode_description = "pinpoint mode"
            
            # Step 1: Find top files using the target collection
            file_results = target_collection.query(
                query_embeddings=[q_emb], 
                n_results=min(top_files * 2, MAX_SEARCH_RESULTS)
            )
        else:
            # Fallback to legacy collections
            target_collection = filelevel_collection
            mode_description = "legacy mode"
            
            # Step 1: Find top files using the target collection
            file_results = target_collection.query(
                query_embeddings=[q_emb], 
                n_results=min(top_files * 2, MAX_SEARCH_RESULTS)
            )
        
        if not file_results["metadatas"][0]:
            return jsonify({
                "results": [], 
                "query": query,
                "total_files": 0,
                "has_more": False,
                "page": page,
                "page_size": page_size,
                "total_pages": 0,
                "chunking_mode": chunking_mode
            })
        
        # Extract unique files from results with best scores
        file_scores = {}
        file_metadata = {}
        
        for i, meta in enumerate(file_results["metadatas"][0]):
            file_path = meta["path"]
            score = file_results["distances"][0][i]
            content = file_results["documents"][0][i] if file_results["documents"] and file_results["documents"][0] else ""
            
            # Use enhanced confidence calculation for pinpoint mode
            if chunking_mode == 'pinpoint':
                confidence = compute_enhanced_pinpoint_confidence(query, content, file_path, score)
            else:
                confidence = 1 - score
            
            # Apply server-side filters at file level
            if filters is not None:
                if not file_matches_filters(file_path, meta.get("file_type", ""), filters):
                    continue

            if file_path not in file_scores or confidence > file_scores[file_path]:
                file_scores[file_path] = confidence
                file_metadata[file_path] = meta
        
        # Sort files by score and take top N
        sorted_files = sorted(file_scores.items(), key=lambda x: x[1], reverse=True)
        total_files = len(sorted_files)
        
        # Apply pagination
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_files = sorted_files[start_idx:end_idx]
        
        results = []
        
        # Step 2: For each file, get detailed results from the same collection
        for file_path, file_confidence in paginated_files:
            meta = file_metadata[file_path]
            fname = meta["fname"]
            file_type = meta["file_type"]
            
            file_result = {
                "file_path": file_path,
                "file_name": fname,
                "file_type": file_type,
                "confidence": file_confidence,
                "matches": []
            }
            
            # Get detailed results from the target collection
            try:
                chunk_results = target_collection.query(
                    query_embeddings=[q_emb], 
                    n_results=top_chunks_per_file,
                    where={"path": file_path}
                )
                
                for j, chunk_meta in enumerate(chunk_results["metadatas"][0]):
                    chunk_id = chunk_meta["chunk_id"]
                    chunk_doc = chunk_results["documents"][0][j]
                    chunk_size = chunk_meta["chunk_size"]
                    chunk_distance = chunk_results["distances"][0][j]
                    
                    # Use enhanced confidence calculation for pinpoint mode
                    if chunking_mode == 'pinpoint':
                        chunk_score = compute_enhanced_pinpoint_confidence(query, chunk_doc, file_path, chunk_distance)
                    else:
                        chunk_score = 1 - chunk_distance
                    
                    # Truncate long chunks for display
                    display_chunk = chunk_doc[:MAX_CHUNK_DISPLAY_LENGTH] + "..." if len(chunk_doc) > MAX_CHUNK_DISPLAY_LENGTH else chunk_doc
                    
                    file_result["matches"].append({
                        "type": "chunk",
                        "chunk_id": chunk_id,
                        "chunk_size": chunk_size,
                        "content": display_chunk.strip(),
                        "confidence": chunk_score
                    })
            except Exception as e:
                print(f"Error searching chunks in file: {e}")
            
            results.append(file_result)
        
        # Apply enhanced ranking for pinpoint mode
        if chunking_mode == 'pinpoint':
            results = rank_pinpoint_files(results, query)

        # Calculate pagination metadata
        total_pages = (total_files + page_size - 1) // page_size
        has_more = page < total_pages
        
        return jsonify({
            "results": results,
            "query": query,
            "total_files": total_files,
            "has_more": has_more,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "chunking_mode": chunking_mode
        })
        
    except Exception as e:
        return jsonify({"error": f"Search error: {str(e)}"}), 500

@app.route('/api/track-granular', methods=['POST'])
def toggle_granular_tracking():
    """Toggle granular tracking for specific files"""
    data = request.get_json()
    file_path = data.get('file_path')
    enable = data.get('enable', True)
    
    if not file_path:
        return jsonify({"error": "File path is required"}), 400
    
    try:
        if enable and ENABLE_GRANULAR_CHUNKING and granular_collection:
            # Re-index file with granular tracking
            content = extract_text(file_path)
            if content.strip():
                lines = [line.strip() for line in content.split('\n') if line.strip()]
                file_ext = os.path.splitext(file_path)[1].lower()
                fname = os.path.basename(file_path)
                
                for i, line in enumerate(lines):
                    # Use pinpoint model for granular tracking (line-by-line)
                    embedding = pinpoint_model.encode(line)
                    unique_id = f"granular-{file_path}-{i+1}"
                    granular_collection.add(
                        embeddings=[embedding],
                        documents=[line],
                        metadatas=[{"path": file_path, "fname": fname, "line_num": i+1, "file_type": file_ext}],
                        ids=[unique_id]
                    )
                
                # Note: ChromaDB 1.0+ automatically persists data when using persist_directory
                print("+ ChromaDB granular data will be automatically persisted")
                
                return jsonify({"message": f"Granular tracking enabled for {fname}", "lines_indexed": len(lines)})
            else:
                return jsonify({"error": "File is empty or could not be read"}), 400
        else:
            # Remove granular tracking for file
            if granular_collection:
                # Note: ChromaDB doesn't have a direct "delete by metadata" method
                # This would require more complex implementation
                return jsonify({"message": "Granular tracking disabled (note: existing data not removed)"})
            else:
                return jsonify({"error": "Granular tracking not enabled"}), 400
                
    except Exception as e:
        return jsonify({"error": f"Error toggling granular tracking: {str(e)}"}), 500

@app.route('/api/reindex', methods=['POST'])
def reindex_file():
    """Reindex a specific file"""
    data = request.get_json()
    path = data.get('path')
    chunking_mode = data.get('chunking_mode', 'gist')  # Default to 'gist'
    
    if not path:
        return jsonify({"error": "Path is required"}), 400
    
    if not os.path.exists(path):
        return jsonify({"error": "File not found"}), 404
    
    # Start reindexing in background thread
    thread = threading.Thread(target=reindex_path_background, args=(path, chunking_mode))
    thread.daemon = True
    thread.start()
    
    return jsonify({"message": f"Reindexing started for {os.path.basename(path)} in {chunking_mode} mode"})

def reindex_path_background(path, chunking_mode='gist'):
    """Background reindexing function"""
    try:
        # Remove existing entries for this file from the target collection
        if chunking_mode == 'gist':
            target_collection = gist_collection
            chunking_function = create_gist_chunks
        elif chunking_mode == 'pinpoint':
            target_collection = pinpoint_collection
            chunking_function = create_pinpoint_chunks
        else:
            # Fallback to legacy mode
            target_collection = filelevel_collection
            chunking_function = create_large_chunks
        
        # Remove existing entries for this file
        try:
            target_collection.delete(where={"path": path})
        except Exception as e:
            print(f"Warning: Could not remove existing entries: {e}")
        
        # Reindex the file
        reindex_single_file(path, chunking_mode, target_collection, chunking_function)
        
    except Exception as e:
        print(f"Error during reindexing: {e}")

def reindex_single_file(file_path, chunking_mode, target_collection, chunking_function):
    """Reindex a single file"""
    try:
        file_ext = os.path.splitext(file_path)[1].lower()
        content = extract_text(file_path)
        
        if not content.strip() or len(content.strip()) < MIN_CONTENT_LENGTH:
            print(f"File {file_path} is empty or too short, skipping reindex")
            return
        
        # Create chunks using the selected chunking function
        chunks = chunking_function(content, file_ext)
        if not chunks:
            print(f"No chunks created for {file_path}")
            return
        
        # Index chunks in the target collection
        chunks_created = 0
        # Select appropriate model for the chunking mode
        current_model = get_model_for_mode(chunking_mode)
        for chunk_idx, (chunk_text, line_ranges) in enumerate(chunks):
            embedding = current_model.encode(chunk_text)
            
            unique_id = f"{chunking_mode}-{file_path}-{chunk_idx+1}"
            target_collection.add(
                embeddings=[embedding],
                documents=[chunk_text],
                metadatas=[{
                    "path": file_path, 
                    "fname": os.path.basename(file_path), 
                    "file_type": file_ext,
                    "chunk_id": chunk_idx + 1,
                    "chunk_index": chunk_idx + 1,  # For compatibility with gist_ranking
                    "line_ranges": str(line_ranges),
                    "chunk_size": len(line_ranges),
                    "chunking_mode": chunking_mode
                }],
                ids=[unique_id]
            )
            chunks_created += 1
        
        # Skip gist-mode centroid/metadata computation to keep gist reindex simple
        
        # Update metadata for this file
        chunk_sizes = [len(line_ranges) for _, line_ranges in chunks]
        metadata_tracker.update_file_metadata(file_path, chunking_mode, len(chunks), chunk_sizes)
        
        # Note: ChromaDB 1.0+ automatically persists data when using persist_directory
        print("+ ChromaDB data will be automatically persisted after reindexing")
        
        print(f"Successfully reindexed {file_path} in {chunking_mode} mode: {chunks_created} chunks created")
        
    except Exception as e:
        print(f"Error reindexing {file_path}: {e}")

@app.route('/api/config', methods=['GET'])
def get_config():
    """Get current configuration"""
    return jsonify({
        "enable_granular_chunking": ENABLE_GRANULAR_CHUNKING,
        "file_level_chunk_size": FILE_LEVEL_CHUNK_SIZE,
        "top_files_count": TOP_FILES_COUNT,
        "chunks_per_file": CHUNKS_PER_FILE,
        "max_chunk_display_length": MAX_CHUNK_DISPLAY_LENGTH,
        "skip_hidden_files": SKIP_HIDDEN_FILES,
        "skip_system_files": SKIP_SYSTEM_FILES,
        "max_file_size_mb": MAX_FILE_SIZE_MB,
        "embedding_model": EMBEDDING_MODEL,  # Legacy compatibility
        "gist_embedding_model": GIST_EMBEDDING_MODEL,
        "pinpoint_embedding_model": PINPOINT_EMBEDDING_MODEL,
        "gist_chunk_size": GIST_CHUNK_SIZE,
        "gist_chunk_overlap": GIST_CHUNK_OVERLAP,
        "gist_enable_deduplication": GIST_ENABLE_DEDUPLICATION,
        "gist_max_top_terms": GIST_MAX_TOP_TERMS,
        "gist_candidate_files_count": GIST_CANDIDATE_FILES_COUNT,
        "gist_scoring_weights": GIST_SCORING_WEIGHTS,
        "gist_excerpt_max_length": GIST_EXCERPT_MAX_LENGTH,
        "pinpoint_chunk_size": PINPOINT_CHUNK_SIZE
    })

@app.route('/api/files/track', methods=['POST'])
def get_tracked_files():
    """Get tracked files with pagination, search, and sorting"""
    try:
        data = request.get_json()
        chunking_mode = data.get('chunking_mode', 'gist')
        page = data.get('page', 1)
        page_size = data.get('page_size', 25)
        search_query = data.get('search_query', '').strip()
        sort_by = data.get('sort_by', 'last_indexed')
        sort_order = data.get('sort_order', 'desc')
        
        # Validate chunking mode
        if chunking_mode not in ['gist', 'pinpoint']:
            return jsonify({"error": "Invalid chunking mode"}), 400
        
        # Get collection for the specified mode
        if chunking_mode == 'gist':
            collection = gist_collection
        else:
            collection = pinpoint_collection
        
        if not collection:
            return jsonify({"error": f"Collection not available for {chunking_mode} mode"}), 500
        
        # Get all files from the collection
        try:
            results = collection.get()
            print(f"DEBUG: Got {len(results.get('metadatas', []))} metadata entries from {chunking_mode} collection")
            
            if not results or not results.get('metadatas'):
                return jsonify({
                    "files": [],
                    "pagination": {
                        "page": page,
                        "page_size": page_size,
                        "total_files": 0,
                        "total_pages": 0,
                        "has_more": False
                    },
                    "chunking_mode": chunking_mode
                })
            
            # Process file metadata
            files_data = {}
            for i, metadata in enumerate(results['metadatas']):
                file_path = metadata.get('path')
                if not file_path or file_path == 'None':
                    continue
                
                # Skip if we already processed this file
                if file_path in files_data:
                    continue
                
                # Debug: Print raw metadata for first few files
                if i < 3:
                    print(f"DEBUG: File {i+1} metadata: {metadata}")
                
                # Get file info - try multiple possible field names
                file_name = os.path.basename(file_path)
                parent_folder = os.path.dirname(file_path)
                
                # Try to get file size from multiple possible sources
                file_size = 0
                if os.path.exists(file_path):
                    try:
                        file_size = os.path.getsize(file_path)
                    except OSError:
                        pass
                
                # Try to get last indexed time from multiple possible sources
                last_indexed = 0  # Default to 0 if no timestamp found
                if metadata.get('last_indexed'):
                    last_indexed = metadata.get('last_indexed')
                elif metadata.get('modified_time'):
                    last_indexed = metadata.get('modified_time')
                elif metadata.get('timestamp'):
                    last_indexed = metadata.get('timestamp')
                
                # If still no timestamp, try to get it from the metadata tracker
                if last_indexed == 0 and file_path in metadata_tracker.metadata:
                    stored_metadata = metadata_tracker.metadata[file_path]
                    last_indexed = stored_metadata.get('last_indexed', 0)
                
                # Try to get chunk count from multiple possible sources
                num_chunks = 0
                if metadata.get('n_chunks'):
                    num_chunks = metadata.get('n_chunks')
                elif metadata.get('chunk_count'):
                    num_chunks = metadata.get('chunk_count')
                elif metadata.get('num_chunks'):
                    num_chunks = metadata.get('num_chunks')
                
                # Check if file needs syncing
                is_synced = True
                if sync_tracker:
                    files_to_sync = sync_tracker.get_files_to_sync(chunking_mode)
                    is_synced = not any(f.file_path == file_path for f in files_to_sync)
                
                # Apply search filter
                if search_query:
                    search_lower = search_query.lower()
                    if (search_lower not in file_name.lower() and 
                        search_lower not in parent_folder.lower()):
                        continue
                
                files_data[file_path] = {
                    "file_path": file_path,
                    "file_name": file_name,
                    "parent_folder": parent_folder,
                    "file_size": file_size,
                    "last_indexed": last_indexed,
                    "status": "Synced" if is_synced else "Out of sync",
                    "is_synced": is_synced,
                    "num_chunks": num_chunks,
                    "chunking_mode": chunking_mode
                }
            
            print(f"DEBUG: Processed {len(files_data)} unique files")
            
            # Convert to list and sort
            files_list = list(files_data.values())
            
            # Apply sorting
            reverse_sort = sort_order == 'desc'
            if sort_by == 'file_name':
                files_list.sort(key=lambda x: x['file_name'].lower(), reverse=reverse_sort)
            elif sort_by == 'file_size':
                files_list.sort(key=lambda x: x['file_size'], reverse=reverse_sort)
            elif sort_by == 'parent_folder':
                files_list.sort(key=lambda x: x['parent_folder'].lower(), reverse=reverse_sort)
            elif sort_by == 'status':
                files_list.sort(key=lambda x: x['is_synced'], reverse=reverse_sort)
            elif sort_by == 'num_chunks':
                files_list.sort(key=lambda x: x['num_chunks'], reverse=reverse_sort)
            else:  # last_indexed (default)
                files_list.sort(key=lambda x: x['last_indexed'], reverse=reverse_sort)
            
            # Apply pagination
            total_files = len(files_list)
            total_pages = (total_files + page_size - 1) // page_size
            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size
            paginated_files = files_list[start_idx:end_idx]
            
            return jsonify({
                "files": paginated_files,
                "pagination": {
                    "page": page,
                    "page_size": page_size,
                    "total_files": total_files,
                    "total_pages": total_pages,
                    "has_more": page < total_pages
                },
                "chunking_mode": chunking_mode
            })
            
        except Exception as e:
            print(f"Error getting files from collection: {e}")
            return jsonify({"error": f"Database error: {str(e)}"}), 500
            
    except Exception as e:
        print(f"Error in get_tracked_files: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/api/metadata', methods=['GET'])
def get_metadata_stats():
    """Get metadata statistics and storage information"""
    try:
        stats = metadata_tracker.get_indexing_stats()
        
        # Add gist centroids information
        try:
            gist_centroids_count = gist_centroids_collection.count()
            stats["gist_centroids_count"] = gist_centroids_count
            stats["gist_centroids_available"] = gist_centroids_count > 0
        except Exception as e:
            stats["gist_centroids_count"] = 0
            stats["gist_centroids_available"] = False
            stats["gist_centroids_error"] = str(e)
        
        # Add collection counts
        try:
            stats["collections"] = {
                "gist_chunks": gist_collection.count() if gist_collection else 0,
                "filelevel_chunks": filelevel_collection.count() if filelevel_collection else 0
            }
        except Exception as e:
            stats["collections_error"] = str(e)
        
        return jsonify(stats)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/gist-stats', methods=['GET'])
def get_gist_stats():
    """Get detailed gist mode statistics"""
    try:
        stats = {
            "gist_mode_available": True,
            "embedding_model": GIST_EMBEDDING_MODEL,
            "chunk_size": GIST_CHUNK_SIZE,
            "chunk_overlap": GIST_CHUNK_OVERLAP,
            "deduplication_enabled": GIST_ENABLE_DEDUPLICATION,
            "max_top_terms": GIST_MAX_TOP_TERMS
        }
        
        # Get collection counts
        try:
            stats["chunk_count"] = gist_collection.count() if gist_collection else 0
            stats["centroid_count"] = gist_centroids_collection.count() if gist_centroids_collection else 0
            stats["centroids_available"] = stats["centroid_count"] > 0
        except Exception as e:
            stats["collection_error"] = str(e)
            stats["chunk_count"] = 0
            stats["centroid_count"] = 0
            stats["centroids_available"] = False
        
        # Sample some gist metadata if available
        try:
            if stats["centroid_count"] > 0:
                sample_results = gist_centroids_collection.get(limit=3)
                if sample_results['metadatas']:
                    sample_files = []
                    for meta in sample_results['metadatas']:
                        sample_files.append({
                            "file_name": meta.get("fname", "unknown"),
                            "file_type": meta.get("file_type", "unknown"),
                            "n_chunks": meta.get("n_chunks", 0),
                            "gist_version": meta.get("gist_version", "unknown"),
                            "file_size_bytes": meta.get("file_size_bytes", 0)
                        })
                    stats["sample_files"] = sample_files
        except Exception as e:
            stats["sample_error"] = str(e)
        
        return jsonify(stats)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# Real-time Sync API Endpoints

@app.route('/api/sync/status', methods=['POST'])
def get_sync_status():
    """Get real-time sync status for a chunking mode"""
    try:
        data = request.get_json()
        chunking_mode = data.get('chunking_mode', 'gist')
        
        sync_status = sync_tracker.get_sync_status(chunking_mode)
        
        # Debug the persistent file
        if sync_status.get('total_changes', 0) > 0:
            print(f"PERSISTENT SYNC QUEUE for {chunking_mode}:")
            files_to_sync = sync_tracker.get_files_to_sync(chunking_mode)
            for i, file_event in enumerate(files_to_sync):
                print(f"  File {i+1}: {os.path.basename(file_event.file_path)} ({file_event.event_type})")
                print(f"    Full path: {file_event.file_path}")
                print(f"    Exists: {os.path.exists(file_event.file_path)}")
                if os.path.exists(file_event.file_path):
                    needs_indexing = not metadata_tracker.is_file_unchanged(file_event.file_path, chunking_mode)
                    print(f"    Needs indexing: {needs_indexing}")
        
        return jsonify({
            'success': True,
            'chunking_mode': chunking_mode,
            **sync_status
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/sync/start', methods=['POST'])
def start_realtime_sync():
    """Start real-time file monitoring"""
    try:
        print("DEBUG API: Starting real-time sync monitoring...")
        
        # Start the monitor
        print("DEBUG API: Calling realtime_monitor.start_monitoring()...")
        success = realtime_monitor.start_monitoring()
        print(f"DEBUG API: start_monitoring returned: {success}")
        
        if success:
            # Setup UI callback for real-time updates
            def notify_ui_update():
                # This could emit events to connected clients
                # For now, we'll just log the update
                pass
            
            print("DEBUG API: Setting sync status callback...")
            sync_tracker.set_sync_status_callback(notify_ui_update)
            
            # Add any existing indexed folders to monitoring
            print("DEBUG API: Calling setup_initial_monitoring()...")
            setup_initial_monitoring()
            
            print("DEBUG API: Getting monitor status...")
            status = realtime_monitor.get_status()
            print(f"DEBUG API: Monitor status: {status}")
            
            response = {
                "success": True,
                "message": "Real-time sync monitoring started",
                "status": status
            }
            print(f"SUCCESS API: Returning success response: {response}")
            return jsonify(response)
        else:
            error_msg = "Failed to start monitoring"
            print(f"ERROR API: {error_msg}")
            return jsonify({"success": False, "error": error_msg}), 500
            
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback_str = traceback.format_exc()
        print(f"ERROR API: Exception in start_realtime_sync: {error_msg}")
        print(f"ERROR API: Traceback: {traceback_str}")
        return jsonify({"success": False, "error": error_msg}), 500

@app.route('/api/sync/stop', methods=['POST'])
def stop_realtime_sync():
    """Stop real-time file monitoring"""
    try:
        realtime_monitor.stop_monitoring()
        
        return jsonify({
            "success": True,
            "message": "Real-time sync monitoring stopped"
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/sync/execute', methods=['POST'])
def execute_sync():
    """Execute sync for files in the queue"""
    try:
        data = request.get_json()
        chunking_mode = data.get('chunking_mode', 'gist')
        
        # Get files that need syncing
        files_to_sync = sync_tracker.get_files_to_sync(chunking_mode)
        
        if not files_to_sync:
            return jsonify({
                "success": True,
                "message": "No files need syncing",
                "files_processed": 0,
                "chunking_mode": chunking_mode
            })
        
        # Start background sync
        threading.Thread(
            target=execute_sync_background,
            args=[files_to_sync, chunking_mode],
            daemon=True
        ).start()
        
        return jsonify({
            "success": True,
            "message": f"Sync started for {len(files_to_sync)} files",
            "files_to_sync": len(files_to_sync),
            "chunking_mode": chunking_mode
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/sync/monitor-status', methods=['GET'])
def get_monitor_status():
    """Get current monitoring status"""
    try:
        status = realtime_monitor.get_status()
        return jsonify({
            "success": True,
            **status
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/debug/sync', methods=['GET'])
def debug_sync_system():
    """Debug endpoint to check sync system status"""
    try:
        # Check if monitoring is running
        monitor_status = realtime_monitor.get_status()
        
        # Check indexed folders
        indexed_folders = metadata_tracker.get_indexed_folders()
        
        # Check sync tracker status for both modes
        gist_sync = sync_tracker.get_sync_status('gist')
        pinpoint_sync = sync_tracker.get_sync_status('pinpoint')
        
        return jsonify({
            "success": True,
            "monitor_status": monitor_status,
            "indexed_folders": indexed_folders,
            "sync_status": {
                "gist": gist_sync,
                "pinpoint": pinpoint_sync
            }
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/debug/force-monitor-start', methods=['POST'])
def force_monitor_start():
    """Force start monitoring for debugging"""
    try:
        # Start the monitor
        success = realtime_monitor.start_monitoring()
        
        if success:
            # Get indexed folders and add them to monitoring
            indexed_folders = metadata_tracker.get_indexed_folders()
            added_folders = []
            
            for folder_path, folder_info in indexed_folders.items():
                for chunking_mode in folder_info['chunking_modes']:
                    add_success = realtime_monitor.add_folder(folder_path, chunking_mode)
                    if add_success:
                        added_folders.append(f"{folder_path} ({chunking_mode})")
            
            return jsonify({
                "success": True,
                "message": "Monitoring started manually",
                "added_folders": added_folders,
                "status": realtime_monitor.get_status()
            })
        else:
            return jsonify({"success": False, "error": "Failed to start monitoring"})
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/debug/test-simple', methods=['GET'])
def test_simple():
    """Simple test endpoint to verify API is working"""
    try:
        return jsonify({
            "success": True,
            "message": "API is working",
            "metadata_files": len(metadata_tracker.metadata),
            "monitor_running": realtime_monitor.is_running if hasattr(realtime_monitor, 'is_running') else "unknown"
        })
    except Exception as e:
        import traceback
        return jsonify({
            "success": False, 
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500

@app.route('/api/debug/sync-queue', methods=['GET'])
def debug_sync_queue():
    """Debug endpoint to inspect sync queue state"""
    try:
        chunking_mode = request.args.get('chunking_mode', 'gist')
        
        gist_status = sync_tracker.get_sync_status('gist')
        pinpoint_status = sync_tracker.get_sync_status('pinpoint')
        
        return jsonify({
            "success": True,
            "requested_mode": chunking_mode,
            "gist_mode": gist_status,
            "pinpoint_mode": pinpoint_status,
            "monitor_status": realtime_monitor.get_status(),
            "metadata_stats": metadata_tracker.get_indexing_stats()
        })
        
    except Exception as e:
        import traceback
        return jsonify({
            "success": False, 
            "error": str(e),
            "traceback": traceback.format_exc()
        }), 500

@app.route('/api/debug/clear-sync-queue', methods=['POST'])
def clear_sync_queue():
    """Clear sync queue for debugging"""
    try:
        data = request.get_json()
        chunking_mode = data.get('chunking_mode', 'gist')
        
        sync_tracker.clear_sync_queue(chunking_mode)
        
        return jsonify({
            "success": True,
            "message": f"Cleared sync queue for {chunking_mode} mode"
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/debug/sync-events', methods=['GET'])
def debug_sync_events():
    """Get recent sync events for debugging"""
    try:
        chunking_mode = request.args.get('chunking_mode', 'gist')
        
        # Get recent events from sync tracker
        sync_status = sync_tracker.get_sync_status(chunking_mode)
        
        return jsonify({
            "success": True,
            "chunking_mode": chunking_mode,
            "recent_events": sync_status.get('recent_events', []),
            "queue_details": sync_status.get('queue_details', []),
            "total_changes": sync_status.get('total_changes', 0),
            "needs_sync": sync_status.get('needs_sync', False)
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/debug/force-rescan', methods=['POST'])
def force_rescan_folders():
    """Force rescan all monitored folders for changes"""
    try:
        print("DEBUG: Manual force rescan triggered...")
        realtime_monitor.force_check_all_folders()
        
        # Get updated sync status for both modes
        gist_status = sync_tracker.get_sync_status('gist')
        pinpoint_status = sync_tracker.get_sync_status('pinpoint')
        
        return jsonify({
            "success": True,
            "message": "Force rescan completed",
            "gist_mode": gist_status,
            "pinpoint_mode": pinpoint_status
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/debug/current-queue', methods=['GET'])
def get_current_sync_queue():
    """Get current sync queue contents"""
    try:
        data = request.args
        chunking_mode = data.get('chunking_mode', 'gist')
        
        queue = sync_tracker.sync_queue.get(chunking_mode, {})
        queue_info = []
        
        for file_path, event in queue.items():
            queue_info.append({
                "file_path": file_path,
                "file_name": os.path.basename(file_path),
                "event_type": event.event_type,
                "timestamp": event.timestamp,
                "folder_path": event.folder_path
            })
        
        return jsonify({
            "success": True,
            "chunking_mode": chunking_mode,
            "queue_size": len(queue_info),
            "queue_contents": queue_info
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

def setup_initial_monitoring():
    """Setup monitoring for folders that are already indexed"""
    try:
        print("DEBUG: Setting up initial monitoring...")
        
        # Get indexed folders from metadata
        indexed_folders = metadata_tracker.get_indexed_folders()
        print(f"DEBUG: Found {len(indexed_folders)} indexed folders: {list(indexed_folders.keys())}")
        
        added_count = 0
        for folder_path, folder_info in indexed_folders.items():
            print(f"DEBUG: Processing folder: {folder_path} with modes: {folder_info['chunking_modes']}")
            for chunking_mode in folder_info['chunking_modes']:
                success = realtime_monitor.add_folder(folder_path, chunking_mode)
                if success:
                    print(f"SUCCESS: Added {folder_path} to real-time monitoring for {chunking_mode} mode")
                    added_count += 1
                else:
                    print(f"ERROR: Failed to add {folder_path} for {chunking_mode} mode")
        
        print(f"DEBUG: Total folders added to monitoring: {added_count}")
        
        # Force check for any changes since last run
        print("DEBUG: Force checking all folders for changes...")
        realtime_monitor.force_check_all_folders()
        print("SUCCESS: Initial monitoring setup complete!")
        
    except Exception as e:
        print(f"ERROR: Error setting up initial monitoring: {e}")
        import traceback
        traceback.print_exc()

def execute_sync_background(files_to_sync, chunking_mode):
    """Execute sync in background with better error handling"""
    global indexing_status
    
    indexing_status.update({
        "is_indexing": True,
        "progress": 0,
        "total_files": len(files_to_sync),
        "current_file": "",
        "message": f"Syncing {len(files_to_sync)} files in {chunking_mode} mode...",
        "chunking_mode": chunking_mode
    })
    
    try:
        files_processed = 0
        files_deleted = 0
        files_updated = 0
        files_failed = 0
        failed_files = []
        
        # Choose collection based on chunking mode
        if chunking_mode == 'gist':
            collection = gist_collection
            chunking_function = create_gist_chunks
        elif chunking_mode == 'pinpoint':
            collection = pinpoint_collection
            chunking_function = create_pinpoint_chunks
        else:
            raise ValueError(f"Unknown chunking mode: {chunking_mode}")
        
        synced_files = []
        
        for i, file_event in enumerate(files_to_sync):
            file_path = file_event.file_path
            event_type = file_event.event_type
            
            # Determine operation type for better UI feedback
            if event_type == 'deleted':
                operation = "Removing"
            elif event_type == 'created':
                operation = "Adding"
            elif event_type == 'modified':
                operation = "Updating"
            else:
                operation = "Processing"
            
            indexing_status.update({
                "progress": (i / len(files_to_sync)) * 100,
                "current_file": os.path.basename(file_path),
                "message": f"{operation} {os.path.basename(file_path)}..."
            })
            
            try:
                if event_type == 'deleted':
                    print(f"🗑️ SYNC DEBUG: Processing DELETION event for {os.path.basename(file_path)}")
                    print(f"🗑️ SYNC DEBUG: File still exists: {os.path.exists(file_path)}")
                    success = _handle_file_deletion(file_path, chunking_mode, collection)
                    if success:
                        files_deleted += 1
                        synced_files.append(file_path)
                        print(f"SUCCESS: Deleted file: {os.path.basename(file_path)}")
                    else:
                        files_failed += 1
                        failed_files.append((file_path, "deletion_failed"))
                
                elif event_type in ['created', 'modified']:
                    print(f"🔧 SYNC DEBUG: Processing {event_type} event for {os.path.basename(file_path)}")
                    print(f"🔧 SYNC DEBUG: File exists: {os.path.exists(file_path)}")
                    success = _handle_file_update(file_path, chunking_mode, collection, chunking_function)
                    print(f"🔧 SYNC DEBUG: Update result: {success}")
                    if success:
                        files_updated += 1
                        synced_files.append(file_path)
                        print(f"SUCCESS: Updated file: {os.path.basename(file_path)}")
                    else:
                        files_failed += 1
                        failed_files.append((file_path, "update_failed"))
                        print(f"❌ SYNC DEBUG: Update FAILED for {os.path.basename(file_path)}")
                
                files_processed += 1
                
            except Exception as e:
                files_failed += 1
                failed_files.append((file_path, str(e)))
                print(f"ERROR: Error processing {file_path}: {e}")
                continue
        
        # Mark successfully processed files as synced and remove failed files from queue
        if synced_files:
            sync_tracker.mark_files_synced(synced_files, chunking_mode)
            print(f"DEBUG: Marked {len(synced_files)} files as synced in {chunking_mode} mode")
        
        # Remove failed files from queue so they don't stay stuck forever
        if failed_files:
            failed_file_paths = [file_path for file_path, _ in failed_files]
            print(f"Removing {len(failed_file_paths)} failed files from sync queue...")
            for file_path in failed_file_paths:
                # Find which folder this file belongs to for proper removal
                matching_modes = sync_tracker.get_all_matching_modes(file_path)
                for mode, folder_path in matching_modes:
                    if mode == chunking_mode:
                        sync_tracker.remove_from_sync_queue(file_path, chunking_mode, folder_path)
                        break
        
        # CRITICAL FIX: Prevent cross-mode interference by ensuring we only clear our own queue
        print(f"DEBUG: Final queue check for {chunking_mode} mode - ensuring no cross-mode interference")
        
        # Validate sync completion by checking queue status
        remaining_count = len(sync_tracker.get_files_to_sync(chunking_mode))
        
        if remaining_count > 0:
            print(f"WARNING: {remaining_count} files still remain in sync queue after sync completion")
            # Force clear any remaining items that might be stuck
            sync_tracker.clear_sync_queue(chunking_mode)
            print(f"Cleared remaining {remaining_count} items from sync queue")
        
        # Update final status
        final_message = f"Sync complete! {files_updated} updated, {files_deleted} deleted"
        if files_failed > 0:
            final_message += f", {files_failed} failed"
        final_message += f" in {chunking_mode} mode"
        
        indexing_status.update({
            "is_indexing": False,
            "progress": 100,
            "current_file": "",
            "message": final_message,
            "chunking_mode": chunking_mode
        })
        
        print(f"Sync completed: {files_processed} processed, {files_updated} updated, {files_deleted} deleted, {files_failed} failed")
        
        # Log failed files for debugging
        if failed_files:
            print("Failed files:")
            for file_path, error in failed_files:
                print(f"  - {os.path.basename(file_path)}: {error}")
        
        # Final validation: Ensure sync queue is empty
        final_queue_count = len(sync_tracker.get_files_to_sync(chunking_mode))
        if final_queue_count == 0:
            print(f"SUCCESS: Sync queue cleared successfully for {chunking_mode} mode")
        else:
            print(f"WARNING: {final_queue_count} files still in sync queue for {chunking_mode} mode after cleanup")
            # Only clear queue for this specific mode to prevent cross-mode interference
            sync_tracker.clear_sync_queue(chunking_mode)
            print(f"Cleared remaining {final_queue_count} items from {chunking_mode} mode sync queue")
        
    except Exception as e:
        print(f"Fatal sync error: {e}")
        import traceback
        traceback.print_exc()
        
        # Don't clear entire queue on error
        indexing_status.update({
            "is_indexing": False,
            "progress": 0,
            "current_file": "",
            "message": f"Sync failed: {str(e)}",
            "chunking_mode": chunking_mode
        })

def _handle_file_deletion(file_path: str, chunking_mode: str, collection) -> bool:
    """Handle file deletion with proper cleanup"""
    try:
        # Remove from metadata
        metadata_tracker.remove_file_metadata(file_path)
        
        # Remove from ChromaDB
        existing_results = collection.get(where={"path": file_path})
        if existing_results['ids']:
            collection.delete(ids=existing_results['ids'])
        
        # Skip centroid deletion in simplified gist mode
        
        return True
        
    except Exception as e:
        print(f"Error deleting file {file_path}: {e}")
        return False

def _handle_file_update(file_path: str, chunking_mode: str, collection, chunking_function) -> bool:
    """Handle file update with simple delete-and-reindex approach"""
    try:
        if not os.path.exists(file_path):
            print(f"File {file_path} no longer exists, skipping update")
            return False
        
        print(f"🔄 UPDATING: {os.path.basename(file_path)} - using delete-and-reindex approach")
        
        # STEP 1: Delete ALL existing chunks for this file (try multiple path formats)
        print(f"🗑️ STEP 1: Deleting existing chunks for {os.path.basename(file_path)}")
        
        # Try original path first
        existing_results = collection.get(where={"path": file_path})
        old_ids = existing_results['ids'] if existing_results['ids'] else []
        
        # If no results, try normalized and absolute paths
        if not old_ids:
            normalized_path = os.path.normpath(file_path)
            existing_results = collection.get(where={"path": normalized_path})
            old_ids = existing_results['ids'] if existing_results['ids'] else []
        
        if not old_ids:
            abs_path = os.path.abspath(file_path)
            existing_results = collection.get(where={"path": abs_path})
            old_ids = existing_results['ids'] if existing_results['ids'] else []
        
        # Delete old chunks if found
        if old_ids:
            try:
                collection.delete(ids=old_ids)
                print(f"✅ Deleted {len(old_ids)} old chunks for {os.path.basename(file_path)}")
            except Exception as e:
                print(f"⚠️ Warning: Could not delete old chunks: {e}")
        
        # Skip centroid deletion in simplified gist mode
        
        # STEP 2: Reindex the file as if it's new
        print(f"📝 STEP 2: Reindexing {os.path.basename(file_path)} as new file")
        
        # Extract content
        content = extract_text(file_path)
        if not content.strip():
            print(f"⚠️ WARNING: File {file_path} extracted no content, using placeholder")
            content = f"[Empty or unreadable content from {os.path.basename(file_path)}]"
        
        file_ext = os.path.splitext(file_path)[1].lower()
        
        # Create chunks
        chunks = chunking_function(content, file_ext)
        if not chunks:
            print(f"⚠️ WARNING: No chunks created for {file_path}, creating fallback")
            chunks = [(content[:1000] if content else f"[Fallback content for {os.path.basename(file_path)}]", [1])]
        
        # Add new chunks
        current_model = get_model_for_mode(chunking_mode)
        chunk_embeddings = []
        chunks_added = 0
        
        for chunk_idx, (chunk_text, line_ranges) in enumerate(chunks):
            embedding = current_model.encode(chunk_text)
            
            if chunking_mode == 'gist':
                from main import normalize_embedding
                normalized_embedding = normalize_embedding(embedding)
                chunk_embeddings.append(normalized_embedding)
            
            unique_id = f"{chunking_mode}-{file_path}-{chunk_idx+1}"
            
            try:
                collection.add(
                    embeddings=[embedding],
                    documents=[chunk_text],
                    metadatas=[{
                        "path": file_path,
                        "fname": os.path.basename(file_path),
                        "file_type": file_ext,
                        "chunk_id": chunk_idx + 1,
                        "chunk_index": chunk_idx + 1,
                        "line_ranges": str(line_ranges),
                        "chunk_size": len(line_ranges),
                        "chunking_mode": chunking_mode
                    }],
                    ids=[unique_id]
                )
                chunks_added += 1
            except Exception as e:
                print(f"❌ ERROR: Failed to add chunk {chunk_idx+1}: {e}")
                raise
        
        print(f"✅ Successfully added {chunks_added} new chunks for {os.path.basename(file_path)}")
        
        # Skip gist-mode centroid/metadata computation in simplified gist mode
        
        # Update metadata
        chunk_sizes = [len(line_ranges) for _, line_ranges in chunks]
        metadata_tracker.update_file_metadata(file_path, chunking_mode, len(chunks), chunk_sizes)
        
        print(f"🎉 SUCCESS: File {os.path.basename(file_path)} updated via delete-and-reindex")
        return True
        
    except Exception as e:
        print(f"❌ ERROR: Failed to update file {file_path}: {e}")
        return False

if __name__ == '__main__':
    print("Starting FileFinder API server...")
    print(f"Gist model (MSMarco): {GIST_EMBEDDING_MODEL}")
    print(f"Pinpoint model (AllMiniLM): {PINPOINT_EMBEDDING_MODEL}")
    print(f"Database directory: {metadata_tracker.get_db_directory()}")
    print(f"Granular chunking: {ENABLE_GRANULAR_CHUNKING}")
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5001, debug=False) 