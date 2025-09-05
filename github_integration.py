"""
GitHub Integration Module

Handles GitHub OAuth authentication, repository management, and integration
with the FileFinder indexing system.
"""

import os
import json
import time
import requests
import keyring
import shutil
from typing import Dict, List, Optional, Tuple
from pathlib import Path
from git import Repo, GitCommandError
from github import Github, GithubException
from dataclasses import dataclass


@dataclass
class GitHubRepo:
    """Represents a GitHub repository"""
    id: int
    full_name: str
    name: str
    owner_login: str
    owner_avatar_url: str
    private: bool
    archived: bool
    default_branch: str
    html_url: str
    description: Optional[str]
    updated_at: str


@dataclass
class ConnectedRepo:
    """Represents a locally connected repository"""
    full_name: str
    local_path: str
    active_branch: str
    modes: List[str]
    excludes: List[str]
    max_size_mb: int
    status: str  # 'cloning', 'cloned', 'indexing', 'indexed', 'clone_failed', 'index_failed'
    last_fetch_ts: Optional[int] = None
    pending_changes: Optional[Dict] = None
    error_message: Optional[str] = None


class GitHubIntegration:
    """Handles GitHub OAuth and repository operations"""
    
    def __init__(self, client_id: str):
        self.client_id = client_id
        self.access_token = None
        self.github_client = None
        self.repos_dir = Path.home() / ".filesearcher" / "repos"
        self.repos_dir.mkdir(parents=True, exist_ok=True)
        self.connected_repos_file = self.repos_dir / "connected_repos.json"
        
        # Load existing access token
        self._load_access_token()
        
    def _load_access_token(self):
        """Load access token from secure keyring"""
        try:
            self.access_token = keyring.get_password("filesearcher", "github_token")
            if self.access_token:
                self.github_client = Github(self.access_token)
        except Exception as e:
            print(f"Warning: Could not load GitHub access token: {e}")
            
    def _save_access_token(self, token: str):
        """Save access token to secure keyring"""
        try:
            keyring.set_password("filesearcher", "github_token", token)
            self.access_token = token
            self.github_client = Github(token)
        except Exception as e:
            print(f"Error saving GitHub access token: {e}")
            raise
            
    def get_auth_status(self) -> Dict:
        """Get current GitHub authentication status"""
        if not self.access_token or not self.github_client:
            return {"connected": False}
            
        try:
            user = self.github_client.get_user()
            return {
                "connected": True,
                "user": {
                    "login": user.login,
                    "name": user.name or user.login,
                    "avatar_url": user.avatar_url
                }
            }
        except GithubException:
            return {"connected": False}
            
    def start_device_flow_auth(self) -> Dict:
        """Start GitHub Device Flow OAuth authentication"""
        try:
            print(f"DEBUG: Starting GitHub OAuth with client_id: {self.client_id}")
            
            # GitHub Device Flow - Step 1: Request device and user codes
            response = requests.post(
                "https://github.com/login/device/code",
                headers={
                    "Accept": "application/json",
                    "X-GitHub-Api-Version": "2022-11-28"
                },
                data={
                    "client_id": self.client_id,
                    "scope": "repo"
                }
            )
            
            print(f"DEBUG: GitHub response status: {response.status_code}")
            print(f"DEBUG: GitHub response: {response.text}")
            
            if response.status_code != 200:
                try:
                    error_data = response.json()
                    error_msg = error_data.get("error_description", error_data.get("error", f"HTTP {response.status_code}"))
                    return {"success": False, "error": f"GitHub API error: {error_msg}"}
                except:
                    return {"success": False, "error": f"GitHub API error: {response.status_code} - {response.text}"}
                
            auth_data = response.json()
            
            # Check if we got the expected fields
            required_fields = ["device_code", "user_code", "verification_uri"]
            missing_fields = [field for field in required_fields if field not in auth_data]
            if missing_fields:
                return {"success": False, "error": f"Missing fields in GitHub response: {missing_fields}"}
            
            # Store auth data for polling
            self._device_code = auth_data["device_code"]
            self._interval = auth_data.get("interval", 5)
            
            return {
                "success": True,
                "device_code": auth_data["device_code"],
                "user_code": auth_data["user_code"],
                "verification_uri": auth_data["verification_uri"],
                "expires_in": auth_data.get("expires_in", 900),
                "interval": auth_data.get("interval", 5)
            }
            
        except Exception as e:
            print(f"DEBUG: Exception in start_device_flow_auth: {e}")
            return {"success": False, "error": str(e)}
            
    def poll_for_token(self) -> Dict:
        """Poll GitHub for access token after user authorization"""
        if not hasattr(self, '_device_code'):
            return {"success": False, "error": "No active device flow"}
            
        try:
            response = requests.post(
                "https://github.com/login/oauth/access_token",
                headers={
                    "Accept": "application/json",
                    "X-GitHub-Api-Version": "2022-11-28"
                },
                data={
                    "client_id": self.client_id,
                    "device_code": self._device_code,
                    "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
                }
            )
            
            if response.status_code != 200:
                return {"success": False, "error": f"GitHub API error: {response.status_code}"}
                
            token_data = response.json()
            
            if "error" in token_data:
                if token_data["error"] == "authorization_pending":
                    return {"success": False, "pending": True}
                elif token_data["error"] == "slow_down":
                    return {"success": False, "slow_down": True}
                elif token_data["error"] == "expired_token":
                    return {"success": False, "error": "Authorization expired"}
                elif token_data["error"] == "access_denied":
                    return {"success": False, "error": "Authorization denied"}
                else:
                    return {"success": False, "error": token_data.get("error_description", "Unknown error")}
                    
            # Success! We have an access token
            access_token = token_data["access_token"]
            self._save_access_token(access_token)
            
            # Clean up device flow data
            if hasattr(self, '_device_code'):
                delattr(self, '_device_code')
            if hasattr(self, '_interval'):
                delattr(self, '_interval')
                
            return {"success": True, "access_token": access_token}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
            
    def logout(self) -> Dict:
        """Logout from GitHub (clear stored token)"""
        try:
            keyring.delete_password("filesearcher", "github_token")
            self.access_token = None
            self.github_client = None
            return {"success": True, "message": "Logged out successfully"}
        except Exception as e:
            return {"success": False, "error": str(e)}
            
    def get_repositories(self, page: int = 1) -> Dict:
        """Get user's GitHub repositories"""
        if not self.github_client:
            print("DEBUG: No GitHub client available")
            return {"repos": [], "has_more": False, "total_count": 0}
            
        try:
            print(f"DEBUG: Getting repositories page {page}")
            user = self.github_client.get_user()
            print(f"DEBUG: Got user: {user.login}")
            
            # Get repositories with simple iteration approach
            per_page = 30
            repos_paginated = user.get_repos(
                type="all",
                sort="updated", 
                direction="desc"
            )
            
            total_count = repos_paginated.totalCount
            print(f"DEBUG: Total repository count: {total_count}")
            
            # Simple pagination by skipping and taking
            start_idx = (page - 1) * per_page
            repo_list = []
            
            count = 0
            for repo in repos_paginated:
                if count < start_idx:
                    count += 1
                    continue
                if len(repo_list) >= per_page:
                    break
                    
                print(f"DEBUG: working on repo: {repo.full_name}")
                repo_list.append(GitHubRepo(
                    id=repo.id,
                    full_name=repo.full_name,
                    name=repo.name,
                    owner_login=repo.owner.login,
                    owner_avatar_url=repo.owner.avatar_url,
                    private=repo.private,
                    archived=repo.archived,
                    default_branch=repo.default_branch or "main",
                    html_url=repo.html_url,
                    description=repo.description,
                    updated_at=repo.updated_at.isoformat()
                ))
                count += 1
                
            # Calculate if there are more pages
            has_more = start_idx + len(repo_list) < total_count
            
            print(f"DEBUG: Returning {len(repo_list)} repos, total: {total_count}, has_more: {has_more}")
            return {
                "repos": [repo.__dict__ for repo in repo_list],
                "has_more": has_more,
                "total_count": total_count
            }
            
        except GithubException as e:
            print(f"DEBUG: GitHub exception in get_repositories: {e}")
            import traceback
            traceback.print_exc()
            return {"repos": [], "has_more": False, "total_count": 0, "error": str(e)}
        except Exception as e:
            print(f"DEBUG: General exception in get_repositories: {e}")
            import traceback
            traceback.print_exc()
            return {"repos": [], "has_more": False, "total_count": 0, "error": str(e)}
            
    def clone_repository(self, full_name: str, progress_callback=None) -> Dict:
        """Clone a GitHub repository locally with progress tracking"""
        if not self.github_client:
            return {"success": False, "error": "Not authenticated"}
            
        # Immediately add repo to connected list with "cloning" status
        try:
            repo = self.github_client.get_repo(full_name)
            repo_dir = self.repos_dir / full_name.replace("/", "_")
            
            # Create initial connected repo entry
            initial_config = ConnectedRepo(
                full_name=full_name,
                local_path=str(repo_dir),
                active_branch=repo.default_branch or "main",
                modes=["gist"],  # Default mode
                excludes=["node_modules/", ".git/", ".DS_Store", "*.log", "dist/", "build/", "target/", ".next/"],
                max_size_mb=10,
                status="cloning"
            )
            self.save_connected_repo(initial_config)
            
        except Exception as e:
            return {"success": False, "error": f"Failed to access repository: {str(e)}"}
            
        try:
            # Create local directory
            if repo_dir.exists():
                print(f"DEBUG: Removing existing repo directory: {repo_dir}")
                shutil.rmtree(repo_dir)
                
            # Ensure parent directory exists
            repo_dir.parent.mkdir(parents=True, exist_ok=True)
            
            # Clone repository with shallow clone for speed
            clone_url = f"https://{self.access_token}@github.com/{full_name}.git"
            
            print(f"DEBUG: Starting shallow clone of {full_name}")
            if progress_callback:
                progress_callback("Connecting to GitHub...", 0)
                
            # Perform shallow clone (depth=1) for faster initial clone
            from git import RemoteProgress
            
            class CloneProgress(RemoteProgress):
                def __init__(self, callback=None):
                    super().__init__()
                    self.callback = callback
                    self._last_progress = 0
                    
                def update(self, op_code, cur_count, max_count=None, message=''):
                    if self.callback and max_count:
                        progress = (cur_count / max_count) * 100
                        # Only update if progress has changed significantly
                        if abs(progress - self._last_progress) >= 5:
                            self._last_progress = progress
                            stage_msg = "Receiving objects" if op_code & self.RECEIVING else "Resolving deltas"
                            self.callback(f"{stage_msg}... ({cur_count}/{max_count})", progress)
            
            progress_handler = CloneProgress(progress_callback) if progress_callback else None
            
            # Perform shallow clone (depth=1) for maximum speed - only main branch
            git_repo = Repo.clone_from(
                clone_url, 
                repo_dir,
                depth=1,  # Shallow clone for speed - branches fetched on demand
                progress=progress_handler
            )
            
            if progress_callback:
                progress_callback("Clone completed", 100)
            
            print(f"DEBUG: cloned {full_name} to {repo_dir}")
            
            # Update status to "cloned"
            self.update_repo_status(full_name, "cloned")
            
            return {
                "success": True,
                "local_path": str(repo_dir),
                "default_branch": repo.default_branch or "main"
            }
            
        except Exception as e:
            print(f"DEBUG: Clone failed for {full_name}: {e}")
            import traceback
            traceback.print_exc()
            
            # Update status to "clone_failed" with error message
            self.update_repo_status(full_name, "clone_failed", str(e))
            
            # Clean up partial clone on failure
            if 'repo_dir' in locals() and repo_dir.exists():
                try:
                    shutil.rmtree(repo_dir)
                except Exception:
                    pass
            return {"success": False, "error": str(e)}
    
    def get_local_file_tree(self, full_name: str) -> Dict:
        """Get file tree of locally cloned repository"""
        repo_dir = self.repos_dir / full_name.replace("/", "_")
        if not repo_dir.exists():
            return {"success": False, "error": "Repository not cloned locally"}
            
        try:
            def build_tree_node(path: Path, root_path: Path) -> dict:
                relative_path = str(path.relative_to(root_path))
                node = {
                    "path": relative_path,
                    "name": path.name,
                    "type": "directory" if path.is_dir() else "file"
                }
                
                if path.is_file():
                    try:
                        node["size"] = path.stat().st_size
                    except OSError:
                        node["size"] = 0
                else:
                    # Directory - get children
                    children = []
                    try:
                        for child in sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                            # Include ALL files and directories for user selection
                            # Only skip the .git directory itself (not other hidden files/folders)
                            if child.name == '.git':
                                continue
                            children.append(build_tree_node(child, root_path))
                        node["children"] = children
                    except (OSError, PermissionError):
                        node["children"] = []
                        
                return node
            
            # Build tree starting from repo root
            tree = build_tree_node(repo_dir, repo_dir)
            tree["path"] = "."  # Root should be "."
            
            return {
                "success": True,
                "tree": tree
            }
            
        except Exception as e:
            print(f"DEBUG: Error building file tree for {full_name}: {e}")
            import traceback
            traceback.print_exc()
            return {"success": False, "error": str(e)}
    
    def checkout_local_branch(self, full_name: str, branch_name: str) -> Dict:
        """Checkout a branch in the locally cloned repository with on-demand fetching"""
        repo_dir = self.repos_dir / full_name.replace("/", "_")
        if not repo_dir.exists():
            return {"success": False, "error": "Repository not cloned locally"}
            
        try:
            from git import Repo as GitRepo
            git_repo = GitRepo(repo_dir)
            
            # Check for uncommitted changes and stash them if necessary
            if git_repo.is_dirty(untracked_files=True):
                print(f"DEBUG: Repository has uncommitted changes, stashing them")
                try:
                    # Stash all changes including untracked files
                    git_repo.git.stash("push", "-u", "-m", f"Auto-stash before switching to {branch_name}")
                    print(f"DEBUG: stashed changes")
                except Exception as stash_error:
                    print(f"DEBUG: Failed to stash changes: {stash_error}")
                    return {"success": False, "error": f"Failed to stash uncommitted changes: {str(stash_error)}"}
            
            # Check if branch exists locally first
            local_branches = [b.name for b in git_repo.branches]
            print(f"DEBUG: Local branches available: {local_branches}")
            
            if branch_name in local_branches:
                # Branch exists locally, just checkout
                print(f"DEBUG: Checking out existing local branch {branch_name}")
                git_repo.branches[branch_name].checkout()
            else:
                # Branch not available locally - fetch it on demand (shallow clone flow)
                print(f"DEBUG: Branch {branch_name} not available locally, fetching from remote...")
                
                try:
                    # Simple approach: fetch the specific branch and checkout
                    # This works well for shallow clones where we only want one branch at a time
                    print(f"DEBUG: Fetching branch {branch_name} from origin")
                    git_repo.git.fetch("origin", f"{branch_name}:{branch_name}")
                    
                    # Checkout the newly fetched local branch
                    git_repo.git.checkout(branch_name)
                    print(f"DEBUG: fetched and checked out {branch_name}")
                    
                except Exception as fetch_error:
                    print(f"DEBUG: Simple fetch failed: {fetch_error}")
                    # If simple fetch fails, the branch might not exist
                    return {"success": False, "error": f"Branch '{branch_name}' does not exist on remote repository or fetch failed: {str(fetch_error)}"}
            
            # Verify we're on the right branch
            current_branch = git_repo.active_branch.name
            if current_branch != branch_name:
                return {"success": False, "error": f"Failed to checkout branch {branch_name}, still on {current_branch}"}
            
            print(f"DEBUG: checked out branch {branch_name}")
            # Check if we stashed changes and inform the user
            stash_message = ""
            try:
                stash_list = git_repo.git.stash("list")
                if f"Auto-stash before switching to {branch_name}" in stash_list:
                    stash_message = " (uncommitted changes were stashed)"
            except:
                pass
            
            return {
                "success": True, 
                "message": f"checked out branch {branch_name}{stash_message}",
                "current_branch": current_branch
            }
            
        except Exception as e:
            print(f"DEBUG: Error checking out branch {branch_name} for {full_name}: {e}")
            import traceback
            traceback.print_exc()
            return {"success": False, "error": str(e)}
            
    def get_branches(self, full_name: str) -> Dict:
        """Get branches for a repository - shows all remote branches, fetched on demand"""
        branches = []
        
        # Get all remote branches from GitHub API
        if self.github_client:
            try:
                repo = self.github_client.get_repo(full_name)
                for branch in repo.get_branches():
                    branches.append({
                        "name": branch.name,
                        "commit": {
                            "sha": branch.commit.sha,
                            "message": branch.commit.commit.message.split('\n')[0]
                        },
                        "protected": branch.protected,
                        "available_locally": False  # All branches fetched on demand now
                    })
                    
                print(f"DEBUG: Found {len(branches)} remote branches for {full_name}")
                
            except GithubException as e:
                print(f"DEBUG: Failed to get remote branches: {e}")
                return {"branches": [], "error": str(e)}
        
        # Mark locally checked out branch as available
        repo_dir = self.repos_dir / full_name.replace("/", "_")
        if repo_dir.exists():
            try:
                from git import Repo as GitRepo
                git_repo = GitRepo(repo_dir)
                current_branch = git_repo.active_branch.name
                
                # Mark current branch as locally available
                for branch in branches:
                    if branch["name"] == current_branch:
                        branch["available_locally"] = True
                        break
                        
                print(f"DEBUG: Currently on branch: {current_branch}")
                
            except Exception as e:
                print(f"DEBUG: Error checking current branch: {e}")
                
        return {"branches": branches}
    
    def get_stash_info(self, full_name: str) -> Dict:
        """Get information about stashed changes in a repository"""
        repo_dir = self.repos_dir / full_name.replace("/", "_")
        if not repo_dir.exists():
            return {"success": False, "error": "Repository not cloned locally"}
            
        try:
            from git import Repo as GitRepo
            git_repo = GitRepo(repo_dir)
            
            stash_list = git_repo.git.stash("list").split('\n') if git_repo.git.stash("list") else []
            stashes = []
            
            for stash in stash_list:
                if stash.strip():
                    stashes.append({
                        "ref": stash.split(':')[0],
                        "message": stash.split(': ', 1)[1] if ': ' in stash else stash
                    })
            
            return {
                "success": True,
                "stashes": stashes,
                "count": len(stashes)
            }
            
        except Exception as e:
            return {"success": False, "error": str(e)}
            
    def checkout_branch(self, full_name: str, branch_name: str) -> Dict:
        """Checkout a different branch in local repository"""
        try:
            repo_dir = self.repos_dir / full_name.replace("/", "_")
            if not repo_dir.exists():
                return {"success": False, "error": "Repository not cloned locally"}
                
            git_repo = Repo(repo_dir)
            
            # Fetch latest changes
            git_repo.remotes.origin.fetch()
            
            # Checkout branch
            if branch_name in [b.name for b in git_repo.branches]:
                git_repo.branches[branch_name].checkout()
            else:
                # Create tracking branch for remote branch
                git_repo.create_head(branch_name, f"origin/{branch_name}")
                git_repo.branches[branch_name].checkout()
                
            return {"success": True, "message": f"Switched to branch {branch_name}"}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
            
    def fetch_repository(self, full_name: str) -> Dict:
        """Fetch latest changes from remote repository"""
        try:
            repo_dir = self.repos_dir / full_name.replace("/", "_")
            if not repo_dir.exists():
                return {"success": False, "error": "Repository not cloned locally"}
                
            git_repo = Repo(repo_dir)
            
            # Get current branch
            current_branch = git_repo.active_branch.name
            
            # Fetch changes from remote
            fetch_info = git_repo.remotes.origin.fetch()
            
            # Check how many commits we're ahead/behind (with safer error handling)
            ahead = 0
            behind = 0
            
            try:
                # Ensure we have the remote branch reference
                remote_branch_ref = f'origin/{current_branch}'
                
                # Check if remote branch exists
                if remote_branch_ref in [str(ref) for ref in git_repo.refs]:
                    ahead = len(list(git_repo.iter_commits(f'{remote_branch_ref}..HEAD')))
                    behind = len(list(git_repo.iter_commits(f'HEAD..{remote_branch_ref}')))
                else:
                    # If remote branch doesn't exist, we can't compare
                    print(f"Remote branch {remote_branch_ref} not found")
            except Exception as compare_error:
                print(f"Error comparing branches: {compare_error}")
                # Continue without ahead/behind info
            
            return {
                "success": True,
                "message": "Fetch completed",
                "ahead": ahead,
                "behind": behind,
                "timestamp": int(time.time())
            }
            
        except Exception as e:
            return {"success": False, "error": str(e)}
            
    def pull_repository(self, full_name: str, branch: str) -> Dict:
        """Pull latest changes and return changed files"""
        try:
            repo_dir = self.repos_dir / full_name.replace("/", "_")
            if not repo_dir.exists():
                return {"success": False, "error": "Repository not cloned locally"}
                
            git_repo = Repo(repo_dir)
            
            # Get current HEAD
            old_head = git_repo.head.commit.hexsha
            
            # Pull changes
            git_repo.remotes.origin.pull(branch)
            
            # Get new HEAD
            new_head = git_repo.head.commit.hexsha
            
            # Get changed files
            changed_files = {"added": [], "modified": [], "removed": []}
            if old_head != new_head:
                for item in git_repo.head.commit.diff(old_head):
                    if item.change_type == 'A':
                        changed_files["added"].append(item.b_path)
                    elif item.change_type == 'M':
                        changed_files["modified"].append(item.b_path)
                    elif item.change_type == 'D':
                        changed_files["removed"].append(item.a_path)
                        
            return {
                "success": True,
                "message": "Pull completed",
                "changed_files": changed_files,
                "head_commit": new_head
            }
            
        except Exception as e:
            return {"success": False, "error": str(e)}
            
    def save_connected_repo(self, repo_config: ConnectedRepo):
        """Save connected repository configuration"""
        connected_repos = self.load_connected_repos()
        
        # Update or add repo
        updated = False
        for i, existing in enumerate(connected_repos):
            if existing["full_name"] == repo_config.full_name:
                connected_repos[i] = repo_config.__dict__
                updated = True
                break
                
        if not updated:
            connected_repos.append(repo_config.__dict__)
            
        # Save to file
        with open(self.connected_repos_file, 'w') as f:
            json.dump(connected_repos, f, indent=2)
    
    def update_repo_status(self, full_name: str, status: str, error_message: str = None):
        """Update the status of a connected repository"""
        connected_repos = self.load_connected_repos()
        
        for i, repo in enumerate(connected_repos):
            if repo["full_name"] == full_name:
                connected_repos[i]["status"] = status
                if error_message:
                    connected_repos[i]["error_message"] = error_message
                elif "error_message" in connected_repos[i]:
                    # Clear error message if status is successful
                    if status in ["cloned", "indexed"]:
                        connected_repos[i]["error_message"] = None
                break
        
        # Save updated config
        with open(self.connected_repos_file, 'w') as f:
            json.dump(connected_repos, f, indent=2)
            
    def load_connected_repos(self) -> List[Dict]:
        """Load connected repositories configuration"""
        if not self.connected_repos_file.exists():
            return []
            
        try:
            with open(self.connected_repos_file, 'r') as f:
                return json.load(f)
        except Exception:
            return []
            
    def remove_connected_repo(self, full_name: str):
        """Remove a connected repository"""
        connected_repos = self.load_connected_repos()
        connected_repos = [r for r in connected_repos if r["full_name"] != full_name]
        
        with open(self.connected_repos_file, 'w') as f:
            json.dump(connected_repos, f, indent=2)
            
        # Also remove local directory
        repo_dir = self.repos_dir / full_name.replace("/", "_")
        if repo_dir.exists():
            shutil.rmtree(repo_dir)