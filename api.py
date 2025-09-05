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
    from github_integration import GitHubIntegration, ConnectedRepo
    from branch_manifest import manifest_manager
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
    "chunking_mode": None,
    "indexing_type": None,  # "local" or "github"
    "cancel_requested": False,  # Add cancel flag
    "indexed_files_this_session": []  # Track files indexed in current session for rollback
}

# Initialize metadata tracker and real-time sync system
metadata_tracker = MetadataTracker(APP_NAME)
sync_tracker = SyncTracker(metadata_tracker)
realtime_monitor = RealtimeMonitor(sync_tracker)

# Initialize folder settings
from folder_settings import folder_settings

# Initialize GitHub integration
GITHUB_CLIENT_ID = "Ov23lin7oNWMsxhBI4Ac"
github_integration = GitHubIntegration(GITHUB_CLIENT_ID)

def initialize_collections():
    """Initialize ChromaDB collections for different chunking modes"""
    try:
        db_dir = metadata_tracker.get_db_directory()
        print(f"setting up chromadb at: {db_dir}")
        
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
print("starting filefinder api...")
print("loading msmarco model for gist mode...")
gist_model = SentenceTransformer(GIST_EMBEDDING_MODEL)
print("loading allmini model for pinpoint mode...")
pinpoint_model = SentenceTransformer(PINPOINT_EMBEDDING_MODEL)
print("models loaded")

# Optional: warm up models to reduce first-query latency
try:
    _ = gist_model.encode("warmup")
    _ = pinpoint_model.encode("warmup")
    print("models warmed up")
except Exception as _warmup_err:
    print(f"model warmup skipped: {_warmup_err}")

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

def _matches_wildcard_pattern(filename: str, filepath: str, pattern: str) -> bool:
    """
    Check if a file matches a wildcard pattern.
    Supports:
    - *.ext (extension matching)
    - name* (prefix matching)
    - *name* (substring matching)
    - *name (suffix matching)
    - ? (single character)
    - path/pattern (path-based matching)
    - !pattern (exclusion - handled by caller)
    """
    import fnmatch
    
    pattern = pattern.strip()
    if not pattern:
        return False
    
    # Handle exclusion patterns (! prefix)
    if pattern.startswith('!'):
        return False  # Exclusions handled by caller
    
    try:
        # If pattern contains path separator, match against full path
        if '/' in pattern or '\\' in pattern:
            # Normalize path separators
            norm_pattern = pattern.replace('\\', '/')
            norm_filepath = filepath.replace('\\', '/')
            return fnmatch.fnmatch(norm_filepath.lower(), norm_pattern.lower())
        
        # Otherwise match against filename only
        return fnmatch.fnmatch(filename.lower(), pattern.lower())
    
    except Exception:
        return False

def _matches_file_patterns(filename: str, filepath: str, file_ext: str, patterns: list) -> bool:
    """
    Check if a file matches any of the given patterns.
    Handles both simple extensions and wildcard patterns.
    Returns False if any exclusion pattern matches.
    """
    if not patterns:
        return True
    
    # Check exclusion patterns first
    for pattern in patterns:
        if pattern.startswith('!'):
            exclude_pattern = pattern[1:]  # Remove ! prefix
            if _matches_wildcard_pattern(filename, filepath, exclude_pattern):
                return False
    
    # Check inclusion patterns
    has_inclusion_patterns = any(not p.startswith('!') for p in patterns)
    if not has_inclusion_patterns:
        return True  # No inclusion patterns, only exclusions
    
    for pattern in patterns:
        if pattern.startswith('!'):
            continue  # Skip exclusion patterns
        
        # Check if it's a simple extension (no wildcards)
        if not any(char in pattern for char in ['*', '?', '/', '\\']):
            # Simple extension matching
            ext_no_dot = file_ext.lower().lstrip('.')
            pattern_no_dot = pattern.lower().lstrip('.')
            if ext_no_dot == pattern_no_dot:
                return True
        else:
            # Wildcard pattern matching
            if _matches_wildcard_pattern(filename, filepath, pattern):
                return True
    
    return False

def file_matches_filters(file_path: str, file_type: str, filters: dict, metadata: dict = None) -> bool:
    """
    Apply server-side filters to a file path using available metadata.
    - fileTypes: list like ['py','md'] (compare against extension without dot)
    - searchFolder: string path; require file under this folder
    - timeRange: { type: 'all'|'before'|'after'|'range', before/after/startDate/endDate: 'YYYY-MM-DD' }
    - repos: list of GitHub repo names to filter by (e.g., ['owner/repo1', 'owner/repo2'])
    - repoBranches: dict mapping repo to branches (e.g., {'owner/repo': ['main', 'dev']})
    - source: filter by source type ('github', 'local', or None for all)
    Uses MetadataTracker for last_modified; falls back to os.stat if needed.
    """
    if not filters or not isinstance(filters, dict):
        return True
    
    # GitHub-specific filters
    if metadata:
        # Filter by source (github vs local files)
        source_filter = filters.get('source')
        if source_filter:
            file_source = metadata.get('source', 'local')  # Default to 'local' for non-GitHub files
            if source_filter == 'github' and file_source != 'github':
                return False
            elif source_filter == 'local' and file_source == 'github':
                return False
        
        # Filter by GitHub repositories
        repos_filter = filters.get('repos')
        if repos_filter and isinstance(repos_filter, list) and len(repos_filter) > 0:
            file_repo = metadata.get('repo')
            if not file_repo or file_repo not in repos_filter:
                return False
        
        # Filter by specific branches within repos
        branches_filter = filters.get('repoBranches')
        if branches_filter and isinstance(branches_filter, dict):
            file_repo = metadata.get('repo')
            file_branch = metadata.get('branch')
            if file_repo and file_repo in branches_filter:
                allowed_branches = branches_filter[file_repo]
                if isinstance(allowed_branches, list) and file_branch not in allowed_branches:
                    return False
                elif isinstance(allowed_branches, str) and allowed_branches != 'all' and file_branch != allowed_branches:
                    return False

    # File types filter with wildcard support
    try:
        wanted_types = filters.get('fileTypes') or []
        if isinstance(wanted_types, list) and len(wanted_types) > 0:
            # Extract filename from path
            filename = os.path.basename(file_path)
            
            # Use new wildcard pattern matching function
            if not _matches_file_patterns(filename, file_path, file_type or '', wanted_types):
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
    """Index selected folders with optional exclusions and size limits"""
    global indexing_status
    
    if indexing_status["is_indexing"]:
        return jsonify({"error": "Indexing already in progress"}), 400
    
    data = request.get_json()
    folders = data.get('folders', [])
    chunking_mode = data.get('chunking_mode', 'gist') # Default to 'gist'
    custom_excludes = data.get('custom_excludes', [])  # User-specified exclusions
    max_size_mb = data.get('max_size_mb', None)  # Max file size in MB
    
    if not folders:
        return jsonify({"error": "No folders provided"}), 400
    
    # Reset cancel flag and indexed files tracking when starting new indexing
    indexing_status["cancel_requested"] = False
    indexing_status["indexed_files_this_session"] = []
    
    # Save settings for future use if exclusions or size limits are provided
    if custom_excludes or max_size_mb:
        folder_settings.save_folder_settings(folders, custom_excludes, max_size_mb or 10, chunking_mode)
    
    # Start indexing in background thread with exclusions
    thread = threading.Thread(
        target=index_folders_background, 
        args=(folders, chunking_mode, custom_excludes, max_size_mb)
    )
    thread.daemon = True
    thread.start()
    
    return jsonify({
        "message": "Indexing started", 
        "folders": folders, 
        "chunking_mode": chunking_mode,
        "custom_excludes": custom_excludes,
        "max_size_mb": max_size_mb
    })

@app.route('/api/index/cancel', methods=['POST'])
def cancel_indexing():
    """Cancel ongoing indexing operation"""
    global indexing_status
    
    if not indexing_status["is_indexing"]:
        return jsonify({"success": False, "message": "No indexing in progress"}), 400
    
    # Set cancel flag
    indexing_status["cancel_requested"] = True
    indexing_status["message"] = "Cancelling indexing..."
    
    return jsonify({"success": True, "message": "Cancel requested, cleaning up..."})

@app.route('/api/scan-folder', methods=['POST'])
def scan_folder_structure():
    """Scan folder structure for exclusion UI (limited depth to avoid performance issues)"""
    try:
        data = request.get_json()
        folder_path = data.get('folder_path')
        
        if not folder_path or not os.path.exists(folder_path):
            return jsonify({"success": False, "error": "Invalid folder path"})
        
        # Scan folder structure with limited depth (max 3 levels to avoid UI overwhelm)
        def scan_directory(path, current_depth=0, max_depth=3):
            if current_depth >= max_depth:
                return None
                
            items = []
            try:
                for item_name in sorted(os.listdir(path)):
                    # Skip hidden files/folders at root level for cleaner UI
                    if current_depth == 0 and item_name.startswith('.'):
                        continue
                        
                    item_path = os.path.join(path, item_name)
                    
                    try:
                        is_dir = os.path.isdir(item_path)
                        item_info = {
                            'path': item_path,
                            'name': item_name,
                            'type': 'directory' if is_dir else 'file'
                        }
                        
                        if not is_dir:
                            # Add file size for files
                            try:
                                item_info['size'] = os.path.getsize(item_path)
                            except:
                                item_info['size'] = 0
                        
                        if is_dir and current_depth < max_depth - 1:
                            # Recursively scan subdirectories
                            children = scan_directory(item_path, current_depth + 1, max_depth)
                            if children:
                                item_info['children'] = children
                        
                        items.append(item_info)
                        
                    except (OSError, PermissionError):
                        # Skip items we can't access
                        continue
                        
            except (OSError, PermissionError):
                # Can't read directory
                return None
            
            return items
        
        tree = scan_directory(folder_path)
        return jsonify({
            "success": True,
            "tree": tree or []
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/api/folder-settings', methods=['POST'])
def get_folder_settings():
    """Get saved settings for a set of folders"""
    try:
        data = request.get_json()
        folders = data.get('folders', [])
        
        if not folders:
            return jsonify({"success": False, "error": "No folders provided"})
        
        # Get exclusions and max size from saved settings
        excludes = folder_settings.get_exclusions_for_folders(folders)
        max_size_mb = folder_settings.get_max_size_for_folders(folders)
        
        return jsonify({
            "success": True,
            "excludes": excludes,
            "max_size_mb": max_size_mb
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

# Import shared filtering utilities to ensure consistency
from filtering_utils import is_hidden_path, matches_exclusion_patterns, filter_hidden_dirs

# filter_hidden_dirs is now imported from filtering_utils.py

# matches_exclusion_patterns is now imported from filtering_utils.py

def index_folders_background(folders, chunking_mode='gist', custom_excludes=None, max_size_mb=None):
    """Background indexing function"""
    global indexing_status, granular_collection, filelevel_collection, gist_collection, gist_centroids_collection, pinpoint_collection
    
    indexing_status.update({
        "is_indexing": True,
        "progress": 0,
        "total_files": 0,
        "current_file": "",
        "message": f"Scanning folders for {chunking_mode} mode...",
        "chunking_mode": chunking_mode,
        "indexing_type": "local"
    })
    
    try:
        # First, scan all folders for files
        all_files = []
        print(f"DEBUG: Scanning folders: {folders}")
        for folder in folders:
            print(f"DEBUG: Checking folder: {folder}, exists: {os.path.exists(folder)}")
            if os.path.exists(folder):
                # Skip if the root folder itself is hidden
                if SKIP_HIDDEN_FILES and is_hidden_path(folder):
                    print(f"DEBUG: Skipping hidden folder: {folder}")
                    continue
                    
                for root, dirs, files in os.walk(folder):
                    # Filter out hidden directories to prevent descent
                    filter_hidden_dirs(dirs)
                    
                    # Filter out excluded directories at walk time for efficiency
                    if custom_excludes:
                        dirs_to_remove = []
                        for d in dirs[:]:  # Create a copy to iterate over
                            dir_path = os.path.join(root, d)
                            # Create repository-relative path for pattern matching
                            if folder in dir_path:
                                relative_path = os.path.relpath(dir_path, folder).replace('\\', '/')
                            else:
                                relative_path = dir_path.replace('\\', '/')
                                
                            if matches_exclusion_patterns(relative_path, custom_excludes) or matches_exclusion_patterns(d, custom_excludes):
                                dirs_to_remove.append(d)
                                print(f"DEBUG: Excluding directory: {relative_path}")
                        
                        # Remove excluded directories from dirs list to prevent os.walk from descending
                        for excluded_dir in dirs_to_remove:
                            dirs.remove(excluded_dir)
                    
                    # Skip files in hidden directories
                    if SKIP_HIDDEN_FILES and is_hidden_path(root):
                        continue
                    
                    for fname in files:
                        file_path = os.path.join(root, fname)
                        
                        # Skip hidden files
                        if SKIP_HIDDEN_FILES and fname.startswith('.'):
                            continue
                        # Skip system files    
                        if SKIP_SYSTEM_FILES and fname.startswith('~'):
                            continue
                        
                        # Skip files matching custom exclusion patterns
                        if custom_excludes:
                            # Create repository-relative path for pattern matching
                            if folder in file_path:
                                relative_path = os.path.relpath(file_path, folder).replace('\\', '/')
                            else:
                                relative_path = file_path.replace('\\', '/')
                                
                            if matches_exclusion_patterns(relative_path, custom_excludes) or matches_exclusion_patterns(fname, custom_excludes):
                                print(f"DEBUG: Excluding file due to pattern: {relative_path}")
                                continue
                            
                        all_files.append((root, fname))
        
        print(f"DEBUG: Found {len(all_files)} total files to scan")
        indexing_status.update({
            "total_files": len(all_files),
            "message": f"Found {len(all_files)} files to index in {chunking_mode} mode"
        })
        
        # Get file paths for metadata checking
        file_paths = [os.path.join(root, fname) for root, fname in all_files]
        print(f"DEBUG: File paths to check: {file_paths[:5]}...")  # Show first 5 files
        
        # Check which files need indexing vs can be skipped
        files_to_index, files_to_skip = metadata_tracker.get_files_to_index(file_paths, chunking_mode)
        
        print(f"DEBUG: Files to index: {len(files_to_index)}, Files to skip: {len(files_to_skip)}")
        
        if files_to_skip:
            indexing_status.update({
                "message": f"+ {len(files_to_skip)} files unchanged, skipping re-indexing"
            })
        
        if not files_to_index:
            print(f"DEBUG: No files to index - exiting early")
            indexing_status.update({
                "is_indexing": False,
                "progress": 100,
                "current_file": "",
                "message": f"All files are up to date in {chunking_mode} mode!",
                "chunking_mode": chunking_mode,
            })
            return
        
        indexing_status.update({
            "message": f"indexing {len(files_to_index)} files in {chunking_mode} mode..."
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
            # Check for cancellation
            if indexing_status["cancel_requested"]:
                print(f"Indexing cancelled at file {file_idx}/{len(all_files)}")
                raise Exception("Indexing cancelled by user")
            
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
            
            # Note: Hidden/system files are already filtered during discovery
            # This check is kept for backward compatibility and extra safety
            if SKIP_HIDDEN_FILES and (fname.startswith('.') or is_hidden_path(fpath)):
                skipped_files += 1
                continue
            if SKIP_SYSTEM_FILES and fname.startswith('~'):
                skipped_files += 1
                continue
            
            # Check file size if limit is set (use custom limit or global limit)
            size_limit = max_size_mb if max_size_mb is not None else MAX_FILE_SIZE_MB
            if size_limit > 0:
                try:
                    file_size_mb = os.path.getsize(fpath) / (1024 * 1024)
                    if file_size_mb > size_limit:
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
                        "chunking_mode": chunking_mode,
                    }],
                    ids=[unique_id]
                )
                chunks_created += 1
            
            # Skip gist-mode centroid/metadata computation to keep gist indexing simple
            
            # Update metadata for this file
            chunk_sizes = [len(line_ranges) for _, line_ranges in chunks]
            metadata_tracker.update_file_metadata(fpath, chunking_mode, len(chunks), chunk_sizes)
            
            # Track this file for potential rollback
            indexing_status["indexed_files_this_session"].append(fpath)
            
            files_indexed += 1
        
        # Note: ChromaDB 1.0+ automatically persists data when using persist_directory
        print("+ ChromaDB data will be automatically persisted")
        
        # Update final status
        indexing_status.update({
            "is_indexing": False,
            "progress": 100,
            "current_file": "",
            "message": f"Indexing complete! {files_indexed} files indexed in {chunking_mode} mode, {chunks_created} chunks created",
            "chunking_mode": chunking_mode,
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
        # Handle cancellation vs other errors
        if indexing_status["cancel_requested"]:
            # Cancellation cleanup - remove all files indexed in this session
            print(f"Performing complete rollback for cancelled indexing...")
            
            indexed_files = indexing_status.get("indexed_files_this_session", [])
            if indexed_files:
                print(f"Rolling back {len(indexed_files)} files that were indexed before cancellation")
                cleanup_count = cleanup_indexed_files_for_cancellation(indexed_files, chunking_mode)
                print(f"Cleanup complete: {cleanup_count} files removed from index")
            else:
                print("No files to clean up - indexing was cancelled before any files were processed")
            
            indexing_status.update({
                "is_indexing": False,
                "cancel_requested": False,  # Reset cancel flag
                "progress": 0,
                "current_file": "",
                "message": f"Indexing cancelled and rolled back. All changes undone.",
                "chunking_mode": chunking_mode,
                "indexed_files_this_session": []  # Clear tracked files
            })
        else:
            # Other error
            indexing_status.update({
                "is_indexing": False,
                "message": f"Error during indexing: {str(e)}",
                "chunking_mode": chunking_mode,
            })

def cleanup_indexed_files_for_cancellation(file_paths, chunking_mode):
    """
    Remove all chunks and metadata for files that were indexed in the current session
    Used when indexing is cancelled to restore the state to before indexing started
    Handles both local files and GitHub repository files
    """
    global gist_collection, pinpoint_collection
    
    if not file_paths:
        return 0
    
    # Select the appropriate collection
    if chunking_mode == 'gist':
        collection = gist_collection
    elif chunking_mode == 'pinpoint':
        collection = pinpoint_collection
    else:
        print(f"Warning: Unknown chunking mode for cleanup: {chunking_mode}")
        return 0
    
    removed_chunks = 0
    removed_files = 0
    
    try:
        for file_path in file_paths:
            # Remove chunks from ChromaDB (works for both local and GitHub files)
            try:
                existing_results = collection.get(where={"path": file_path})
                if existing_results and existing_results.get('ids'):
                    chunk_ids = existing_results['ids']
                    collection.delete(ids=chunk_ids)
                    removed_chunks += len(chunk_ids)
                    print(f"CLEANUP: Removed {len(chunk_ids)} chunks for {os.path.basename(file_path)}")
            except Exception as e:
                print(f"Error removing chunks for {os.path.basename(file_path)}: {e}")
            
            # Remove from metadata tracker (only for local files, GitHub files don't use metadata_tracker)
            try:
                # Check if this is a local file (not a GitHub repository path)
                if not ('/.filesearcher/repos/' in file_path):
                    metadata_tracker.remove_file_metadata(file_path)
                    print(f"CLEANUP: Removed metadata for {os.path.basename(file_path)}")
                else:
                    print(f"CLEANUP: Skipped metadata removal for GitHub file: {os.path.basename(file_path)}")
                removed_files += 1
            except Exception as e:
                print(f"Error removing metadata for {os.path.basename(file_path)}: {e}")
        
        print(f"CLEANUP COMPLETE: Removed {removed_chunks} chunks and cleaned up {removed_files} files")
        return removed_files
        
    except Exception as e:
        print(f"Error during cleanup: {e}")
        return 0

def delete_github_file_chunks(full_name, branch, file_path, chunking_mode):
    """
    Delete all chunks for a specific GitHub file
    
    Args:
        full_name: GitHub repo full name (owner/repo)
        branch: Branch name
        file_path: Relative path of the file in the repo
        chunking_mode: 'gist' or 'pinpoint'
    """
    global gist_collection, pinpoint_collection
    
    try:
        # Select the appropriate collection
        if chunking_mode == 'gist':
            collection = gist_collection
        elif chunking_mode == 'pinpoint':
            collection = pinpoint_collection
        else:
            return
        
        # Find all chunks with this file path
        # The ID pattern is: gh://owner/repo@branch:relative/path-chunk_idx
        id_prefix = f"gh://{full_name}@{branch}:{file_path}"
        
        # Get all IDs that match this prefix
        results = collection.get(
            where={"$and": [
                {"source": "github"},
                {"repo": full_name},
                {"branch": branch},
                {"file_path": file_path}
            ]}
        )
        
        if results and results.get("ids"):
            # Delete all matching chunks
            collection.delete(ids=results["ids"])
            print(f"Deleted {len(results['ids'])} chunks for {file_path} in {chunking_mode} mode")
    
    except Exception as e:
        print(f"ERROR: Failed to delete chunks for {file_path}: {e}")

def index_github_files(repo_path, full_name, branch, file_list, chunking_mode='gist', custom_excludes=None, max_size_mb=None):
    """
    Index specific files from a GitHub repository
    
    Args:
        repo_path: Local path to the cloned repository
        full_name: GitHub repo full name (owner/repo)
        branch: Current branch being indexed
        file_list: List of relative file paths to index
        chunking_mode: 'gist' or 'pinpoint'
        custom_excludes: List of patterns to exclude
        max_size_mb: Maximum file size in MB
    """
    global gist_collection, pinpoint_collection
    
    import subprocess
    import time
    import os
    
    # Get current commit SHA
    try:
        commit_sha = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'],
            cwd=repo_path,
            text=True
        ).strip()
    except:
        commit_sha = "unknown"
    
    # Select the appropriate collection and chunking function
    if chunking_mode == 'gist':
        target_collection = gist_collection
        chunking_function = create_gist_chunks
    elif chunking_mode == 'pinpoint':
        target_collection = pinpoint_collection
        chunking_function = create_pinpoint_chunks
    else:
        return
    
    current_timestamp = int(time.time())
    files_indexed = 0
    chunks_created = 0
    
    # Get the appropriate model
    current_model = get_model_for_mode(chunking_mode)
    
    for relative_path in file_list:
        full_path = os.path.join(repo_path, relative_path)
        
        # Skip if file doesn't exist
        if not os.path.exists(full_path):
            continue
        
        # Skip if excluded
        if custom_excludes and matches_exclusion_patterns(relative_path, custom_excludes):
            continue
        
        # Check file size
        size_limit = max_size_mb if max_size_mb is not None else MAX_FILE_SIZE_MB
        if size_limit > 0:
            try:
                file_size_mb = os.path.getsize(full_path) / (1024 * 1024)
                if file_size_mb > size_limit:
                    continue
            except:
                continue
        
        # Extract text content
        content = extract_text(full_path)
        if not content.strip() or len(content.strip()) < MIN_CONTENT_LENGTH:
            continue
        
        fname = os.path.basename(relative_path)
        file_ext = os.path.splitext(fname)[1].lower()
        
        # Create chunks
        chunks = chunking_function(content, file_ext)
        if not chunks:
            continue
        
        # Index chunks with GitHub-specific metadata
        for chunk_idx, (chunk_text, line_ranges) in enumerate(chunks):
            embedding = current_model.encode(chunk_text)
            
            # GitHub-specific doc_id format
            unique_id = f"gh://{full_name}@{branch}:{relative_path}-{chunk_idx+1}"
            
            # GitHub-specific metadata
            metadata = {
                "source": "github",
                "repo": full_name,
                "branch": branch,
                "file_path": relative_path,
                "commit_sha": commit_sha,
                "last_indexed_at": current_timestamp,
                "path": full_path,
                "fname": fname,
                "file_type": file_ext,
                "chunk_id": chunk_idx + 1,
                "chunk_index": chunk_idx + 1,
                "line_ranges": str(line_ranges),
                "chunk_size": len(line_ranges),
                "chunking_mode": chunking_mode,
            }
            
            target_collection.add(
                embeddings=[embedding],
                documents=[chunk_text],
                metadatas=[metadata],
                ids=[unique_id]
            )
            chunks_created += 1
        
        files_indexed += 1
    
    print(f"Indexed {files_indexed} files, {chunks_created} chunks for sync")

def index_github_repository(repo_path, full_name, branch, chunking_mode='gist', custom_excludes=None, max_size_mb=None):
    """
    GitHub-specific indexing function that adds proper metadata and uses gh:// prefixed IDs
    
    Args:
        repo_path: Local path to the cloned repository
        full_name: GitHub repo full name (owner/repo)
        branch: Current branch being indexed
        chunking_mode: 'gist', 'pinpoint', or 'both' (handled by caller)
        custom_excludes: List of patterns to exclude
        max_size_mb: Maximum file size in MB
    """
    global indexing_status, gist_collection, pinpoint_collection
    
    import subprocess
    import time
    
    # Get current commit SHA
    try:
        commit_sha = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'],
            cwd=repo_path,
            text=True
        ).strip()
    except:
        commit_sha = "unknown"
    
    indexing_status.update({
        "is_indexing": True,
        "progress": 0,
        "total_files": 0,
        "current_file": "",
        "message": f"Scanning GitHub repository {full_name} for {chunking_mode} mode...",
        "chunking_mode": chunking_mode,
        "indexing_type": "github"
    })
    
    try:
        # Scan repository for files
        all_files = []
        print(f"DEBUG GITHUB: Scanning GitHub repo: {repo_path}")
        print(f"DEBUG GITHUB: Repo exists: {os.path.exists(repo_path)}")
        
        if os.path.exists(repo_path):
            print(f"DEBUG GITHUB: Starting os.walk on {repo_path}")
            print(f"DEBUG GITHUB: SKIP_HIDDEN_FILES = {SKIP_HIDDEN_FILES}")
            print(f"DEBUG GITHUB: custom_excludes = {custom_excludes}")
            
            for root, dirs, files in os.walk(repo_path):
                relative_root = os.path.relpath(root, repo_path).replace('\\', '/')
                print(f"DEBUG GITHUB: Walking {relative_root} (abs: {root})")
                print(f"DEBUG GITHUB: - Found {len(dirs)} directories: {dirs}")
                print(f"DEBUG GITHUB: - Found {len(files)} files: {files[:10]}{'...' if len(files) > 10 else ''}")
                
                # Store original dirs for comparison
                original_dirs = dirs.copy()
                
                # Filter out hidden directories
                filter_hidden_dirs(dirs)
                if len(dirs) != len(original_dirs):
                    removed_hidden = set(original_dirs) - set(dirs)
                    print(f"DEBUG GITHUB: Filtered out hidden dirs: {removed_hidden}")
                
                # Filter out excluded directories
                if custom_excludes:
                    dirs_before_exclusion = dirs.copy()
                    dirs_to_remove = []
                    for d in dirs[:]:
                        dir_path = os.path.join(root, d)
                        relative_dir_path = os.path.relpath(dir_path, repo_path).replace('\\', '/')
                        
                        if matches_exclusion_patterns(relative_dir_path, custom_excludes) or matches_exclusion_patterns(d, custom_excludes):
                            dirs_to_remove.append(d)
                            print(f"DEBUG GITHUB: Excluding directory: {relative_dir_path}")
                    
                    for excluded_dir in dirs_to_remove:
                        dirs.remove(excluded_dir)
                    
                    if len(dirs) != len(dirs_before_exclusion):
                        removed_excluded = set(dirs_before_exclusion) - set(dirs)
                        print(f"DEBUG GITHUB: Excluded dirs: {removed_excluded}")
                
                print(f"DEBUG GITHUB: Final dirs to traverse: {dirs}")
                
                # Skip hidden directories (but not the root repo directory itself)
                if SKIP_HIDDEN_FILES and root != repo_path:
                    if is_hidden_path(relative_root):
                        print(f"DEBUG GITHUB: Skipping hidden directory: {relative_root}")
                        continue
                
                print(f"DEBUG GITHUB: working on {len(files)} files in {relative_root}")
                for fname in files:
                    file_path = os.path.join(root, fname)
                    relative_file_path = os.path.relpath(file_path, repo_path).replace('\\', '/')
                    
                    # Debug each file decision
                    reasons_skipped = []
                    
                    # Skip hidden files
                    if SKIP_HIDDEN_FILES and fname.startswith('.'):
                        reasons_skipped.append("hidden file")
                        continue
                    # Skip system files
                    if SKIP_SYSTEM_FILES and fname.startswith('~'):
                        reasons_skipped.append("system file")
                        continue
                    
                    # Skip files matching exclusion patterns
                    if custom_excludes:
                        if matches_exclusion_patterns(relative_file_path, custom_excludes):
                            reasons_skipped.append(f"excluded by path pattern")
                            print(f"DEBUG GITHUB: Excluding file by path pattern: {relative_file_path}")
                            continue
                        if matches_exclusion_patterns(fname, custom_excludes):
                            reasons_skipped.append(f"excluded by filename pattern")
                            print(f"DEBUG GITHUB: Excluding file by filename pattern: {fname} in {relative_file_path}")
                            continue
                    
                    all_files.append((file_path, relative_file_path, fname))
                    if len(all_files) <= 10:  # Log first 10 files with their paths
                        print(f"DEBUG GITHUB: Added file #{len(all_files)}: {relative_file_path}")
                    
                print(f"DEBUG GITHUB: Completed directory {relative_root}, total files so far: {len(all_files)}")
        else:
            print(f"ERROR GITHUB: Repository path does not exist: {repo_path}")
        
        print(f"DEBUG: Found {len(all_files)} files in GitHub repo")
        
        indexing_status.update({
            "total_files": len(all_files),
            "message": f"indexing {len(all_files)} files from {full_name} in {chunking_mode} mode"
        })
        
        # Select the appropriate collection and chunking function
        if chunking_mode == 'gist':
            target_collection = gist_collection
            chunking_function = create_gist_chunks
            mode_description = "gist (large chunks)"
        elif chunking_mode == 'pinpoint':
            target_collection = pinpoint_collection
            chunking_function = create_pinpoint_chunks
            mode_description = "pinpoint (small chunks)"
        else:
            # Fallback to gist
            target_collection = gist_collection
            chunking_function = create_gist_chunks
            mode_description = "gist (default)"
        
        files_indexed = 0
        chunks_created = 0
        skipped_files = 0
        current_timestamp = int(time.time())
        actually_indexed_files = []  # Track files that were actually processed
        
        # Process each file
        for file_idx, (full_path, relative_path, fname) in enumerate(all_files):
            # Check for cancellation
            if indexing_status["cancel_requested"]:
                print(f"GitHub indexing cancelled at file {file_idx}/{len(all_files)}")
                raise Exception("Indexing cancelled by user")
            
            file_ext = os.path.splitext(fname)[1].lower()
            
            print(f"DEBUG GITHUB: file {file_idx+1}/{len(all_files)}: {relative_path}")
            
            # Update progress
            indexing_status.update({
                "progress": (file_idx / len(all_files)) * 100,
                "current_file": relative_path,
                "message": f"Indexing {relative_path} from {full_name} in {mode_description} mode..."
            })
            
            # Check file size
            size_limit = max_size_mb if max_size_mb is not None else MAX_FILE_SIZE_MB
            if size_limit > 0:
                try:
                    file_size_mb = os.path.getsize(full_path) / (1024 * 1024)
                    if file_size_mb > size_limit:
                        print(f"DEBUG GITHUB: Skipping large file: {relative_path} ({file_size_mb:.2f}MB)")
                        skipped_files += 1
                        continue
                except OSError:
                    print(f"DEBUG GITHUB: Error getting file size for {relative_path}")
                    continue
            
            # Extract text content
            print(f"DEBUG GITHUB: Extracting text from {relative_path}")
            content = extract_text(full_path)
            if not content.strip() or len(content.strip()) < MIN_CONTENT_LENGTH:
                print(f"DEBUG GITHUB: Skipping file with no/little content: {relative_path}")
                skipped_files += 1
                continue
            
            print(f"DEBUG GITHUB: Extracted {len(content)} chars from {relative_path}")
            
            # Create chunks
            print(f"DEBUG GITHUB: Creating chunks with {chunking_function.__name__} for {relative_path}")
            chunks = chunking_function(content, file_ext)
            if not chunks:
                print(f"DEBUG GITHUB: No chunks created for {relative_path}")
                skipped_files += 1
                continue
            
            print(f"DEBUG GITHUB: Created {len(chunks)} chunks for {relative_path}")
            
            # Get the appropriate model
            current_model = get_model_for_mode(chunking_mode)
            print(f"DEBUG GITHUB: Using model: {current_model}")
            
            # Index chunks with GitHub-specific metadata
            for chunk_idx, (chunk_text, line_ranges) in enumerate(chunks):
                try:
                    print(f"DEBUG GITHUB: chunk {chunk_idx+1}/{len(chunks)} for {relative_path}")
                    
                    embedding = current_model.encode(chunk_text)
                    print(f"DEBUG GITHUB: Generated embedding of shape {embedding.shape if hasattr(embedding, 'shape') else 'unknown'}")
                    
                    # GitHub-specific doc_id format: gh://owner/repo@branch:relative/path-chunk_idx
                    unique_id = f"gh://{full_name}@{branch}:{relative_path}-{chunk_idx+1}"
                    
                    # GitHub-specific metadata
                    metadata = {
                        # GitHub-specific fields
                        "source": "github",
                        "repo": full_name,
                        "branch": branch,
                        "file_path": relative_path,
                        "commit_sha": commit_sha,
                        "last_indexed_at": current_timestamp,
                        
                        # Standard fields (for compatibility)
                        "path": full_path,
                        "fname": fname,
                        "file_type": file_ext,
                        "chunk_id": chunk_idx + 1,
                        "chunk_index": chunk_idx + 1,
                        "line_ranges": str(line_ranges),
                        "chunk_size": len(line_ranges),
                        "chunking_mode": chunking_mode
                    }
                    
                    print(f"DEBUG GITHUB: Adding chunk {unique_id} to collection {target_collection}")
                    print(f"DEBUG GITHUB: Metadata: source={metadata['source']}, repo={metadata['repo']}, branch={metadata['branch']}")
                    
                    target_collection.add(
                        embeddings=[embedding],
                        documents=[chunk_text],
                        metadatas=[metadata],
                        ids=[unique_id]
                    )
                    chunks_created += 1
                    print(f"DEBUG GITHUB: added chunk {unique_id}")
                    
                except Exception as e:
                    print(f"ERROR GITHUB: Failed to add chunk {chunk_idx+1} for {relative_path}: {e}")
                    import traceback
                    traceback.print_exc()
            
            files_indexed += 1
            actually_indexed_files.append(relative_path)  # Track this file as successfully indexed
            
            # Also track for potential rollback (use full path for GitHub files)
            github_full_path = full_path  # This is the actual file path we index
            indexing_status["indexed_files_this_session"].append(github_full_path)
            
            print(f"DEBUG GITHUB: Completed file {relative_path} - {len(chunks)} chunks")
        
        # Update final status
        indexing_status.update({
            "is_indexing": False,
            "progress": 100,
            "current_file": "",
            "message": f"GitHub repo {full_name} indexed: {files_indexed} files, {chunks_created} chunks in {chunking_mode} mode",
            "chunking_mode": chunking_mode,
        })
        
        print(f"✅ GitHub indexing complete for {full_name}@{branch}: {files_indexed} files, {chunks_created} chunks, {skipped_files} skipped")
        
        # Update branch manifest with actually indexed files
        if files_indexed > 0 and actually_indexed_files:
            try:
                manifest = manifest_manager.get_manifest(full_name, branch)
                manifest.update_file_manifest(repo_path, actually_indexed_files, commit_sha)
                print(f"📋 Updated branch manifest for {full_name}@{branch} with {len(actually_indexed_files)} files")
            except Exception as e:
                print(f"WARNING: Failed to update branch manifest: {e}")
        
        return {
            "success": True,
            "files_indexed": files_indexed,
            "chunks_created": chunks_created,
            "skipped_files": skipped_files,
            "commit_sha": commit_sha
        }
        
    except Exception as e:
        error_msg = f"GitHub indexing failed: {str(e)}"
        print(f"ERROR: {error_msg}")
        import traceback
        traceback.print_exc()
        
        indexing_status.update({
            "is_indexing": False,
            "message": error_msg,
            "chunking_mode": chunking_mode,
        })
        
        return {
            "success": False,
            "error": error_msg
        }

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
                if not file_matches_filters(file_path, meta.get("file_type", ""), filters, meta):
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
                "chunking_mode": chunking_mode,
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
                if not file_matches_filters(file_path, meta.get("file_type", ""), filters, meta):
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
            "chunking_mode": chunking_mode,
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
                    "chunking_mode": chunking_mode,
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
        
        print(f"reindexed {file_path} in {chunking_mode} mode: {chunks_created} chunks created")
        
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
                    "chunking_mode": chunking_mode,
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
                    "chunking_mode": chunking_mode,
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
                "chunking_mode": chunking_mode,
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
                "chunking_mode": chunking_mode,
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
            "chunking_mode": chunking_mode,
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
            print(f"DEBUG: folder: {folder_path} with modes: {folder_info['chunking_modes']}")
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
        "chunking_mode": chunking_mode,
        "indexing_type": "local",
        "cancel_requested": False,  # Reset cancel flag
        "indexed_files_this_session": []  # Reset tracked files for rollback
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
            # Check for cancellation
            if indexing_status["cancel_requested"]:
                print(f"Sync cancelled at file {i}/{len(files_to_sync)}")
                raise Exception("Sync cancelled by user")
            
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
                operation = "working on"
            
            indexing_status.update({
                "progress": (i / len(files_to_sync)) * 100,
                "current_file": os.path.basename(file_path),
                "message": f"{operation} {os.path.basename(file_path)}..."
            })
            
            try:
                if event_type == 'deleted':
                    print(f"SYNC DEBUG: deleting {os.path.basename(file_path)}")
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
                    print(f"SYNC DEBUG: {event_type} {os.path.basename(file_path)}")
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
            "chunking_mode": chunking_mode,
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
        # Handle cancellation vs other errors
        if indexing_status["cancel_requested"]:
            # Cancellation cleanup - rollback sync changes
            print(f"Sync cancelled - performing rollback...")
            
            # For sync operations, we need to rollback files that were updated/added during this sync
            indexed_files = indexing_status.get("indexed_files_this_session", [])
            if indexed_files:
                print(f"Rolling back {len(indexed_files)} files that were synced before cancellation")
                cleanup_count = cleanup_indexed_files_for_cancellation(indexed_files, chunking_mode)
                print(f"Sync rollback complete: {cleanup_count} files removed from index")
            
            indexing_status.update({
                "is_indexing": False,
                "cancel_requested": False,  # Reset cancel flag
                "progress": 0,
                "current_file": "",
                "message": f"Sync cancelled and rolled back. All changes undone.",
                "chunking_mode": chunking_mode,
                "indexed_files_this_session": []  # Clear tracked files
            })
        else:
            # Other error
            print(f"Fatal sync error: {e}")
            import traceback
            traceback.print_exc()
            
            # Don't clear entire queue on error
            indexing_status.update({
                "is_indexing": False,
                "progress": 0,
                "current_file": "",
                "message": f"Sync failed: {str(e)}",
                "chunking_mode": chunking_mode,
            })

def _handle_file_deletion(file_path: str, chunking_mode: str, collection) -> bool:
    """Handle file deletion with proper cleanup for specific chunking mode"""
    try:
        print(f"🗑️ DELETING: {os.path.basename(file_path)} from {chunking_mode} mode")
        
        # Remove from ChromaDB for this specific mode
        existing_results = collection.get(where={"path": file_path})
        if existing_results['ids']:
            collection.delete(ids=existing_results['ids'])
            print(f"Deleted {len(existing_results['ids'])} chunks from ChromaDB")
        else:
            print(f"No chunks found in ChromaDB for {os.path.basename(file_path)}")
        
        # Remove from metadata for this specific mode
        # Check if file exists in other modes before full removal
        if metadata_tracker.has_file_in_mode(file_path, chunking_mode):
            # Check if file exists in any other mode
            other_modes_exist = False
            if file_path in metadata_tracker.metadata:
                file_info = metadata_tracker.metadata[file_path]
                if 'modes' in file_info:
                    for mode in file_info['modes']:
                        if mode != chunking_mode:
                            other_modes_exist = True
                            break
            
            if other_modes_exist:
                # Remove only this mode's metadata
                metadata_tracker.remove_file_metadata(file_path, chunking_mode)
                print(f"Removed {chunking_mode} mode metadata (file exists in other modes)")
            else:
                # Remove entire file metadata
                metadata_tracker.remove_file_metadata(file_path)
                print(f"Removed all metadata for {os.path.basename(file_path)}")
        
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
        
        # STEP 1: Delete ALL existing chunks for this file (comprehensive deletion)
        print(f"🗑️ STEP 1: Deleting existing chunks for {os.path.basename(file_path)}")
        
        total_deleted = 0
        paths_to_try = [
            file_path,
            os.path.normpath(file_path),
            os.path.abspath(file_path)
        ]
        
        # Try all possible path variations
        for path_variant in paths_to_try:
            try:
                existing_results = collection.get(where={"path": path_variant})
                if existing_results['ids']:
                    print(f"  Found {len(existing_results['ids'])} chunks with path: {path_variant}")
                    collection.delete(ids=existing_results['ids'])
                    total_deleted += len(existing_results['ids'])
            except Exception as e:
                print(f"  Error deleting chunks for path {path_variant}: {e}")
        
        # Also try to delete by filename pattern (in case there are ID conflicts)
        try:
            fname = os.path.basename(file_path)
            filename_results = collection.get(where={"fname": fname})
            if filename_results['ids']:
                # Filter to only delete chunks that actually match our file path
                ids_to_delete = []
                for i, metadata in enumerate(filename_results['metadatas']):
                    if metadata and metadata.get('path') in paths_to_try:
                        ids_to_delete.append(filename_results['ids'][i])
                
                if ids_to_delete:
                    print(f"  Found {len(ids_to_delete)} additional chunks by filename")
                    collection.delete(ids=ids_to_delete)
                    total_deleted += len(ids_to_delete)
        except Exception as e:
            print(f"  Error deleting by filename: {e}")
        
        print(f"✅ TOTAL DELETED: {total_deleted} old chunks for {os.path.basename(file_path)}")
        
        # Verify deletion worked
        verification_results = collection.get(where={"path": file_path})
        remaining_chunks = len(verification_results['ids']) if verification_results['ids'] else 0
        if remaining_chunks > 0:
            print(f"⚠️ WARNING: {remaining_chunks} chunks still remain after deletion attempt!")
        else:
            print(f"✅ CONFIRMED: All old chunks deleted successfully")
        
        # Skip centroid deletion in simplified gist mode
        
        # STEP 2: Reindex the file as if it's new
        print(f"📝 STEP 2: Reindexing {os.path.basename(file_path)} as new file")
        
        # Extract content
        print(f"📄 Extracting content from {os.path.basename(file_path)}...")
        content = extract_text(file_path)
        if not content.strip():
            print(f"⚠️ WARNING: File {file_path} extracted no content, using placeholder")
            content = f"[Empty or unreadable content from {os.path.basename(file_path)}]"
        else:
            print(f"✅ Extracted {len(content)} characters from {os.path.basename(file_path)}")
        
        file_ext = os.path.splitext(file_path)[1].lower()
        
        # Create chunks
        print(f"✂️ Creating chunks using {chunking_function.__name__} for {os.path.basename(file_path)}...")
        chunks = chunking_function(content, file_ext)
        if not chunks:
            print(f"⚠️ WARNING: No chunks created for {file_path}, creating fallback")
            chunks = [(content[:1000] if content else f"[Fallback content for {os.path.basename(file_path)}]", [1])]
        else:
            print(f"✅ Created {len(chunks)} chunks for {os.path.basename(file_path)}")
        
        # Add new chunks
        current_model = get_model_for_mode(chunking_mode)
        chunk_embeddings = []
        chunks_added = 0
        
        for chunk_idx, (chunk_text, line_ranges) in enumerate(chunks):
            try:
                embedding = current_model.encode(chunk_text)
                
                if chunking_mode == 'gist':
                    from main import normalize_embedding
                    normalized_embedding = normalize_embedding(embedding)
                    chunk_embeddings.append(normalized_embedding)
                
                unique_id = f"{chunking_mode}-{file_path}-{chunk_idx+1}"
                
                print(f"  Adding chunk {chunk_idx+1}/{len(chunks)}: {len(chunk_text)} chars, ID: {unique_id[:50]}...")
                
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
                        "chunking_mode": chunking_mode,
                    }],
                    ids=[unique_id]
                )
                chunks_added += 1
                print(f"  ✅ Successfully added chunk {chunk_idx+1}")
                
            except Exception as e:
                print(f"❌ ERROR: Failed to add chunk {chunk_idx+1} for {os.path.basename(file_path)}: {e}")
                import traceback
                traceback.print_exc()
                # Don't raise - continue with other chunks but return False at the end
                print(f"Continuing with remaining chunks...")
                continue
        
        print(f"📊 SUMMARY: Added {chunks_added}/{len(chunks)} chunks for {os.path.basename(file_path)}")
        
        # Verify chunks were actually added to ChromaDB
        verification_results = collection.get(where={"path": file_path})
        actual_chunks_in_db = len(verification_results['ids']) if verification_results['ids'] else 0
        print(f"🔍 VERIFICATION: {actual_chunks_in_db} chunks now in ChromaDB for {os.path.basename(file_path)}")
        
        if chunks_added == 0 or actual_chunks_in_db == 0:
            print(f"❌ CRITICAL ERROR: No chunks were successfully added to ChromaDB!")
            return False
        
        # Skip gist-mode centroid/metadata computation in simplified gist mode
        
        # Update metadata
        chunk_sizes = [len(line_ranges) for _, line_ranges in chunks]
        metadata_tracker.update_file_metadata(file_path, chunking_mode, len(chunks), chunk_sizes)
        
        # Track this file for potential rollback during sync operations
        indexing_status["indexed_files_this_session"].append(file_path)
        
        if actual_chunks_in_db != len(chunks):
            print(f"⚠️ WARNING: Expected {len(chunks)} chunks but found {actual_chunks_in_db} in DB")
        
        print(f"🎉 SUCCESS: File {os.path.basename(file_path)} updated successfully - {actual_chunks_in_db} chunks in DB")
        return True
        
    except Exception as e:
        print(f"❌ CRITICAL ERROR: Failed to update file {file_path}: {e}")
        import traceback
        traceback.print_exc()
        
        # Try to verify if the file still has chunks in DB after the error
        try:
            verification_results = collection.get(where={"path": file_path})
            chunks_in_db = len(verification_results['ids']) if verification_results['ids'] else 0
            print(f"🔍 POST-ERROR VERIFICATION: {chunks_in_db} chunks remain in ChromaDB for {os.path.basename(file_path)}")
        except:
            print(f"⚠️ Could not verify ChromaDB state after error")
        
        return False

# =============================================================================
# Helper Functions
# =============================================================================

def index_folders_internal(folders, chunking_mode='gist', custom_excludes=None, max_size_mb=None):
    """Internal helper for indexing folders synchronously"""
    try:
        # Run indexing in a background thread and wait for completion
        import threading
        import time
        
        # Start indexing
        thread = threading.Thread(target=index_folders_background, args=(folders, chunking_mode, custom_excludes, max_size_mb))
        thread.start()
        
        # Wait for completion (check every second)
        while thread.is_alive():
            time.sleep(1)
            
        # Check if indexing was successful
        if indexing_status["is_indexing"]:
            return {"success": False, "error": "Indexing did not complete properly"}
            
        return {"success": True, "message": f"Indexing completed for {len(folders)} folders"}
        
    except Exception as e:
        return {"success": False, "error": str(e)}

# =============================================================================
# GitHub API Endpoints
# =============================================================================

@app.route('/api/github/auth/status', methods=['GET'])
def github_auth_status():
    """Get GitHub authentication status"""
    try:
        status = github_integration.get_auth_status()
        return jsonify(status)
    except Exception as e:
        return jsonify({"connected": False, "error": str(e)}), 500

@app.route('/api/github/auth/start', methods=['POST'])
def github_auth_start():
    """Start GitHub OAuth device flow"""
    try:
        result = github_integration.start_device_flow_auth()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/auth/poll', methods=['POST'])
def github_auth_poll():
    """Poll for GitHub OAuth completion"""
    try:
        result = github_integration.poll_for_token()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/auth/logout', methods=['POST'])
def github_logout():
    """Logout from GitHub"""
    try:
        result = github_integration.logout()
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/repos', methods=['POST'])
def github_get_repos():
    """Get user's GitHub repositories"""
    try:
        data = request.get_json() or {}
        page = data.get('page', 1)
        print(f"DEBUG: API github_get_repos called with page: {page}")
        result = github_integration.get_repositories(page)
        print(f"DEBUG: API github_get_repos result: {result}")
        return jsonify(result)
    except Exception as e:
        print(f"DEBUG: API github_get_repos exception: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"repos": [], "has_more": False, "total_count": 0, "error": str(e)}), 500

@app.route('/api/github/clone', methods=['POST'])
def github_clone_repo():
    """Clone a GitHub repository with progress tracking"""
    try:
        data = request.get_json()
        full_name = data.get('full_name')
        if not full_name:
            return jsonify({"success": False, "error": "full_name is required"}), 400
        
        # Use the global indexing status to track cloning progress
        def progress_callback(message: str, progress: float):
            indexing_status.update({
                "is_indexing": True,
                "progress": progress,
                "current_file": full_name,
                "message": f"Cloning {full_name}: {message}",
                "chunking_mode": "clone",
            })
        
        # Start cloning
        indexing_status.update({
            "is_indexing": True,
            "progress": 0,
            "current_file": full_name,
            "message": f"Starting clone of {full_name}...",
            "chunking_mode": "clone",
        })
            
        result = github_integration.clone_repository(full_name, progress_callback)
        
        # Update status when done
        if result.get("success"):
            indexing_status.update({
                "is_indexing": False,
                "progress": 100,
                "current_file": "",
                "message": f"cloned {full_name}",
                "chunking_mode": "clone",
            })
        else:
            indexing_status.update({
                "is_indexing": False,
                "progress": 0,
                "current_file": "",
                "message": f"Failed to clone {full_name}: {result.get('error', 'Unknown error')}",
                "chunking_mode": "clone",
            })
            
        return jsonify(result)
    except Exception as e:
        indexing_status.update({
            "is_indexing": False,
            "progress": 0,
            "current_file": "",
            "message": f"Clone error: {str(e)}",
            "chunking_mode": "clone",
        })
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/clone/cancel', methods=['POST'])
def github_cancel_clone():
    """Cancel ongoing clone operation"""
    try:
        # Reset indexing status
        indexing_status.update({
            "is_indexing": False,
            "progress": 0,
            "current_file": "",
            "message": "Clone cancelled",
            "chunking_mode": "",
        })
        return jsonify({"success": True, "message": "Clone cancelled"})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/connected-repos', methods=['GET'])
def github_get_connected_repos():
    """Get list of connected repositories with their status"""
    try:
        connected_repos = github_integration.load_connected_repos()
        return jsonify({"repos": connected_repos})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/retry-repo', methods=['POST'])
def github_retry_repo():
    """Retry failed repository operation (clone or index)"""
    try:
        data = request.get_json()
        full_name = data.get('full_name')
        if not full_name:
            return jsonify({"success": False, "error": "full_name is required"}), 400
        
        # Get current repo status
        connected_repos = github_integration.load_connected_repos()
        repo = next((r for r in connected_repos if r["full_name"] == full_name), None)
        
        if not repo:
            return jsonify({"success": False, "error": "Repository not found"}), 404
        
        if repo["status"] == "clone_failed":
            # Retry cloning
            github_integration.update_repo_status(full_name, "cloning")
            
            def progress_callback(message: str, progress: float):
                indexing_status.update({
                    "is_indexing": True,
                    "progress": progress,
                    "current_file": full_name,
                    "message": f"Retrying clone {full_name}: {message}",
                    "chunking_mode": "clone",
                })
            
            result = github_integration.clone_repository(full_name, progress_callback)
            
            # Reset indexing status
            indexing_status.update({
                "is_indexing": False,
                "progress": 0,
                "current_file": "",
                "message": "Ready",
                "chunking_mode": "",
            })
            
            return jsonify(result)
            
        elif repo["status"] in ["cloned", "index_failed"]:
            # Repository is cloned but needs indexing
            return jsonify({
                "success": True, 
                "message": "Repository ready for indexing",
                "needs_indexing": True,
                "repo": repo
            })
        
        else:
            return jsonify({"success": False, "error": f"Cannot retry repository in status: {repo['status']}"})
            
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/file-tree', methods=['GET'])
def github_get_file_tree():
    """Get file tree for cloned repository"""
    try:
        full_name = request.args.get('full_name')
        if not full_name:
            return jsonify({"success": False, "error": "full_name is required"}), 400
            
        result = github_integration.get_local_file_tree(full_name)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/checkout', methods=['POST'])
def github_checkout_branch():
    """Checkout a branch in cloned repository"""
    try:
        data = request.get_json()
        full_name = data.get('full_name')
        branch_name = data.get('branch_name')
        
        if not full_name or not branch_name:
            return jsonify({"success": False, "error": "full_name and branch_name are required"}), 400
            
        result = github_integration.checkout_local_branch(full_name, branch_name)
        
        if result.get("success"):
            # Update connected repo configuration with new active branch
            connected_repos = github_integration.load_connected_repos()
            updated = False
            for repo in connected_repos:
                if repo["full_name"] == full_name:
                    repo["active_branch"] = branch_name
                    updated = True
                    break
            
            if updated:
                # Save updated configuration
                try:
                    import json
                    with open(github_integration.connected_repos_file, 'w') as f:
                        json.dump(connected_repos, f, indent=2)
                    print(f"✅ Updated active branch for {full_name} to {branch_name}")
                except Exception as save_error:
                    print(f"❌ Failed to save updated config: {save_error}")
            else:
                print(f"⚠️ Repository {full_name} not found in connected repos list")
        
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/branches', methods=['GET'])
def github_get_branches():
    """Get branches for a repository"""
    try:
        full_name = request.args.get('full_name')
        if not full_name:
            return jsonify({"branches": [], "error": "full_name is required"}), 400
            
        result = github_integration.get_branches(full_name)
        return jsonify(result)
    except Exception as e:
        return jsonify({"branches": [], "error": str(e)}), 500


@app.route('/api/github/fetch', methods=['POST'])
def github_fetch_repo():
    """Fetch latest changes from remote repository"""
    try:
        data = request.get_json()
        full_name = data.get('full_name')
        
        if not full_name:
            return jsonify({"success": False, "error": "full_name is required"}), 400
            
        result = github_integration.fetch_repository(full_name)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/pull', methods=['POST'])
def github_pull_repo():
    """Pull latest changes from remote repository"""
    try:
        data = request.get_json()
        full_name = data.get('full_name')
        branch = data.get('branch')
        
        if not full_name or not branch:
            return jsonify({"success": False, "error": "full_name and branch are required"}), 400
            
        result = github_integration.pull_repository(full_name, branch)
        return jsonify(result)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/index', methods=['POST'])
def github_index_repo():
    """Index a GitHub repository - starts background indexing and returns immediately"""
    try:
        data = request.get_json()
        print(f"🚀 GITHUB INDEX REQUEST RECEIVED: {data}")
        
        full_name = data.get('full_name')
        branch = data.get('branch')
        mode = data.get('mode', 'both')
        excludes = data.get('excludes', [])
        max_size_mb = data.get('max_size_mb', 10)
        
        if not full_name or not branch:
            return jsonify({"success": False, "error": "full_name and branch are required"}), 400
            
        # Get repository path
        repo_dir = github_integration.repos_dir / full_name.replace("/", "_")
        if not repo_dir.exists():
            return jsonify({"success": False, "error": "Repository not cloned locally"}), 400
            
        # Note: We don't clear metadata for GitHub repos since we use a different indexing function
        # GitHub repos are indexed with gh:// prefixed IDs and don't use the metadata tracker
        
        # Repository indexing with custom exclusions and size limits
        print(f"DEBUG: Starting background indexing for repository {full_name} with:")
        print(f"  - Mode: {mode}")
        print(f"  - Branch: {branch}")
        print(f"  - Excludes: {excludes}")
        print(f"  - Max file size: {max_size_mb}MB")
        
        # Update repository status to indexing
        github_integration.update_repo_status(full_name, "indexing")
        
        # Index repository in the requested modes
        modes_to_run = []
        if mode == 'both':
            modes_to_run = ['gist', 'pinpoint']
        else:
            modes_to_run = [mode]
        
        # Create a background thread for indexing
        def run_indexing():
            print(f"🚀 THREAD: Starting background indexing thread for {full_name}")
            try:
                for idx, current_mode in enumerate(modes_to_run):
                    try:
                        print(f"🚀 THREAD: Starting {current_mode} indexing for {full_name}")
                        
                        # Update status to show current indexing mode
                        if len(modes_to_run) > 1:
                            mode_progress_offset = (idx / len(modes_to_run)) * 100
                            mode_message = f"Indexing {full_name} in {current_mode} mode ({idx+1}/{len(modes_to_run)})..."
                        else:
                            mode_progress_offset = 0
                            mode_message = f"Indexing {full_name} in {current_mode} mode..."
                        
                        print(f"🚀 THREAD: Updating status for {current_mode}")    
                        indexing_status.update({
                            "is_indexing": True,
                            "progress": mode_progress_offset,
                            "current_file": full_name,
                            "message": mode_message,
                            "chunking_mode": current_mode,
                            "indexing_type": "github"
                        })
                        
                        print(f"🚀 THREAD: Calling index_github_repository for {current_mode}")
                        # Use GitHub-specific indexing function
                        result = index_github_repository(
                            repo_path=str(repo_dir),
                            full_name=full_name,
                            branch=branch,
                            chunking_mode=current_mode,
                            custom_excludes=excludes,
                            max_size_mb=max_size_mb
                        )
                        
                        print(f"🚀 THREAD: Indexing function returned: {result}")
                        
                        if result["success"]:
                            print(f"🚀 THREAD: {current_mode.title()} indexing completed successfully - {result['files_indexed']} files, {result['chunks_created']} chunks")
                        else:
                            raise Exception(result.get("error", "Unknown error"))
                        
                    except Exception as e:
                        error_msg = f"{current_mode.title()} indexing failed: {str(e)}"
                        print(f"🚀 THREAD ERROR: {error_msg}")
                        import traceback
                        traceback.print_exc()
                        github_integration.update_repo_status(full_name, "index_failed", error_msg)
                        indexing_status.update({
                            "is_indexing": False,
                            "progress": 0,
                            "current_file": "",
                            "message": f"Indexing failed: {error_msg}",
                            "chunking_mode": "",
                        })
                        return
                
                # All modes completed successfully
                # Reset indexing status
                indexing_status.update({
                    "is_indexing": False,
                    "progress": 100,
                    "current_file": "",
                    "message": f"Repository {full_name} indexed successfully",
                    "chunking_mode": "",
                })
                
                # Save repository configuration after successful indexing
                repo_config = ConnectedRepo(
                    full_name=full_name,
                    local_path=str(repo_dir),
                    active_branch=branch,
                    modes=[mode] if mode != 'both' else ['gist', 'pinpoint'],
                    excludes=excludes,
                    max_size_mb=max_size_mb,
                    status="indexed"  # Set status to indexed after successful indexing
                )
                github_integration.save_connected_repo(repo_config)
                
                # Explicitly update repo status to ensure consistency
                github_integration.update_repo_status(full_name, "indexed")
                print(f"✅ Repository {full_name} indexing completed successfully")
                
            except Exception as e:
                # Handle any unexpected errors
                error_msg = f"Indexing failed: {str(e)}"
                print(f"🚀 THREAD OUTER ERROR: {error_msg}")
                import traceback
                traceback.print_exc()
                github_integration.update_repo_status(full_name, "index_failed", error_msg)
                indexing_status.update({
                    "is_indexing": False,
                    "progress": 0,
                    "current_file": "",
                    "message": error_msg,
                    "chunking_mode": "",
                })
        
        # Start the indexing in a background thread
        print(f"🚀 MAIN: Creating indexing thread for {full_name}")
        indexing_thread = threading.Thread(target=run_indexing, daemon=True)
        print(f"🚀 MAIN: Starting indexing thread")
        indexing_thread.start()
        print(f"🚀 MAIN: Thread started, returning response")
        
        # Return immediately to indicate indexing has started
        return jsonify({
            "success": True,
            "message": f"Repository {full_name} indexing started in {', '.join(modes_to_run)} mode(s)"
        })
        
    except Exception as e:
        # Reset indexing status on error
        indexing_status.update({
            "is_indexing": False,
            "progress": 0,
            "current_file": "",
            "message": f"Indexing failed: {str(e)}",
            "chunking_mode": "",
        })
        github_integration.update_repo_status(full_name, "index_failed", str(e))
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/sync', methods=['POST'])
def github_sync_repo():
    """Sync a GitHub repository (pull + incremental reindex)"""
    try:
        data = request.get_json()
        full_name = data.get('full_name')
        branch = data.get('branch')
        
        if not full_name or not branch:
            return jsonify({"success": False, "error": "full_name and branch are required"}), 400
        
        # Pull latest changes
        pull_result = github_integration.pull_repository(full_name, branch)
        if not pull_result["success"]:
            return jsonify({"success": False, "error": f"Pull failed: {pull_result.get('error', 'Unknown error')}"}), 500
            
        # Get connected repo config
        connected_repos = github_integration.load_connected_repos()
        repo_config = None
        for repo in connected_repos:
            if repo["full_name"] == full_name:
                repo_config = repo
                break
                
        if not repo_config:
            return jsonify({"success": False, "error": "Repository not found in connected repos"}), 400
            
        # Process changes incrementally
        changed_files = pull_result.get("changed_files", {})
        added_files = changed_files.get("added", [])
        modified_files = changed_files.get("modified", [])
        removed_files = changed_files.get("removed", [])
        
        total_changes = len(added_files) + len(modified_files) + len(removed_files)
        
        if total_changes > 0:
            repo_dir = github_integration.repos_dir / full_name.replace("/", "_")
            
            # Get repo configuration
            modes = repo_config.get("modes", ["gist"])
            excludes = repo_config.get("excludes", [])
            max_size_mb = repo_config.get("max_size_mb", 10)
            
            # Start background sync
            def run_sync():
                try:
                    for mode in modes:
                        # Delete chunks for removed files
                        for file_path in removed_files:
                            delete_github_file_chunks(full_name, branch, file_path, mode)
                        
                        # Delete and re-index modified files
                        for file_path in modified_files:
                            delete_github_file_chunks(full_name, branch, file_path, mode)
                            # File will be re-indexed with added files
                        
                        # Index added and modified files
                        files_to_index = added_files + modified_files
                        if files_to_index:
                            # Use a subset indexing approach
                            index_github_files(
                                repo_path=str(repo_dir),
                                full_name=full_name,
                                branch=branch,
                                file_list=files_to_index,
                                chunking_mode=mode,
                                custom_excludes=excludes,
                                max_size_mb=max_size_mb
                            )
                    
                    # Update branch manifest after successful sync
                    repo_dir = github_integration.repos_dir / full_name.replace("/", "_")
                    manifest = manifest_manager.get_manifest(full_name, branch)
                    
                    # Get all indexed files and update manifest
                    indexed_files = added_files + modified_files
                    if indexed_files:
                        manifest.update_file_manifest(str(repo_dir), indexed_files)
                    
                    # Remove deleted files from manifest
                    for removed_file in removed_files:
                        if removed_file in manifest.manifest_data.get("files", {}):
                            del manifest.manifest_data["files"][removed_file]
                    manifest._save_manifest()
                    
                    # Update last sync time
                    github_integration.update_repo_status(full_name, "indexed")  # Set back to indexed status
                    
                except Exception as e:
                    print(f"ERROR: Sync failed: {e}")
                    github_integration.update_repo_status(full_name, "sync_failed", str(e))
            
            # Start sync in background
            threading.Thread(target=run_sync, daemon=True).start()
        
        return jsonify({
            "success": True,
            "message": f"Repository sync started",
            "files_added": len(added_files),
            "files_modified": len(modified_files),
            "files_removed": len(removed_files),
            "total_changes": total_changes
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/changes', methods=['POST'])
def github_check_changes():
    """Check for pending changes on a repository branch"""
    try:
        data = request.get_json()
        full_name = data.get('full_name')
        branch = data.get('branch')
        
        if not full_name or not branch:
            return jsonify({"success": False, "error": "full_name and branch are required"}), 400
        
        # Get repository path
        repo_dir = github_integration.repos_dir / full_name.replace("/", "_")
        if not repo_dir.exists():
            return jsonify({"success": False, "error": "Repository not found locally"}), 400
        
        # Get repository configuration to access exclusion patterns
        connected_repos = github_integration.load_connected_repos()
        repo_config = None
        for repo in connected_repos:
            if repo.get("full_name") == full_name:
                repo_config = repo
                break
        
        if not repo_config:
            return jsonify({"success": False, "error": "Repository configuration not found"}), 400
        
        # Get exclusion patterns and size limit
        excludes = repo_config.get("excludes", [])
        max_size_mb = repo_config.get("max_size_mb", MAX_FILE_SIZE_MB)
        
        # Get branch manifest and detect changes
        manifest = manifest_manager.get_manifest(full_name, branch)
        changes = manifest.detect_changes(str(repo_dir), custom_excludes=excludes, max_size_mb=max_size_mb)
        manifest_summary = manifest.get_manifest_summary()
        
        total_changes = len(changes["added"]) + len(changes["modified"]) + len(changes["removed"])
        
        return jsonify({
            "success": True,
            "changes": changes,
            "total_changes": total_changes,
            "manifest": manifest_summary,
            "has_changes": total_changes > 0
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/connected', methods=['GET'])
def github_get_connected():
    """Get connected GitHub repositories"""
    try:
        connected_repos = github_integration.load_connected_repos()
        return jsonify(connected_repos)
    except Exception as e:
        return jsonify([], 500)

@app.route('/api/github/branches/indexed', methods=['GET'])
def get_indexed_branches():
    """List all branches that have been indexed for a repository"""
    try:
        repo = request.args.get('full_name')
        if not repo:
            return jsonify({"error": "full_name is required"}), 400
        
        # Query both collections for unique branches
        branches_info = {}
        
        # Check gist collection
        if gist_collection:
            try:
                gist_results = gist_collection.get(
                    where={"repo": {"$eq": repo}},
                    include=["metadatas"]
                )
                
                for metadata in gist_results.get('metadatas', []):
                    branch = metadata.get('branch')
                    if branch:
                        if branch not in branches_info:
                            branches_info[branch] = {
                                "gist_chunks": 0,
                                "pinpoint_chunks": 0,
                                "files": set(),
                                "last_indexed": 0
                            }
                        branches_info[branch]["gist_chunks"] += 1
                        branches_info[branch]["files"].add(metadata.get('file_path', ''))
                        # Track most recent index time
                        indexed_at = metadata.get('last_indexed_at', 0)
                        if indexed_at > branches_info[branch]["last_indexed"]:
                            branches_info[branch]["last_indexed"] = indexed_at
            except Exception as e:
                print(f"Error querying gist collection: {e}")
        
        # Check pinpoint collection
        if pinpoint_collection:
            try:
                pinpoint_results = pinpoint_collection.get(
                    where={"repo": {"$eq": repo}},
                    include=["metadatas"]
                )
                
                for metadata in pinpoint_results.get('metadatas', []):
                    branch = metadata.get('branch')
                    if branch:
                        if branch not in branches_info:
                            branches_info[branch] = {
                                "gist_chunks": 0,
                                "pinpoint_chunks": 0,
                                "files": set(),
                                "last_indexed": 0
                            }
                        branches_info[branch]["pinpoint_chunks"] += 1
                        branches_info[branch]["files"].add(metadata.get('file_path', ''))
                        # Track most recent index time
                        indexed_at = metadata.get('last_indexed_at', 0)
                        if indexed_at > branches_info[branch]["last_indexed"]:
                            branches_info[branch]["last_indexed"] = indexed_at
            except Exception as e:
                print(f"Error querying pinpoint collection: {e}")
        
        # Convert sets to counts and format response
        branches = []
        for branch_name, info in branches_info.items():
            branches.append({
                "name": branch_name,
                "gist_chunks": info["gist_chunks"],
                "pinpoint_chunks": info["pinpoint_chunks"],
                "total_chunks": info["gist_chunks"] + info["pinpoint_chunks"],
                "file_count": len(info["files"]),
                "last_indexed": info["last_indexed"]
            })
        
        # Sort by name
        branches.sort(key=lambda x: x["name"])
        
        return jsonify({
            "success": True,
            "repository": repo,
            "branches": branches,
            "total_branches": len(branches)
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/branches/delete-index', methods=['POST'])
def delete_branch_index():
    """Delete all chunks for a specific branch of a repository"""
    try:
        data = request.get_json()
        repo = data.get('full_name')
        branch = data.get('branch')
        mode = data.get('mode', 'both')  # 'gist', 'pinpoint', or 'both'
        
        if not repo or not branch:
            return jsonify({"success": False, "error": "full_name and branch are required"}), 400
        
        deleted_counts = {
            "gist": 0,
            "pinpoint": 0
        }
        
        # Delete from gist collection
        if mode in ['gist', 'both'] and gist_collection:
            try:
                # Get all chunk IDs for this repo/branch
                results = gist_collection.get(
                    where={
                        "$and": [
                            {"repo": {"$eq": repo}},
                            {"branch": {"$eq": branch}}
                        ]
                    },
                    include=["ids"]
                )
                
                chunk_ids = results.get("ids", [])
                if chunk_ids:
                    gist_collection.delete(ids=chunk_ids)
                    deleted_counts["gist"] = len(chunk_ids)
                    print(f"Deleted {len(chunk_ids)} gist chunks for {repo}@{branch}")
            except Exception as e:
                print(f"Error deleting gist chunks: {e}")
        
        # Delete from pinpoint collection
        if mode in ['pinpoint', 'both'] and pinpoint_collection:
            try:
                # Get all chunk IDs for this repo/branch
                results = pinpoint_collection.get(
                    where={
                        "$and": [
                            {"repo": {"$eq": repo}},
                            {"branch": {"$eq": branch}}
                        ]
                    },
                    include=["ids"]
                )
                
                chunk_ids = results.get("ids", [])
                if chunk_ids:
                    pinpoint_collection.delete(ids=chunk_ids)
                    deleted_counts["pinpoint"] = len(chunk_ids)
                    print(f"Deleted {len(chunk_ids)} pinpoint chunks for {repo}@{branch}")
            except Exception as e:
                print(f"Error deleting pinpoint chunks: {e}")
        
        # Also remove branch manifest if it exists
        try:
            from branch_manifest import BranchManifest
            manifest = BranchManifest(repo, branch)
            if manifest.manifest_file.exists():
                manifest.manifest_file.unlink()
                print(f"Deleted manifest file for {repo}@{branch}")
        except Exception as e:
            print(f"Error deleting manifest: {e}")
        
        total_deleted = deleted_counts["gist"] + deleted_counts["pinpoint"]
        
        return jsonify({
            "success": True,
            "message": f"Deleted {total_deleted} chunks for {repo}@{branch}",
            "deleted_counts": deleted_counts,
            "repository": repo,
            "branch": branch
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/github/branch/status', methods=['GET'])
def get_branch_index_status():
    """Check if a specific branch has been indexed"""
    try:
        repo = request.args.get('full_name')
        branch = request.args.get('branch')
        
        if not repo or not branch:
            return jsonify({"error": "full_name and branch are required"}), 400
        
        has_index = False
        chunk_counts = {
            "gist": 0,
            "pinpoint": 0
        }
        
        # Check gist collection
        if gist_collection:
            try:
                results = gist_collection.get(
                    where={
                        "$and": [
                            {"repo": {"$eq": repo}},
                            {"branch": {"$eq": branch}}
                        ]
                    },
                    limit=1,
                    include=["metadatas"]
                )
                if results.get("metadatas") and len(results["metadatas"]) > 0:
                    has_index = True
                    # Get actual count
                    count_results = gist_collection.get(
                        where={
                            "$and": [
                                {"repo": {"$eq": repo}},
                                {"branch": {"$eq": branch}}
                            ]
                        },
                        include=["ids"]
                    )
                    chunk_counts["gist"] = len(count_results.get("ids", []))
            except Exception as e:
                print(f"Error checking gist collection: {e}")
        
        # Check pinpoint collection
        if pinpoint_collection:
            try:
                results = pinpoint_collection.get(
                    where={
                        "$and": [
                            {"repo": {"$eq": repo}},
                            {"branch": {"$eq": branch}}
                        ]
                    },
                    limit=1,
                    include=["metadatas"]
                )
                if results.get("metadatas") and len(results["metadatas"]) > 0:
                    has_index = True
                    # Get actual count
                    count_results = pinpoint_collection.get(
                        where={
                            "$and": [
                                {"repo": {"$eq": repo}},
                                {"branch": {"$eq": branch}}
                            ]
                        },
                        include=["ids"]
                    )
                    chunk_counts["pinpoint"] = len(count_results.get("ids", []))
            except Exception as e:
                print(f"Error checking pinpoint collection: {e}")
        
        # Check branch manifest
        manifest_exists = False
        last_commit = None
        try:
            from branch_manifest import BranchManifest
            manifest = BranchManifest(repo, branch)
            if manifest.manifest_file.exists():
                manifest_exists = True
                last_commit = manifest.manifest_data.get("last_commit_sha")
        except Exception as e:
            print(f"Error checking manifest: {e}")
        
        return jsonify({
            "success": True,
            "repository": repo,
            "branch": branch,
            "has_index": has_index,
            "chunk_counts": chunk_counts,
            "total_chunks": chunk_counts["gist"] + chunk_counts["pinpoint"],
            "manifest_exists": manifest_exists,
            "last_indexed_commit": last_commit
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/delete-all-data', methods=['POST'])
def delete_all_data():
    """
    Delete all application data - equivalent to running cleanup.py
    This includes:
    - All ChromaDB collections and data
    - GitHub authentication tokens  
    - Cloned repositories
    - File metadata and cache
    - Application data directory
    """
    try:
        import shutil
        import platform
        from pathlib import Path
        # Make psutil optional since it's not in requirements.txt
        try:
            import psutil
            PSUTIL_AVAILABLE = True
        except ImportError:
            PSUTIL_AVAILABLE = False
        
        # Import keyring for token deletion
        try:
            import keyring
            KEYRING_AVAILABLE = True
        except ImportError:
            KEYRING_AVAILABLE = False
        
        print("🧹 Starting complete data deletion...")
        
        # Step 1: Stop any background monitoring
        try:
            if realtime_monitor and hasattr(realtime_monitor, 'stop_monitoring'):
                if hasattr(realtime_monitor, 'is_monitoring') and realtime_monitor.is_monitoring():
                    realtime_monitor.stop_monitoring()
                    print("✅ Stopped realtime monitoring")
                elif hasattr(realtime_monitor, 'stop_monitoring'):
                    realtime_monitor.stop_monitoring()
                    print("✅ Stopped realtime monitoring")
        except Exception as e:
            print(f"⚠️ Warning stopping monitor: {e}")
        
        # Step 2: Clear ChromaDB collections
        try:
            # Get ChromaDB client from the API server
            client = initialize_collections.client if hasattr(initialize_collections, 'client') else None
            
            if client:
                # List and delete all collections
                collections = client.list_collections()
                for collection in collections:
                    try:
                        client.delete_collection(collection.name)
                        print(f"✅ Deleted collection: {collection.name}")
                    except Exception as e:
                        print(f"⚠️ Error deleting collection {collection.name}: {e}")
                
                print(f"✅ Deleted {len(collections)} ChromaDB collections")
            else:
                print("⚠️ ChromaDB client not available for deletion")
            
        except Exception as e:
            print(f"⚠️ Error clearing ChromaDB: {e}")
        
        # Step 3: Remove GitHub authentication data
        if KEYRING_AVAILABLE:
            try:
                existing_token = keyring.get_password("filesearcher", "github_token")
                if existing_token:
                    keyring.delete_password("filesearcher", "github_token")
                    print("✅ Removed GitHub access token from keyring")
                else:
                    print("✅ No GitHub access token found in keyring")
            except Exception as e:
                print(f"⚠️ Could not remove GitHub token: {e}")
        else:
            print("⚠️ Keyring not available - cannot check for stored tokens")
        
        # Step 4: Remove cloned GitHub repositories
        github_repos_dir = Path.home() / ".filesearcher" / "repos"
        if github_repos_dir.exists():
            try:
                repos = list(github_repos_dir.iterdir())
                if repos:
                    shutil.rmtree(github_repos_dir)
                    print(f"✅ Removed {len(repos)} cloned repositories")
                else:
                    github_repos_dir.rmdir()
                    print("✅ No cloned repositories found")
            except Exception as e:
                print(f"⚠️ Error removing GitHub repos: {e}")
        
        # Step 5: Remove application data directory
        def get_app_data_dir():
            """Get platform-appropriate app data directory"""
            system = platform.system()
            
            if system == "Darwin":  # macOS
                base_dir = Path.home() / "Library" / "Application Support"
            elif system == "Windows":
                base_dir = Path(os.environ.get("LOCALAPPDATA", ""))
            else:  # Linux and others
                base_dir = Path.home() / ".local" / "share"
            
            return base_dir / "FileFinder"
        
        app_data_dir = get_app_data_dir()
        if app_data_dir.exists():
            try:
                shutil.rmtree(app_data_dir)
                print(f"✅ Removed app data directory: {app_data_dir}")
            except Exception as e:
                print(f"⚠️ Error removing app data: {e}")
        
        # Step 6: Remove local cache files in project directory
        try:
            project_dir = Path(__file__).parent
            patterns_to_remove = [
                "*.db",
                "*.sqlite*", 
                "*metadata*.json",
                "chroma_db/",
                "*.log"
            ]
            
            files_removed = 0
            for pattern in patterns_to_remove:
                if pattern.endswith('/'):
                    # Directory pattern
                    dir_name = pattern.rstrip('/')
                    dir_path = project_dir / dir_name
                    if dir_path.exists() and dir_path.is_dir():
                        try:
                            shutil.rmtree(dir_path)
                            files_removed += 1
                            print(f"✅ Removed directory: {dir_name}/")
                        except Exception as e:
                            print(f"⚠️ Could not remove {dir_name}/: {e}")
                else:
                    # File pattern
                    for file_path in project_dir.glob(pattern):
                        if file_path.is_file():
                            try:
                                file_path.unlink()
                                files_removed += 1
                                print(f"✅ Removed file: {file_path.name}")
                            except Exception as e:
                                print(f"⚠️ Could not remove {file_path.name}: {e}")
            
            if files_removed > 0:
                print(f"✅ Removed {files_removed} local cache items")
            else:
                print("✅ No local cache files found")
                
        except Exception as e:
            print(f"⚠️ Error cleaning local cache: {e}")
        
        # Step 7: Clear metadata tracker
        try:
            print("🗃️ Clearing metadata tracker...")
            metadata_tracker.clear_all_metadata()
            print("✅ Metadata tracker cleared")
        except Exception as e:
            print(f"⚠️ Error clearing metadata tracker: {e}")
        
        # Step 8: Clear sync tracker
        try:
            print("🔄 Clearing sync tracker...")
            sync_tracker.clear_all_sync_data()
            print("✅ Sync tracker cleared")
        except Exception as e:
            print(f"⚠️ Error clearing sync tracker: {e}")
        
        print("🎉 Data deletion completed successfully!")
        print("✅ All FileFinder data has been removed")
        print("✅ Ready for fresh setup")
        
        return jsonify({
            "success": True,
            "message": "All data has been successfully deleted"
        })
        
    except Exception as e:
        error_msg = f"Error during data deletion: {str(e)}"
        print(f"❌ {error_msg}")
        return jsonify({"success": False, "error": error_msg}), 500

if __name__ == '__main__':
    print("Starting FileFinder API server...")
    print(f"Gist model (MSMarco): {GIST_EMBEDDING_MODEL}")
    print(f"Pinpoint model (AllMiniLM): {PINPOINT_EMBEDDING_MODEL}")
    print(f"Database directory: {metadata_tracker.get_db_directory()}")
    print(f"Granular chunking: {ENABLE_GRANULAR_CHUNKING}")
    
    # Run the Flask app
    app.run(host='0.0.0.0', port=5001, debug=False) 