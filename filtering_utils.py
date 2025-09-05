#!/usr/bin/env python3
"""
Shared filtering utilities for file and directory filtering.

This module contains the common filtering logic used by both the indexing system
and the branch manifest change detection system to ensure consistency.
"""

import os
import fnmatch


def is_hidden_path(path):
    """Check if any component of the path is hidden (starts with '.') 
    
    This function should only be used for paths RELATIVE to the repository root,
    not absolute paths that might contain system directories like ~/.filesearcher
    """
    # Normalize path separators and remove leading/trailing separators
    path = path.replace('\\', '/').strip('/')
    
    if not path or path == '.':
        return False
    
    # Split into components
    path_parts = path.split('/')
    
    # Define common excluded directories (this list should be minimal for hidden path checking)
    exclude_dirs = {
        '.git', '.svn', '.hg', '.bzr',  # Version control
        '.vscode', '.idea',  # IDE
        '.DS_Store',  # macOS system
        '__pycache__', '.pytest_cache', '.mypy_cache',  # Python cache
    }
    
    # Check each part of the path for hidden components or excluded directories
    for part in path_parts:
        if part.startswith('.') and part not in ['.', '..']:
            return True
        if part in exclude_dirs:
            return True
    return False


def filter_hidden_dirs(dirs):
    """Filter out hidden directories from os.walk dirs list"""
    # Import here to avoid circular imports
    try:
        from config import SKIP_HIDDEN_FILES
    except ImportError:
        SKIP_HIDDEN_FILES = True
        
    if not SKIP_HIDDEN_FILES:
        return
    
    # Use the same exclusion logic as is_hidden_path
    exclude_dirs = {
        '.git', '.svn', '.hg', '.bzr',  # Version control
        '.vscode', '.idea', '.sublime-project', '.sublime-workspace',  # IDE
        '.DS_Store', '.Trash', '.Spotlight-V100',  # macOS system
        '.pytest_cache', '.mypy_cache', '__pycache__',  # Python cache
        '.npm', '.yarn', 'node_modules',  # Node.js
        '.next', '.nuxt', '.output',  # Framework build dirs
        'dist', 'build', '.dist', '.build',  # Common build directories
        'coverage', '.coverage', '.nyc_output',  # Coverage reports
    }
    
    # Modify dirs in-place to skip hidden directories
    # This prevents os.walk from descending into hidden directories
    dirs_to_remove = []
    for d in dirs:
        if d.startswith('.') or d in exclude_dirs:
            dirs_to_remove.append(d)
    
    for hidden_dir in dirs_to_remove:
        dirs.remove(hidden_dir)


def matches_exclusion_patterns(file_path, exclude_patterns):
    """Check if a file path matches any exclusion patterns
    
    Enhanced to properly handle directory exclusions and various pattern types:
    - Simple patterns (e.g., 'node_modules', '*.log') match any path component
    - Directory patterns (e.g., 'build/', 'dist/') match directories and their contents
    - Path patterns (e.g., 'src/build', '*/temp/*') match specific path structures
    - Extension patterns (e.g., '*.log', '*.tmp') match file extensions
    """
    if not exclude_patterns:
        return False
        
    # Normalize path separators
    file_path = file_path.replace('\\', '/')
    
    for pattern in exclude_patterns:
        pattern = pattern.replace('\\', '/')  # Normalize pattern separators
        pattern = pattern.strip()  # Remove whitespace
        
        if not pattern:
            continue
            
        # Handle different pattern types
        if pattern.startswith('/'):
            # Absolute path pattern (from root of repository)
            if fnmatch.fnmatch(file_path, pattern[1:]):
                return True
        elif pattern.endswith('/'):
            # Directory pattern - exclude the directory and all its contents
            dir_pattern = pattern[:-1]  # Remove trailing slash
            path_parts = file_path.split('/')
            
            # Check if any parent directory matches the pattern
            for i, part in enumerate(path_parts[:-1]):  # Exclude filename from check
                if fnmatch.fnmatch(part, dir_pattern):
                    return True
                    
            # Also check if the pattern matches a path segment
            for i in range(len(path_parts)):
                partial_path = '/'.join(path_parts[:i+1])
                if fnmatch.fnmatch(partial_path, f"*/{dir_pattern}") or fnmatch.fnmatch(partial_path, dir_pattern):
                    return True
        elif '/' in pattern:
            # Path pattern with directories
            if fnmatch.fnmatch(file_path, pattern) or fnmatch.fnmatch(file_path, f"*/{pattern}"):
                return True
        else:
            # Simple pattern - check file names and directory names
            path_parts = file_path.split('/')
            for part in path_parts:
                if fnmatch.fnmatch(part, pattern):
                    return True
                    
    return False


def get_filtering_constants():
    """Get filtering constants with fallback defaults"""
    try:
        from config import SKIP_HIDDEN_FILES, SKIP_SYSTEM_FILES
        return SKIP_HIDDEN_FILES, SKIP_SYSTEM_FILES
    except ImportError:
        # Fallback defaults
        return True, True