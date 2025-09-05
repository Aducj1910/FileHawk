#!/usr/bin/env python3
"""
Branch manifest tracking for GitHub repositories

This module tracks what files have been indexed for each branch of each repository,
enabling efficient change detection on branch switches.
"""

import os
import json
import hashlib
import time
from pathlib import Path
from typing import Dict, List, Optional, Set
import subprocess

# Import filtering functions from shared utilities module to ensure consistency
from filtering_utils import (
    is_hidden_path, 
    matches_exclusion_patterns, 
    filter_hidden_dirs,
    get_filtering_constants
)

# Get filtering constants
SKIP_HIDDEN_FILES, SKIP_SYSTEM_FILES = get_filtering_constants()
print("DEBUG MANIFEST: imported filtering functions from filtering_utils.py")

class BranchManifest:
    """Tracks file state for a specific repo branch"""
    
    def __init__(self, full_name: str, branch: str, manifest_dir: Optional[Path] = None):
        self.full_name = full_name
        self.branch = branch
        
        if manifest_dir is None:
            manifest_dir = Path.home() / ".filesearcher" / "manifests"
        
        self.manifest_dir = manifest_dir
        self.manifest_dir.mkdir(parents=True, exist_ok=True)
        
        # Create safe filename
        safe_name = full_name.replace("/", "_").replace("@", "_at_")
        self.manifest_file = self.manifest_dir / f"{safe_name}@{branch}.json"
        
        self.manifest_data = self._load_manifest()
    
    def _load_manifest(self) -> dict:
        """Load existing manifest or create new one"""
        if self.manifest_file.exists():
            try:
                with open(self.manifest_file, 'r') as f:
                    return json.load(f)
            except:
                pass
        
        return {
            "repo": self.full_name,
            "branch": self.branch,
            "last_updated": 0,
            "last_commit_sha": None,
            "files": {}
        }
    
    def _save_manifest(self):
        """Save manifest to disk"""
        try:
            with open(self.manifest_file, 'w') as f:
                json.dump(self.manifest_data, f, indent=2)
        except Exception as e:
            print(f"ERROR: Failed to save manifest: {e}")
    
    def _get_file_hash(self, file_path: str) -> str:
        """Get SHA256 hash of file contents"""
        try:
            with open(file_path, 'rb') as f:
                return hashlib.sha256(f.read()).hexdigest()
        except:
            return ""
    
    def update_file_manifest(self, repo_path: str, relative_file_paths: List[str], commit_sha: str = None):
        """
        Update the manifest with current file states
        
        Args:
            repo_path: Local path to the repository
            relative_file_paths: List of file paths relative to repo root
            commit_sha: Current commit SHA (will be detected if not provided)
        """
        if not commit_sha:
            commit_sha = self._get_current_commit(repo_path)
        
        current_time = int(time.time())
        
        for rel_path in relative_file_paths:
            full_path = os.path.join(repo_path, rel_path)
            
            if os.path.exists(full_path):
                try:
                    stat = os.stat(full_path)
                    file_hash = self._get_file_hash(full_path)
                    
                    self.manifest_data["files"][rel_path] = {
                        "hash": file_hash,
                        "size": stat.st_size,
                        "mtime": int(stat.st_mtime),
                        "indexed_at": current_time
                    }
                except Exception as e:
                    print(f"ERROR: Failed to process {rel_path}: {e}")
        
        self.manifest_data["last_updated"] = current_time
        self.manifest_data["last_commit_sha"] = commit_sha
        self._save_manifest()
    
    def _get_current_commit(self, repo_path: str) -> str:
        """Get current commit SHA"""
        try:
            result = subprocess.run(
                ['git', 'rev-parse', 'HEAD'],
                cwd=repo_path,
                capture_output=True,
                text=True
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except:
            pass
        return "unknown"
    
    def detect_changes(self, repo_path: str, custom_excludes: List[str] = None, max_size_mb: int = None) -> Dict[str, List[str]]:
        """
        Detect changes in the repository since last manifest update
        
        Args:
            repo_path: Path to the repository
            custom_excludes: List of exclusion patterns to filter out non-indexable files
        
        Returns:
            Dict with keys: added, modified, removed
        """
        changes = {
            "added": [],
            "modified": [],
            "removed": []
        }
        
        if not os.path.exists(repo_path):
            return changes
        
        # Get current files in repo using IDENTICAL logic to indexing function
        current_files = {}
        print(f"DEBUG MANIFEST: Starting file scan for change detection")
        print(f"DEBUG MANIFEST: repo_path={repo_path}")
        print(f"DEBUG MANIFEST: custom_excludes={custom_excludes}")
        print(f"DEBUG MANIFEST: SKIP_HIDDEN_FILES={SKIP_HIDDEN_FILES}, SKIP_SYSTEM_FILES={SKIP_SYSTEM_FILES}")
        
        for root, dirs, files in os.walk(repo_path):
            relative_root = os.path.relpath(root, repo_path).replace('\\', '/')
            
            # Use IDENTICAL filtering logic to indexing function
            # Filter out hidden directories (same as indexing)
            filter_hidden_dirs(dirs)
            
            # Filter out excluded directories (same as indexing) 
            if custom_excludes:
                dirs_to_remove = []
                for d in dirs[:]:
                    dir_path = os.path.join(root, d)
                    relative_dir_path = os.path.relpath(dir_path, repo_path).replace('\\', '/')
                    
                    if matches_exclusion_patterns(relative_dir_path, custom_excludes) or matches_exclusion_patterns(d, custom_excludes):
                        dirs_to_remove.append(d)
                
                # Remove excluded directories from dirs list to prevent os.walk from descending
                for excluded_dir in dirs_to_remove:
                    dirs.remove(excluded_dir)
            
            # Skip hidden directories (same as indexing - but not the root repo directory itself)
            if SKIP_HIDDEN_FILES and root != repo_path:
                relative_root = os.path.relpath(root, repo_path).replace('\\', '/')
                if is_hidden_path(relative_root):
                    continue
            
            for file in files:
                # Skip hidden files (same as indexing)
                if SKIP_HIDDEN_FILES and file.startswith('.'):
                    continue
                # Skip system files (same as indexing)
                if SKIP_SYSTEM_FILES and file.startswith('~'):
                    continue
                
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, repo_path).replace('\\', '/')
                
                # Skip files matching exclusion patterns (same as indexing)
                if custom_excludes:
                    if matches_exclusion_patterns(rel_path, custom_excludes) or matches_exclusion_patterns(file, custom_excludes):
                        continue
                
                try:
                    stat = os.stat(full_path)
                    
                    # Check file size if limit is set
                    if max_size_mb is not None and max_size_mb > 0:
                        file_size_mb = stat.st_size / (1024 * 1024)
                        if file_size_mb > max_size_mb:
                            continue  # Skip files that are too large
                    
                    file_hash = self._get_file_hash(full_path)
                    
                    current_files[rel_path] = {
                        "hash": file_hash,
                        "size": stat.st_size,
                        "mtime": int(stat.st_mtime)
                    }
                except:
                    continue
        
        manifest_files = self.manifest_data.get("files", {})
        
        # Check for added and modified files
        for rel_path, current_info in current_files.items():
            if rel_path not in manifest_files:
                changes["added"].append(rel_path)
            else:
                manifest_info = manifest_files[rel_path]
                if (current_info["hash"] != manifest_info.get("hash", "") or
                    current_info["size"] != manifest_info.get("size", 0)):
                    changes["modified"].append(rel_path)
        
        # Check for removed files
        for rel_path in manifest_files:
            if rel_path not in current_files:
                changes["removed"].append(rel_path)
        
        return changes
    
    def get_manifest_summary(self) -> dict:
        """Get summary of manifest state"""
        return {
            "repo": self.full_name,
            "branch": self.branch,
            "last_updated": self.manifest_data.get("last_updated", 0),
            "last_commit_sha": self.manifest_data.get("last_commit_sha"),
            "file_count": len(self.manifest_data.get("files", {})),
            "has_manifest": len(self.manifest_data.get("files", {})) > 0
        }
    
    def clear_manifest(self):
        """Clear the manifest (for re-indexing)"""
        self.manifest_data = {
            "repo": self.full_name,
            "branch": self.branch,
            "last_updated": 0,
            "last_commit_sha": None,
            "files": {}
        }
        self._save_manifest()

class BranchManifestManager:
    """Manages manifests for all repositories and branches"""
    
    def __init__(self, manifest_dir: Optional[Path] = None):
        if manifest_dir is None:
            manifest_dir = Path.home() / ".filesearcher" / "manifests"
        self.manifest_dir = manifest_dir
        self.manifest_dir.mkdir(parents=True, exist_ok=True)
    
    def get_manifest(self, full_name: str, branch: str) -> BranchManifest:
        """Get or create a manifest for a repo/branch"""
        return BranchManifest(full_name, branch, self.manifest_dir)
    
    def list_manifests(self, full_name: Optional[str] = None) -> List[dict]:
        """List all manifests, optionally filtered by repo"""
        manifests = []
        
        for manifest_file in self.manifest_dir.glob("*.json"):
            try:
                with open(manifest_file, 'r') as f:
                    data = json.load(f)
                
                repo = data.get("repo", "")
                if full_name is None or repo == full_name:
                    manifests.append({
                        "repo": repo,
                        "branch": data.get("branch", ""),
                        "last_updated": data.get("last_updated", 0),
                        "last_commit_sha": data.get("last_commit_sha"),
                        "file_count": len(data.get("files", {})),
                        "manifest_file": str(manifest_file)
                    })
            except:
                continue
        
        return sorted(manifests, key=lambda x: (x["repo"], x["branch"]))
    
    def delete_repo_manifests(self, full_name: str):
        """Delete all manifests for a repository"""
        safe_name = full_name.replace("/", "_").replace("@", "_at_")
        
        for manifest_file in self.manifest_dir.glob(f"{safe_name}@*.json"):
            try:
                manifest_file.unlink()
                print(f"Deleted manifest: {manifest_file}")
            except Exception as e:
                print(f"Error deleting {manifest_file}: {e}")

# Global instance
manifest_manager = BranchManifestManager()