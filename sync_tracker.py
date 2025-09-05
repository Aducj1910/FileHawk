"""
FileFinder Sync Tracker

Real-time tracking of file changes for intelligent sync management.
Maintains a queue of files that need reindexing and provides instant sync status.
"""

import os
import time
import threading
from pathlib import Path
from typing import Dict, Set, List, Optional, Tuple
from collections import defaultdict, deque
from dataclasses import dataclass

@dataclass
class FileChangeEvent:
    """Represents a file change event"""
    file_path: str
    event_type: str  # 'created', 'modified', 'deleted', 'moved'
    timestamp: float
    chunking_mode: str
    folder_path: str

class SyncTracker:
    """
    Tracks file changes and maintains sync queue for real-time updates
    """
    
    def __init__(self, metadata_tracker):
        self.metadata_tracker = metadata_tracker
        self.lock = threading.Lock()
        
        # Track which folders are being monitored for each chunking mode
        self.monitored_folders: Dict[str, Set[str]] = {
            'gist': set(),
            'pinpoint': set()
        }
        
        # Queue of files that need syncing for each mode
        self.sync_queue: Dict[str, Dict[str, FileChangeEvent]] = {
            'gist': {},
            'pinpoint': {}
        }
        
        # Track folder-level change counts for UI
        self.folder_change_counts: Dict[str, Dict[str, int]] = {
            'gist': defaultdict(int),
            'pinpoint': defaultdict(int)
        }
        
        # Add event history for debugging
        self.event_history: Dict[str, List[Dict]] = {
            'gist': [],
            'pinpoint': []
        }
        
        # Cache for file stat checks to avoid repeated expensive operations
        self._stat_cache: Dict[str, Dict] = {}
        self._cache_ttl = 2.0  # Cache stats for 2 seconds
        
        # Callback for UI updates
        self.on_sync_status_changed: Optional[callable] = None
        
        print("Sync Tracker initialized")
    
    def set_sync_status_callback(self, callback: callable):
        """Set callback function to notify UI of sync status changes"""
        self.on_sync_status_changed = callback
    
    def add_monitored_folder(self, folder_path: str, chunking_mode: str):
        """Add a folder to the monitoring list for a specific chunking mode"""
        with self.lock:
            folder_path = os.path.abspath(folder_path)
            self.monitored_folders[chunking_mode].add(folder_path)
            print(f"Now monitoring {folder_path} for {chunking_mode} mode")
            
            # Initialize change count for this folder
            if folder_path not in self.folder_change_counts[chunking_mode]:
                self.folder_change_counts[chunking_mode][folder_path] = 0
    
    def remove_monitored_folder(self, folder_path: str, chunking_mode: str):
        """Remove a folder from monitoring"""
        with self.lock:
            folder_path = os.path.abspath(folder_path)
            self.monitored_folders[chunking_mode].discard(folder_path)
            
            # Clear any pending changes for this folder
            to_remove = [file_path for file_path, event in self.sync_queue[chunking_mode].items()
                        if event.folder_path == folder_path]
            for file_path in to_remove:
                del self.sync_queue[chunking_mode][file_path]
            
            # Clear folder change count
            if folder_path in self.folder_change_counts[chunking_mode]:
                del self.folder_change_counts[chunking_mode][folder_path]
            
            print(f"Stopped monitoring {folder_path} for {chunking_mode} mode")
            self._notify_ui_update()
    
    def should_monitor_file(self, file_path: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Check if a file should be monitored and return monitoring details
        
        Returns:
            (should_monitor, chunking_mode, folder_path) for the FIRST match found
        """
        file_path = os.path.abspath(file_path)
        
        # Skip certain file types that shouldn't be indexed
        if self._should_ignore_file(file_path):
            return False, None, None
        
        # Check each monitored folder to see if this file belongs to it
        for chunking_mode, folders in self.monitored_folders.items():
            for folder_path in folders:
                try:
                    # Check if file is under this monitored folder
                    Path(file_path).relative_to(Path(folder_path))
                    return True, chunking_mode, folder_path
                    
                except ValueError:
                    # File is not under this folder
                    continue
        
        return False, None, None
    
    def get_all_matching_modes(self, file_path: str) -> List[Tuple[str, str]]:
        """
        Get ALL chunking modes and folder paths that should monitor this file
        
        Returns:
            List of (chunking_mode, folder_path) tuples
        """
        file_path = os.path.abspath(file_path)
        matches = []
        
        # Skip certain file types that shouldn't be indexed
        if self._should_ignore_file(file_path):
            return matches
        
        # Check each monitored folder to see if this file belongs to it
        for chunking_mode, folders in self.monitored_folders.items():
            for folder_path in folders:
                try:
                    # Check if file is under this monitored folder
                    Path(file_path).relative_to(Path(folder_path))
                    matches.append((chunking_mode, folder_path))
                    
                except ValueError:
                    # File is not under this folder
                    continue
        
        return matches
    
    def handle_file_event(self, file_path: str, event_type: str):
        """
        Handle a file system event and update sync queue for ALL matching modes
        
        Args:
            file_path: Path to the affected file
            event_type: Type of event ('created', 'modified', 'deleted', 'moved')
        """
        # Get ALL chunking modes that should monitor this file
        matching_modes = self.get_all_matching_modes(file_path)
        
        if not matching_modes:
            return
        
        with self.lock:
            # Process event for each matching mode
            for chunking_mode, folder_path in matching_modes:
                # Log event for debugging
                self._log_event(file_path, event_type, chunking_mode, folder_path)
                
                # For deleted files, we always need to sync
                if event_type == 'deleted':
                    self._add_to_sync_queue(file_path, event_type, chunking_mode, folder_path)
                    continue
                
                # For created/modified files, check if they actually need indexing
                if event_type in ['created', 'modified']:
                    # Use fast stat check instead of expensive hash calculation
                    needs_indexing = self._file_needs_indexing_fast(file_path, chunking_mode)
                    
                    if needs_indexing:
                        self._add_to_sync_queue(file_path, event_type, chunking_mode, folder_path)
                    else:
                        # File hasn't actually changed in a meaningful way, remove from queue if present
                        if file_path in self.sync_queue[chunking_mode]:
                            self.remove_from_sync_queue(file_path, chunking_mode, folder_path)
    
    def _file_needs_indexing_fast(self, file_path: str, chunking_mode: str) -> bool:
        """Fast check if file needs indexing using stat only"""
        try:
            if file_path not in self.metadata_tracker.metadata:
                return True  # New file
            
            file_info = self.metadata_tracker.metadata[file_path]
            
            # Check if this specific chunking mode exists
            if ('modes' not in file_info or 
                chunking_mode not in file_info['modes']):
                return True  # File not indexed in this mode
            
            mode_info = file_info['modes'][chunking_mode]
            
            # Check cached stats first
            current_time = time.time()
            if file_path in self._stat_cache:
                cache_entry = self._stat_cache[file_path]
                if current_time - cache_entry['timestamp'] < self._cache_ttl:
                    cached_mtime = cache_entry['mtime']
                    cached_size = cache_entry['size']
                    
                    stored_mtime = mode_info.get('last_modified', 0)
                    stored_size = mode_info.get('file_size', 0)
                    
                    # Allow 1 second tolerance for mtime (more sensitive)
                    return (abs(cached_mtime - stored_mtime) >= 1.0 or 
                            cached_size != stored_size)
            
            # Check file stats without calculating hash
            try:
                stat = os.stat(file_path)
                current_mtime = stat.st_mtime
                current_size = stat.st_size
                
                # Cache the stats
                self._stat_cache[file_path] = {
                    'mtime': current_mtime,
                    'size': current_size,
                    'timestamp': current_time
                }
                
                stored_mtime = mode_info.get('last_modified', 0)
                stored_size = mode_info.get('file_size', 0)
                
                # Allow 1 second tolerance for mtime (more sensitive)
                return (abs(current_mtime - stored_mtime) >= 1.0 or 
                        current_size != stored_size)
                        
            except OSError:
                return True  # File doesn't exist or can't be accessed
        
        except Exception as e:
            print(f"Error in fast indexing check: {e}")
            return True  # Default to indexing on error
    
    def _log_event(self, file_path: str, event_type: str, chunking_mode: str, folder_path: str):
        """Log event for debugging"""
        event_log = {
            'timestamp': time.time(),
            'file_path': file_path,
            'event_type': event_type,
            'chunking_mode': chunking_mode,
            'folder_path': folder_path
        }
        
        self.event_history[chunking_mode].append(event_log)
        
        # Keep only last 50 events
        if len(self.event_history[chunking_mode]) > 50:
            self.event_history[chunking_mode] = self.event_history[chunking_mode][-50:]
        
        print(f"EVENT LOG [{chunking_mode}]: {event_type} - {os.path.basename(file_path)}")
    
    def _add_to_sync_queue(self, file_path: str, event_type: str, chunking_mode: str, folder_path: str):
        """Add a file to the sync queue"""
        file_path = os.path.abspath(file_path)
        
        # Create or update the change event
        event = FileChangeEvent(
            file_path=file_path,
            event_type=event_type,
            timestamp=time.time(),
            chunking_mode=chunking_mode,
            folder_path=folder_path
        )
        
        # Add to queue (overwrites if file was already in queue)
        was_new = file_path not in self.sync_queue[chunking_mode]
        self.sync_queue[chunking_mode][file_path] = event
        
        # Update folder change count
        if was_new:
            self.folder_change_counts[chunking_mode][folder_path] += 1
        
        print(f"Added to sync queue: {os.path.basename(file_path)} ({event_type}) in {chunking_mode} mode")
        self._notify_ui_update()
    
    def remove_from_sync_queue(self, file_path: str, chunking_mode: str, folder_path: str):
        """Remove a file from the sync queue"""
        file_path = os.path.abspath(file_path)
        
        if file_path in self.sync_queue[chunking_mode]:
            del self.sync_queue[chunking_mode][file_path]
            self.folder_change_counts[chunking_mode][folder_path] -= 1
            
            # Ensure count doesn't go negative
            if self.folder_change_counts[chunking_mode][folder_path] < 0:
                self.folder_change_counts[chunking_mode][folder_path] = 0
            
            print(f"Removed from sync queue: {os.path.basename(file_path)} in {chunking_mode} mode")
            self._notify_ui_update()
    
    def get_sync_status(self, chunking_mode: str) -> Dict:
        """Get current sync status with debugging info"""
        with self.lock:
            queue = self.sync_queue[chunking_mode]
            total_changes = len(queue)
            
            # Group by folder for detailed breakdown
            folder_breakdown = {}
            for event in queue.values():
                folder = event.folder_path
                if folder not in folder_breakdown:
                    folder_breakdown[folder] = {
                        'path': folder,
                        'change_count': 0,
                        'files': []
                    }
                folder_breakdown[folder]['change_count'] += 1
                folder_breakdown[folder]['files'].append({
                    'path': event.file_path,
                    'event_type': event.event_type,
                    'timestamp': event.timestamp
                })
            
            return {
                'needs_sync': total_changes > 0,
                'total_changes': total_changes,
                'folders_affected': len(folder_breakdown),
                'folder_breakdown': folder_breakdown,
                'monitored_folders': list(self.monitored_folders[chunking_mode]),
                'recent_events': self.event_history[chunking_mode][-10:],  # Last 10 events
                'queue_details': [
                    {
                        'file': os.path.basename(event.file_path),
                        'type': event.event_type,
                        'folder': os.path.basename(event.folder_path),
                        'timestamp': event.timestamp
                    }
                    for event in queue.values()
                ]
            }
    
    def get_files_to_sync(self, chunking_mode: str) -> List[FileChangeEvent]:
        """Get list of files that need syncing for a chunking mode"""
        with self.lock:
            return list(self.sync_queue[chunking_mode].values())
    
    def mark_files_synced(self, file_paths: List[str], chunking_mode: str):
        """Mark files as synced and remove from queue"""
        with self.lock:
            for file_path in file_paths:
                file_path = os.path.abspath(file_path)
                if file_path in self.sync_queue[chunking_mode]:
                    event = self.sync_queue[chunking_mode][file_path]
                    folder_path = event.folder_path
                    
                    del self.sync_queue[chunking_mode][file_path]
                    self.folder_change_counts[chunking_mode][folder_path] -= 1
                    
                    # Ensure count doesn't go negative
                    if self.folder_change_counts[chunking_mode][folder_path] < 0:
                        self.folder_change_counts[chunking_mode][folder_path] = 0
            
            print(f"Marked {len(file_paths)} files as synced in {chunking_mode} mode")
            self._notify_ui_update()
    
    def clear_sync_queue(self, chunking_mode: str):
        """Clear all pending sync items for a chunking mode"""
        with self.lock:
            self.sync_queue[chunking_mode].clear()
            for folder in self.folder_change_counts[chunking_mode]:
                self.folder_change_counts[chunking_mode][folder] = 0
            
            print(f"Cleared sync queue for {chunking_mode} mode")
            self._notify_ui_update()
    
    def clear_all_sync_data(self):
        """Clear all sync data for complete data deletion"""
        with self.lock:
            # Clear sync queues for all modes
            for mode in ['gist', 'pinpoint']:
                self.sync_queue[mode].clear()
                for folder in self.folder_change_counts[mode]:
                    self.folder_change_counts[mode][folder] = 0
            
            print("All sync data cleared")
            self._notify_ui_update()
    
    def _should_ignore_file(self, file_path: str) -> bool:
        """Check if file should be ignored (temporary files, etc.)"""
        filename = os.path.basename(file_path)
        
        # Ignore common temporary files and system files
        ignore_patterns = [
            '.tmp', '.temp', '.swp', '.swo', '~',
            '.lock', '.pid', '.log', '.cache',
            '.DS_Store', 'Thumbs.db', '.git',
            '__pycache__', '.pyc', '.pyo'
        ]
        
        # Check if filename ends with or contains ignore patterns
        for pattern in ignore_patterns:
            if pattern in filename.lower() or filename.lower().endswith(pattern):
                return True
        
        # Ignore hidden files starting with .
        if filename.startswith('.'):
            return True
        
        return False
    
    def _notify_ui_update(self):
        """Notify UI that sync status has changed"""
        if self.on_sync_status_changed:
            try:
                self.on_sync_status_changed()
            except Exception as e:
                print(f"Error notifying UI of sync status change: {e}")
    
    def get_stats(self) -> Dict:
        """Get comprehensive statistics about sync tracking"""
        with self.lock:
            stats = {
                'monitored_folders': {
                    mode: len(folders) for mode, folders in self.monitored_folders.items()
                },
                'pending_changes': {
                    mode: len(queue) for mode, queue in self.sync_queue.items()
                },
                'total_monitored_folders': sum(len(folders) for folders in self.monitored_folders.values()),
                'total_pending_changes': sum(len(queue) for queue in self.sync_queue.values())
            }
            
            return stats
