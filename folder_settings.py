#!/usr/bin/env python3
"""
Folder settings management for storing exclusion patterns and indexing preferences
"""

import os
import json
from pathlib import Path
from typing import Dict, List, Optional, Set
import hashlib


class FolderSettings:
    """Manages persistent settings for indexed folders"""
    
    def __init__(self, app_name: str = "FileFinder"):
        self.app_name = app_name
        self.settings_file = self._get_settings_path()
        self.settings = self._load_settings()
    
    def _get_settings_path(self) -> Path:
        """Get the path to the settings file"""
        if os.name == 'nt':  # Windows
            settings_dir = Path(os.environ.get('APPDATA', '~')).expanduser() / self.app_name
        elif os.name == 'posix':  # macOS/Linux
            if os.uname().sysname == 'Darwin':  # macOS
                settings_dir = Path('~/Library/Application Support').expanduser() / self.app_name
            else:  # Linux
                settings_dir = Path('~/.local/share').expanduser() / self.app_name
        else:
            settings_dir = Path('~').expanduser() / f'.{self.app_name.lower()}'
        
        settings_dir.mkdir(parents=True, exist_ok=True)
        return settings_dir / 'folder_settings.json'
    
    def _load_settings(self) -> Dict:
        """Load settings from file"""
        if self.settings_file.exists():
            try:
                with open(self.settings_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError) as e:
                print(f"Warning: Could not load folder settings: {e}")
                return {}
        return {}
    
    def _save_settings(self):
        """Save settings to file"""
        try:
            with open(self.settings_file, 'w', encoding='utf-8') as f:
                json.dump(self.settings, f, indent=2, ensure_ascii=False)
        except IOError as e:
            print(f"Warning: Could not save folder settings: {e}")
    
    def _get_folder_key(self, folder_path: str) -> str:
        """Generate a consistent key for a folder path"""
        # Normalize path and create a hash to handle long paths
        normalized_path = os.path.normpath(os.path.abspath(folder_path))
        folder_hash = hashlib.md5(normalized_path.encode('utf-8')).hexdigest()[:16]
        folder_name = os.path.basename(normalized_path) or "root"
        return f"{folder_name}_{folder_hash}"
    
    def save_folder_settings(self, 
                           folders: List[str], 
                           excludes: List[str], 
                           max_size_mb: int,
                           chunking_mode: str = 'gist') -> str:
        """
        Save settings for a set of folders
        Returns a settings_key that can be used to retrieve these settings
        """
        # Create a settings key based on the folder set
        folder_paths = sorted([os.path.normpath(os.path.abspath(f)) for f in folders])
        combined_path = "|".join(folder_paths)
        settings_key = hashlib.md5(combined_path.encode('utf-8')).hexdigest()[:16]
        
        # Store the settings
        self.settings[settings_key] = {
            'folders': folder_paths,
            'excludes': excludes,
            'max_size_mb': max_size_mb,
            'chunking_mode': chunking_mode,
            'created_at': int(os.path.getmtime(self.settings_file) if self.settings_file.exists() else 0),
            'display_name': self._generate_display_name(folder_paths)
        }
        
        self._save_settings()
        return settings_key
    
    def _generate_display_name(self, folder_paths: List[str]) -> str:
        """Generate a human-readable name for a folder set"""
        if len(folder_paths) == 1:
            return os.path.basename(folder_paths[0]) or folder_paths[0]
        elif len(folder_paths) <= 3:
            names = [os.path.basename(path) or path for path in folder_paths]
            return ", ".join(names)
        else:
            first_name = os.path.basename(folder_paths[0]) or folder_paths[0]
            return f"{first_name} + {len(folder_paths) - 1} others"
    
    def get_folder_settings(self, settings_key: str) -> Optional[Dict]:
        """Get settings for a specific key"""
        return self.settings.get(settings_key)
    
    def get_exclusions_for_folders(self, folders: List[str]) -> List[str]:
        """Get the exclusion patterns for a set of folders"""
        folder_paths = sorted([os.path.normpath(os.path.abspath(f)) for f in folders])
        combined_path = "|".join(folder_paths)
        settings_key = hashlib.md5(combined_path.encode('utf-8')).hexdigest()[:16]
        
        settings = self.get_folder_settings(settings_key)
        if settings:
            return settings.get('excludes', [])
        
        # Return default exclusions if no saved settings
        return [
            'node_modules',
            '.git',
            '.DS_Store',
            '*.log',
            'dist',
            'build',
            '__pycache__',
            '.vscode',
            '.idea',
            '*.pyc'
        ]
    
    def get_max_size_for_folders(self, folders: List[str]) -> int:
        """Get the max file size setting for a set of folders"""
        folder_paths = sorted([os.path.normpath(os.path.abspath(f)) for f in folders])
        combined_path = "|".join(folder_paths)
        settings_key = hashlib.md5(combined_path.encode('utf-8')).hexdigest()[:16]
        
        settings = self.get_folder_settings(settings_key)
        if settings:
            return settings.get('max_size_mb', 10)
        
        return 10  # Default to 10MB
    
    def list_all_settings(self) -> Dict[str, Dict]:
        """Get all saved folder settings"""
        return self.settings.copy()
    
    def delete_settings(self, settings_key: str) -> bool:
        """Delete settings for a specific key"""
        if settings_key in self.settings:
            del self.settings[settings_key]
            self._save_settings()
            return True
        return False
    
    def cleanup_old_settings(self, days_old: int = 30) -> int:
        """Remove settings older than specified days"""
        import time
        current_time = time.time()
        cutoff_time = current_time - (days_old * 24 * 60 * 60)
        
        to_remove = []
        for key, settings in self.settings.items():
            if settings.get('created_at', 0) < cutoff_time:
                # Also check if the folders still exist
                folders_exist = all(os.path.exists(folder) for folder in settings.get('folders', []))
                if not folders_exist:
                    to_remove.append(key)
        
        for key in to_remove:
            del self.settings[key]
        
        if to_remove:
            self._save_settings()
        
        return len(to_remove)
    
    def get_indexed_folders(self) -> List[str]:
        """Get all unique indexed folders from all saved settings"""
        all_folders = set()
        for settings in self.settings.values():
            folders = settings.get('folders', [])
            for folder in folders:
                if os.path.exists(folder):  # Only include existing folders
                    all_folders.add(folder)
        return sorted(list(all_folders))


# Global instance
folder_settings = FolderSettings()