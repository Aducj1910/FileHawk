"""
FileFinder Metadata Tracker

Tracks file metadata to enable skipping re-embedding of unchanged files.
Maintains a sidecar JSON file alongside the ChromaDB database.
"""

import os
import json
import hashlib
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import platform

class MetadataTracker:
    """Tracks file metadata to optimize indexing by skipping unchanged files"""
    
    def __init__(self, app_name: str = "FileFinder"):
        self.app_name = app_name
        self.app_data_dir = self._get_app_data_dir()
        self.metadata_file = self.app_data_dir / "file_metadata.json"
        self.metadata: Dict[str, Dict] = {}
        self.load_metadata()
    
    def _get_app_data_dir(self) -> Path:
        """Get platform-appropriate app data directory"""
        system = platform.system()
        
        if system == "Darwin":  # macOS
            base_dir = Path.home() / "Library" / "Application Support"
        elif system == "Windows":
            base_dir = Path(os.environ.get("LOCALAPPDATA", ""))
        else:  # Linux and others
            base_dir = Path.home() / ".local" / "share"
        
        app_dir = base_dir / self.app_name
        app_dir.mkdir(parents=True, exist_ok=True)
        return app_dir
    
    def get_db_directory(self) -> Path:
        """Get the directory for ChromaDB persistent storage"""
        return self.app_data_dir / "chroma_db"
    
    def load_metadata(self):
        """Load existing metadata from the sidecar file"""
        if self.metadata_file.exists():
            try:
                with open(self.metadata_file, 'r', encoding='utf-8') as f:
                    loaded_metadata = json.load(f)
                
                # Migrate old format to new format if needed
                self.metadata = self._migrate_metadata_format(loaded_metadata)
                print(f"Loaded metadata for {len(self.metadata)} files")
            except Exception as e:
                print(f"Warning: Could not load metadata file: {e}")
                self.metadata = {}
        else:
            self.metadata = {}
            print("No existing metadata found, starting fresh")
    
    def save_metadata(self):
        """Save metadata to the sidecar file"""
        try:
            with open(self.metadata_file, 'w', encoding='utf-8') as f:
                json.dump(self.metadata, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving metadata: {e}")
    
    def calculate_file_hash(self, file_path: str) -> str:
        """Calculate SHA-256 hash of file content"""
        try:
            with open(file_path, 'rb') as f:
                file_hash = hashlib.sha256()
                chunk = f.read(8192)  # Read in chunks for large files
                while chunk:
                    file_hash.update(chunk)
                    chunk = f.read(8192)
                return file_hash.hexdigest()
        except Exception as e:
            print(f"Error calculating hash for {file_path}: {e}")
            return ""
    
    def get_file_stats(self, file_path: str) -> Tuple[str, float, int]:
        """Get file hash, modification time, and size"""
        try:
            stat = os.stat(file_path)
            file_hash = self.calculate_file_hash(file_path)
            mtime = stat.st_mtime
            size = stat.st_size
            return file_hash, mtime, size
        except Exception as e:
            print(f"Error getting stats for {file_path}: {e}")
            return "", 0, 0
    
    def is_file_unchanged(self, file_path: str, chunking_mode: str) -> bool:
        """
        Check if file has changed since last indexing for a specific chunking mode
        
        Returns:
            True if file is unchanged and can be skipped
            False if file needs re-indexing
        """
        if file_path not in self.metadata:
            return False
        
        file_info = self.metadata[file_path]
        
        # Check if this specific chunking mode exists
        if 'modes' not in file_info or chunking_mode not in file_info['modes']:
            return False
        
        mode_info = file_info['modes'][chunking_mode]
        
        # Get current file stats
        current_hash, current_mtime, current_size = self.get_file_stats(file_path)
        
        if not current_hash:
            return False
        
        # Check if file has changed for this mode
        stored_hash = mode_info.get('file_hash', '')
        stored_mtime = mode_info.get('last_modified', 0)
        stored_size = mode_info.get('file_size', 0)
        
        return (current_hash == stored_hash and 
                abs(current_mtime - stored_mtime) < 1.0 and  # Allow 1 second tolerance
                current_size == stored_size)
    
    def update_file_metadata(self, file_path: str, chunking_mode: str, 
                           num_chunks: int, chunk_sizes: List[int]):
        """Update metadata for a newly indexed file in a specific chunking mode"""
        file_hash, mtime, size = self.get_file_stats(file_path)
        
        # Initialize file entry if it doesn't exist
        if file_path not in self.metadata:
            self.metadata[file_path] = {
                'path': file_path,
                'modes': {}
            }
        
        # Update the specific mode's metadata
        self.metadata[file_path]['modes'][chunking_mode] = {
            'file_hash': file_hash,
            'last_modified': mtime,
            'file_size': size,
            'last_indexed': time.time(),
            'num_chunks': num_chunks,
            'chunk_sizes': chunk_sizes
        }
        
        self.save_metadata()
    
    def remove_file_metadata(self, file_path: str, chunking_mode: Optional[str] = None):
        """Remove metadata for a deleted file or specific mode"""
        if file_path not in self.metadata:
            return
        
        if chunking_mode is None:
            # Remove entire file entry
            del self.metadata[file_path]
        else:
            # Remove specific mode only
            if ('modes' in self.metadata[file_path] and 
                chunking_mode in self.metadata[file_path]['modes']):
                del self.metadata[file_path]['modes'][chunking_mode]
                
                # If no modes left, remove the entire file entry
                if not self.metadata[file_path]['modes']:
                    del self.metadata[file_path]
        
        self.save_metadata()
    
    def get_indexing_stats(self) -> Dict:
        """Get statistics about indexed files with proper multi-mode tracking"""
        # Count unique files across all modes
        total_files = len(self.metadata)
        
        # Calculate stats from metadata structure
        mode_stats = {
            'gist': {'files': 0, 'chunks': 0},
            'pinpoint': {'files': 0, 'chunks': 0}
        }
        
        total_chunks = 0
        
        for file_path, file_info in self.metadata.items():
            if 'modes' in file_info:
                for mode, mode_info in file_info['modes'].items():
                    if mode in mode_stats:
                        mode_stats[mode]['files'] += 1
                        chunks_for_mode = mode_info.get('num_chunks', 0)
                        mode_stats[mode]['chunks'] += chunks_for_mode
                        total_chunks += chunks_for_mode
        
        # Also get direct stats from ChromaDB collections for verification
        try:
            from api import gist_collection, pinpoint_collection
            
            try:
                gist_results = gist_collection.get()
                if gist_results and gist_results.get('metadatas'):
                    gist_files = {meta.get('path') for meta in gist_results['metadatas'] if meta.get('path') and meta.get('path') != 'None'}
                    print(f"ChromaDB Gist collection: {len(gist_files)} unique files, {len(gist_results['metadatas'])} total chunks")
            except Exception as e:
                print(f"Warning: Could not get gist collection stats: {e}")
            
            try:
                pinpoint_results = pinpoint_collection.get()
                if pinpoint_results and pinpoint_results.get('metadatas'):
                    pinpoint_files = {meta.get('path') for meta in pinpoint_results['metadatas'] if meta.get('path') and meta.get('path') != 'None'}
                    print(f"ChromaDB Pinpoint collection: {len(pinpoint_files)} unique files, {len(pinpoint_results['metadatas'])} total chunks")
            except Exception as e:
                print(f"Warning: Could not get pinpoint collection stats: {e}")
                
        except ImportError:
            print("Collections not available, using metadata only")
        
        return {
            'total_files': total_files,
            'total_chunks': total_chunks,
            'mode_stats': mode_stats,
            'metadata_file': str(self.metadata_file),
            'db_directory': str(self.get_db_directory())
        }
    
    def cleanup_orphaned_metadata(self, existing_files: List[str]):
        """Remove metadata for files that no longer exist"""
        existing_set = set(existing_files)
        orphaned = [path for path in self.metadata.keys() if path not in existing_set]
        
        for path in orphaned:
            self.remove_file_metadata(path)  # Remove all modes for this file
        
        if orphaned:
            print(f"Cleaned up metadata for {len(orphaned)} orphaned files")
    
    def get_files_to_index(self, file_paths: List[str], chunking_mode: str) -> Tuple[List[str], List[str]]:
        """
        Determine which files need indexing vs can be skipped for a specific chunking mode
        
        Returns:
            Tuple of (files_to_index, files_to_skip)
        """
        files_to_index = []
        files_to_skip = []
        
        for file_path in file_paths:
            if self.is_file_unchanged(file_path, chunking_mode):
                files_to_skip.append(file_path)
            else:
                files_to_index.append(file_path)
        
        return files_to_index, files_to_skip
    
    def has_file_in_mode(self, file_path: str, chunking_mode: str) -> bool:
        """Check if a file has been indexed in a specific chunking mode"""
        if file_path not in self.metadata:
            return False
        
        file_info = self.metadata[file_path]
        return ('modes' in file_info and chunking_mode in file_info['modes'])
    
    def get_files_for_mode(self, chunking_mode: str) -> List[str]:
        """Get all file paths that have been indexed in a specific chunking mode"""
        files = []
        
        for file_path, file_info in self.metadata.items():
            if ('modes' in file_info and chunking_mode in file_info['modes']):
                files.append(file_path)
        
        return files
    
    def clear_folder_metadata(self, folder_path: str, chunking_mode: Optional[str] = None):
        """
        Clear metadata for files within a specific folder
        Used to force re-indexing of a folder (e.g., GitHub repos)
        
        Args:
            folder_path: Path to the folder whose metadata should be cleared
            chunking_mode: If specified, only clear metadata for this mode
        """
        folder_path = os.path.abspath(folder_path)
        files_removed = []
        modes_removed = []
        
        # Remove metadata for all files within this folder
        for file_path in list(self.metadata.keys()):
            abs_file_path = os.path.abspath(file_path)
            if abs_file_path.startswith(folder_path):
                if chunking_mode is None:
                    # Remove entire file entry
                    del self.metadata[file_path]
                    files_removed.append(file_path)
                else:
                    # Remove only specific mode
                    if ('modes' in self.metadata[file_path] and 
                        chunking_mode in self.metadata[file_path]['modes']):
                        del self.metadata[file_path]['modes'][chunking_mode]
                        modes_removed.append(f"{file_path}:{chunking_mode}")
                        
                        # If no modes left, remove the entire file entry
                        if not self.metadata[file_path]['modes']:
                            del self.metadata[file_path]
                            files_removed.append(file_path)
        
        if files_removed or modes_removed:
            self.save_metadata()
            if chunking_mode:
                print(f"Cleared {chunking_mode} mode metadata for {len(modes_removed)} entries in {folder_path}")
                if files_removed:
                    print(f"Also removed {len(files_removed)} files with no remaining modes")
            else:
                print(f"Cleared metadata for {len(files_removed)} files in {folder_path}")
    
    def get_indexed_folders(self) -> Dict[str, Dict]:
        """
        Get all unique folders that have been indexed with their chunking modes
        
        Returns:
            Dict mapping folder_path -> {'chunking_modes': [list of modes]}
        """
        folder_info = {}
        
        for file_path, file_metadata in self.metadata.items():
            # Get the folder path
            folder_path = os.path.dirname(os.path.abspath(file_path))
            
            # Initialize folder entry if not exists
            if folder_path not in folder_info:
                folder_info[folder_path] = {
                    'chunking_modes': set()
                }
            
            # Add all chunking modes for this file
            if 'modes' in file_metadata:
                for mode in file_metadata['modes'].keys():
                    folder_info[folder_path]['chunking_modes'].add(mode)
        
        # Convert sets to lists for JSON serialization
        for folder_path in folder_info:
            folder_info[folder_path]['chunking_modes'] = list(folder_info[folder_path]['chunking_modes'])
        
        return folder_info
    
    def _migrate_metadata_format(self, loaded_metadata: Dict) -> Dict:
        """Migrate old metadata format to new multi-mode format"""
        migrated = {}
        
        for file_path, file_data in loaded_metadata.items():
            # Check if it's already in new format
            if 'modes' in file_data:
                migrated[file_path] = file_data
            else:
                # Convert old format to new format
                chunking_mode = file_data.get('chunking_mode', 'gist')
                migrated[file_path] = {
                    'path': file_data.get('path', file_path),
                    'modes': {
                        chunking_mode: {
                            'file_hash': file_data.get('file_hash', ''),
                            'last_modified': file_data.get('last_modified', 0),
                            'file_size': file_data.get('file_size', 0),
                            'last_indexed': file_data.get('last_indexed', time.time()),
                            'num_chunks': file_data.get('num_chunks', 0),
                            'chunk_sizes': file_data.get('chunk_sizes', [])
                        }
                    }
                }
                print(f"Migrated {file_path} from old format (mode: {chunking_mode})")
        
        if migrated != loaded_metadata:
            print(f"Migrated metadata format for {len(migrated)} files")
            self.save_metadata = lambda: self._save_metadata(migrated)
            self.save_metadata()
        
        return migrated
    
    def _save_metadata(self, metadata_to_save: Dict = None):
        """Internal save method for migration"""
        try:
            with open(self.metadata_file, 'w', encoding='utf-8') as f:
                json.dump(metadata_to_save or self.metadata, f, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"Error saving metadata: {e}")
    
    def clear_all_metadata(self):
        """Clear all metadata - used for complete data deletion"""
        self.metadata = {}
        self.save_metadata()
        print("All metadata cleared from tracker")