"""
FileFinder Configuration File

Modify these settings to customize the behavior of FileFinder.
All settings can be changed without modifying the main code.
"""

# ============================================================================
# CORE SETTINGS
# ============================================================================

# Path to the folder you want to index (can be relative or absolute)
FOLDER_TO_INDEX = "./test_confidence_files"
# FOLDER_TO_INDEX = "./test_files"
# FOLDER_TO_INDEX = "./testing_grounds/semantic_test_data"

# Embedding models to use for semantic search
# Gist mode: MSMarco model optimized for search and retrieval
GIST_EMBEDDING_MODEL = "sentence-transformers/msmarco-MiniLM-L6-cos-v5"
# Pinpoint mode: AllMiniLM model for general semantic understanding  
PINPOINT_EMBEDDING_MODEL = "all-MiniLM-L6-v2"

# Legacy embedding model for backward compatibility
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

# ChromaDB database directory (will be set by metadata tracker)
# DB_DIR = "./chroma_db"  # Legacy setting, now handled by MetadataTracker

# Collection name for ChromaDB
COLLECTION_NAME = "filefinder"

# App name for platform-specific data directories
APP_NAME = "FileFinder"

# ============================================================================
# CHUNKING CONFIGURATION
# ============================================================================

# Enable/disable granular (line-by-line) chunking
# True: Dual-chunk mode (line-by-line + file-level) - More precise, slower indexing
# False: File-level only mode (large chunks) - Faster indexing, better context
ENABLE_GRANULAR_CHUNKING = True

# Size limit for file-level chunks (in lines)
# Larger chunks = better context but less precision
# Smaller chunks = more precision but may lose context
FILE_LEVEL_CHUNK_SIZE = 12

# New chunking modes configuration
# Gist mode: Larger chunks for topic understanding (paragraph/section level)
GIST_CHUNK_SIZE = 35

# Gist mode enhancements
GIST_CHUNK_OVERLAP = 5  # Lines of overlap between adjacent chunks
GIST_ENABLE_DEDUPLICATION = True  # Remove near-duplicate chunks
GIST_DEDUP_THRESHOLD = 0.98  # Cosine similarity threshold for deduplication
GIST_MAX_TOP_TERMS = 50  # Maximum number of top terms to store per file

# Pinpoint mode: Smaller chunks for exact phrase matching (sentence/line level)
PINPOINT_CHUNK_SIZE = 3

# ============================================================================
# GIST MODE SEARCH CONFIGURATION
# ============================================================================

# Two-stage retrieval parameters
GIST_CANDIDATE_FILES_COUNT = 200  # Top C candidate files from centroid search

# Holistic scoring weights (must sum to 1.0 for interpretability)
GIST_SCORING_WEIGHTS = {
    "s_max": 0.45,        # Maximum chunk similarity (bullseye chunk)
    "s_topk_mean": 0.25,  # Mean of top-k chunk similarities  
    "s_centroid": 0.20,   # File centroid similarity
    "s_bm25": 0.10        # BM25-lite score from top terms
}

# Top-k chunk selection for s_topk_mean
# m = min(max(1, ceil(0.1 * n_chunks)), 5)
GIST_TOPK_MIN = 1      # Minimum chunks to consider
GIST_TOPK_RATIO = 0.1  # Proportion of chunks to consider (10%)
GIST_TOPK_MAX = 5      # Maximum chunks to consider

# BM25-lite parameters
GIST_BM25_K1 = 1.2     # Term frequency saturation parameter
GIST_BM25_B = 0.75     # Length normalization parameter

# Result formatting
GIST_EXCERPT_MAX_LENGTH = 600  # Maximum characters for best chunk excerpt

# Debug and telemetry
GIST_DEBUG_SCORING = False     # Include component scores in response
GIST_LOG_SCORE_DISTRIBUTION = True  # Log score statistics

# ============================================================================
# SEARCH CONFIGURATION
# ============================================================================

# Number of top files to show in search results
TOP_FILES_COUNT = 3

# Number of chunks/lines to show per file
# In dual-chunk mode: number of lines per file
# In file-level mode: number of chunks per file
CHUNKS_PER_FILE = 5

# Maximum characters to display per chunk in file-level mode
# Longer chunks will be truncated with "..."
MAX_CHUNK_DISPLAY_LENGTH = 200

# ============================================================================
# DISPLAY CONFIGURATION
# ============================================================================

# Enable/disable debug output during search
SHOW_DEBUG_OUTPUT = False

# Enable/disable loading animations
SHOW_LOADING_ANIMATIONS = True

# Duration of loading animations (in seconds)
LOADING_ANIMATION_DURATION = 1.0

# Enable/disable progress bars during indexing
SHOW_PROGRESS_BARS = True

# ============================================================================
# FILE TYPE CONFIGURATION
# ============================================================================

# Skip hidden files (files starting with '.')
SKIP_HIDDEN_FILES = True

# Skip system files (files starting with '~')
SKIP_SYSTEM_FILES = True

# Maximum file size to process (in MB, 0 = no limit)
MAX_FILE_SIZE_MB = 50

# ============================================================================
# ADVANCED SETTINGS
# ============================================================================

# Text encoding to use when reading files
DEFAULT_ENCODING = "utf-8"

# How to handle encoding errors
# Options: "ignore", "replace", "strict"
ENCODING_ERROR_HANDLING = "ignore"

# Minimum content length to index a file (in characters)
MIN_CONTENT_LENGTH = 10

# Maximum number of results to retrieve from ChromaDB
# (internal setting, affects performance)
MAX_SEARCH_RESULTS = 100