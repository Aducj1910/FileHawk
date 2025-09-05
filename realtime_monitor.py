"""
FileFinder Real-Time File Monitor

Uses watchdog to monitor file system changes in real-time and feed them to the sync tracker.
Provides instant detection of file changes across all indexed folders.
"""

import os
import time
import threading
from typing import Set, Dict, Optional
from pathlib import Path

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

from sync_tracker import SyncTracker

class FileFinderEventHandler(FileSystemEventHandler):
    """Handles file system events for FileFinder real-time sync"""
    
    def __init__(self, sync_tracker: SyncTracker):
        super().__init__()
        self.sync_tracker = sync_tracker
        self.debounce_time = 0.5  # Reduced from 1.5s to 0.5s for better responsiveness
        self.pending_events: Dict[str, list] = {}  # file_path -> list of events
        self.event_lock = threading.Lock()
        self.event_counter = 0  # Global event counter for tracking
    
    def on_any_event(self, event: FileSystemEvent):
        """Handle any file system event"""
        if event.is_directory:
            return
        
        # Skip temporary and system files
        if self._should_ignore_file(event.src_path):
            return
        
        # Debug logging for file events
        file_ext = os.path.splitext(event.src_path)[1].lower()
        is_docx = file_ext in ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt']
        
        if is_docx:
            print(f"📄 OFFICE FILE EVENT: {event.event_type} - {os.path.basename(event.src_path)}")
            print(f"📄 OFFICE FILE EXISTS: {os.path.exists(event.src_path)}")
        else:
            print(f"FILE EVENT: {event.event_type} - {event.src_path}")
        
        # Determine event type more reliably
        event_type = self._get_reliable_event_type(event)
        if not event_type:
            print(f"WARNING: Unknown event type: {event.event_type}")
            return
        
        if is_docx:
            print(f"📄 OFFICE PROCESSING: {event_type} - {os.path.basename(event.src_path)}")
        else:
            print(f"PROCESSING: {event_type} - {os.path.basename(event.src_path)}")
        
        # Handle moved events specially
        if hasattr(event, 'dest_path') and event.dest_path:
            # File was moved/renamed
            self._handle_moved_file(event.src_path, event.dest_path)
        else:
            # Add event to pending list instead of scheduling immediately
            self._add_pending_event(event.src_path, event_type)
    
    def _get_reliable_event_type(self, event) -> Optional[str]:
        """More reliable event type detection"""
        if event.event_type == 'deleted':
            return 'deleted'
        elif event.event_type == 'created':
            return 'created'
        elif event.event_type == 'modified':
            # Check if this is actually a new file that was deleted during processing
            if not os.path.exists(event.src_path):
                return 'deleted'  # File was deleted during processing
            return 'modified'
        elif event.event_type == 'moved':
            return 'moved'
        return None
    
    def _add_pending_event(self, file_path: str, event_type: str):
        """Add event to pending list with timestamp"""
        with self.event_lock:
            if file_path not in self.pending_events:
                self.pending_events[file_path] = []
            
            self.event_counter += 1
            event_id = self.event_counter
            
            # Add new event with ID and timestamp
            self.pending_events[file_path].append({
                'type': event_type,
                'timestamp': time.time(),
                'event_id': event_id
            })
            
            # Schedule processing if this is the first event for this file
            if len(self.pending_events[file_path]) == 1:
                threading.Timer(
                    self.debounce_time,
                    self._process_pending_events,
                    args=[file_path]
                ).start()
    
    def _process_pending_events(self, file_path: str):
        """Process all pending events for a file"""
        with self.event_lock:
            if file_path not in self.pending_events:
                return
            
            events = self.pending_events[file_path]
            if not events:
                return
            
            # Determine final event type based on all pending events
            final_event_type = self._determine_final_event_type(events, file_path)
            
            # Clear pending events
            del self.pending_events[file_path]
        
        # Process the final event
        if final_event_type:
            print(f"FINAL EVENT: {final_event_type} for {os.path.basename(file_path)}")
            self.sync_tracker.handle_file_event(file_path, final_event_type)
    
    def _determine_final_event_type(self, events: list, file_path: str) -> Optional[str]:
        """Determine final event type from multiple events"""
        if not events:
            return None
        
        # Sort by timestamp
        events.sort(key=lambda x: x['timestamp'])
        
        event_types = [e['type'] for e in events]
        
        # Special handling for office files and text files which have complex save patterns
        is_office_file = any(file_path.lower().endswith(ext) for ext in ['.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.txt'])
        
        if is_office_file:
            print(f"📄 OFFICE EVENTS for {os.path.basename(file_path)}: {event_types}, File exists: {os.path.exists(file_path)}")
            
            # For office files, always check if file still exists first
            if 'deleted' in event_types and os.path.exists(file_path):
                print(f"📄 OFFICE FILE: File marked deleted but still exists - treating as modification")
                return 'modified'
            elif 'deleted' in event_types and not os.path.exists(file_path):
                print(f"📄 OFFICE FILE: File truly deleted")
                return 'deleted'
            
            # For office files, if we see delete+create within a short time, treat as modified
            if 'deleted' in event_types and 'created' in event_types:
                print(f"📄 OFFICE FILE PATTERN: Treating delete+create as modification")
                return 'modified'
            # If only created (common after Word save), treat as modified if file exists
            elif 'created' in event_types:
                if os.path.exists(file_path):
                    print(f"📄 OFFICE FILE PATTERN: Treating creation as modification")
                    return 'modified'
        
        # Improved logic for non-office files: Check file existence for better accuracy
        print(f"🔍 EVENTS for {os.path.basename(file_path)}: {event_types}, File exists: {os.path.exists(file_path)}")
        
        # If file has delete events but still exists, it was likely a save operation
        if 'deleted' in event_types and os.path.exists(file_path):
            print(f"📝 File marked deleted but still exists - treating as modification for {os.path.basename(file_path)}")
            return 'modified'
        
        # If file has delete events and doesn't exist, it's truly deleted
        if 'deleted' in event_types and not os.path.exists(file_path):
            print(f"🗑️ File truly deleted for {os.path.basename(file_path)}")
            return 'deleted'
        
        # Standard priority for existing files: created > modified
        if 'created' in event_types:
            return 'created'
        elif 'modified' in event_types:
            return 'modified'
        
        return events[-1]['type']  # Return last event if no clear pattern
    
    def _handle_moved_file(self, src_path: str, dest_path: str):
        """Handle file move/rename operations"""
        # Treat source as deleted and destination as created
        self._add_pending_event(src_path, 'deleted')
        self._add_pending_event(dest_path, 'created')
    
    def _should_ignore_file(self, file_path: str) -> bool:
        """Check if file should be ignored"""
        filename = os.path.basename(file_path)
        
        # Ignore common temporary files
        temp_patterns = [
            '.tmp', '.temp', '.swp', '.swo', '~',
            '.lock', '.pid', '.log', '.cache',
            '.DS_Store', 'Thumbs.db',
            '__pycache__', '.git', '.svn', '.hg',
            # Office temporary files
            '~$', '.crdownload', '.partial'
        ]
        
        for pattern in temp_patterns:
            if pattern in filename.lower() or filename.lower().endswith(pattern):
                return True
        
        # Ignore hidden files starting with .
        if filename.startswith('.'):
            return True
        
        return False

class RealtimeMonitor:
    """
    Real-time file system monitor for FileFinder sync tracking
    """
    
    def __init__(self, sync_tracker: SyncTracker):
        self.sync_tracker = sync_tracker
        self.observer = Observer()
        self.event_handler = FileFinderEventHandler(sync_tracker)
        self.monitored_paths: Set[str] = set()
        self.is_running = False
        
        print("Real-time monitor initialized")
    
    def start_monitoring(self) -> bool:
        """Start the file system observer"""
        try:
            if not self.is_running:
                self.observer.start()
                self.is_running = True
                print("Real-time file monitoring started")
                return True
            return True
            
        except Exception as e:
            print(f"Error starting real-time monitor: {e}")
            return False
    
    def stop_monitoring(self):
        """Stop the file system observer"""
        if self.is_running:
            try:
                self.observer.stop()
                self.observer.join(timeout=5.0)
                self.is_running = False
                self.monitored_paths.clear()
                print("Real-time file monitoring stopped")
                
            except Exception as e:
                print(f"Error stopping real-time monitor: {e}")
    
    def add_folder(self, folder_path: str, chunking_mode: str) -> bool:
        """
        Add a folder to real-time monitoring
        
        Args:
            folder_path: Path to folder to monitor
            chunking_mode: Chunking mode this folder is indexed with
        
        Returns:
            True if folder was added successfully
        """
        if not os.path.exists(folder_path):
            print(f"Cannot monitor non-existent folder: {folder_path}")
            return False
        
        try:
            folder_path = os.path.abspath(folder_path)
            
            # Add to sync tracker's monitoring list
            self.sync_tracker.add_monitored_folder(folder_path, chunking_mode)
            
            # Add to watchdog observer if not already monitoring
            if folder_path not in self.monitored_paths:
                self.observer.schedule(
                    self.event_handler, 
                    folder_path, 
                    recursive=True
                )
                self.monitored_paths.add(folder_path)
                print(f"Started watching folder: {folder_path}")
            
            return True
            
        except Exception as e:
            print(f"Error adding folder to monitor: {e}")
            return False
    
    def remove_folder(self, folder_path: str, chunking_mode: str) -> bool:
        """
        Remove a folder from monitoring for a specific chunking mode
        
        Args:
            folder_path: Path to folder to stop monitoring
            chunking_mode: Chunking mode to stop monitoring for
        
        Returns:
            True if folder was removed successfully
        """
        try:
            folder_path = os.path.abspath(folder_path)
            
            # Remove from sync tracker
            self.sync_tracker.remove_monitored_folder(folder_path, chunking_mode)
            
            # Check if folder is still needed for other chunking modes
            still_needed = False
            for mode, folders in self.sync_tracker.monitored_folders.items():
                if folder_path in folders:
                    still_needed = True
                    break
            
            # If folder is no longer needed for any mode, remove from watchdog
            if not still_needed and folder_path in self.monitored_paths:
                # Note: watchdog doesn't have easy way to remove specific paths
                # We'd need to restart the observer to properly remove paths
                # For now, we'll just remove from our tracking
                self.monitored_paths.discard(folder_path)
                print(f"Stopped watching folder: {folder_path}")
            
            return True
            
        except Exception as e:
            print(f"Error removing folder from monitor: {e}")
            return False
    
    def refresh_monitoring(self):
        """
        Refresh monitoring based on current sync tracker state
        This is useful when sync tracker state changes
        """
        try:
            # Get all folders that should be monitored
            folders_to_monitor = set()
            for mode, folders in self.sync_tracker.monitored_folders.items():
                folders_to_monitor.update(folders)
            
            # Add any new folders to watchdog
            for folder_path in folders_to_monitor:
                if folder_path not in self.monitored_paths and os.path.exists(folder_path):
                    self.observer.schedule(
                        self.event_handler,
                        folder_path,
                        recursive=True
                    )
                    self.monitored_paths.add(folder_path)
                    print(f"Added folder to monitoring: {folder_path}")
            
            # Note: Removing folders from watchdog requires observer restart
            # For now, we keep monitoring extra folders (low overhead)
            
        except Exception as e:
            print(f"Error refreshing monitoring: {e}")
    
    def get_status(self) -> Dict:
        """Get current monitoring status"""
        # Convert monitored folders to serializable format
        monitored_folders_serializable = {}
        for mode, folders in self.sync_tracker.monitored_folders.items():
            monitored_folders_serializable[mode] = list(folders)
        
        return {
            'is_running': self.is_running,
            'monitored_paths': list(self.monitored_paths),
            'monitored_count': len(self.monitored_paths),
            'monitored_folders_by_mode': monitored_folders_serializable,
            'total_folders': sum(len(folders) for folders in self.sync_tracker.monitored_folders.values())
        }
    
    def force_check_all_folders(self):
        """
        Force check all monitored folders for changes
        Useful for initial sync status or periodic validation
        """
        print("Force checking all monitored folders for changes...")
        
        for chunking_mode, folders in self.sync_tracker.monitored_folders.items():
            for folder_path in folders:
                if os.path.exists(folder_path):
                    self._scan_folder_for_changes(folder_path, chunking_mode)
                
                # Also check for deleted files by scanning metadata
                self._check_for_deleted_files(chunking_mode, folder_path)
    
    def _scan_folder_for_changes(self, folder_path: str, chunking_mode: str):
        """Scan a folder for changes and add to sync queue if needed"""
        try:
            for root, dirs, files in os.walk(folder_path):
                for filename in files:
                    file_path = os.path.join(root, filename)
                    
                    if self.event_handler._should_ignore_file(file_path):
                        continue
                    
                    # Get all matching modes for this file
                    matching_modes = self.sync_tracker.get_all_matching_modes(file_path)
                    
                    # Check if this specific chunking mode should monitor this file
                    for mode, folder in matching_modes:
                        if mode == chunking_mode and os.path.abspath(folder) == os.path.abspath(folder_path):
                            # Check if file has changed for this specific mode
                            if not self.sync_tracker.metadata_tracker.is_file_unchanged(file_path, chunking_mode):
                                # Only log once per file, but handle for all modes
                                print(f"Found changed file during scan: {os.path.basename(file_path)} (mode: {chunking_mode})")
                                self.sync_tracker.handle_file_event(file_path, 'modified')
                                break  # Only need to call handle_file_event once per file
            
        except Exception as e:
            print(f"Error scanning folder {folder_path}: {e}")
    
    def _check_for_deleted_files(self, chunking_mode: str, folder_path: str):
        """Check for files that exist in metadata but no longer exist on disk"""
        try:
            # Get all files that should be monitored for this chunking mode
            files_to_check = []
            for file_path, metadata in self.sync_tracker.metadata_tracker.metadata.items():
                if (metadata.get('chunking_mode') == chunking_mode and 
                    os.path.dirname(os.path.abspath(file_path)) == os.path.abspath(folder_path)):
                    files_to_check.append(file_path)
            
            # Check which files no longer exist
            for file_path in files_to_check:
                if not os.path.exists(file_path):
                    print(f"Found deleted file during startup scan: {file_path}")
                    # Add to sync queue as deleted
                    self.sync_tracker.handle_file_event(file_path, 'deleted')
                    
        except Exception as e:
            print(f"Error checking for deleted files in {folder_path}: {e}")
