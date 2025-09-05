#!/usr/bin/env python3
"""
FileFinder Complete Data Cleanup Script

This script completely removes all indexed data, cached embeddings, and metadata
to provide a fresh start for FileFinder. It handles:
- Stopping running API processes
- Removing ChromaDB collections and data
- Clearing file metadata tracking
- Cleaning up any cache files

Usage: python cleanup.py
"""

import os
import sys
import shutil
import signal
import psutil
import platform
from pathlib import Path
import json
import time
try:
    import keyring
    KEYRING_AVAILABLE = True
except ImportError:
    KEYRING_AVAILABLE = False

class FileFinderCleanup:
    def __init__(self):
        self.app_name = "FileFinder"
        self.script_dir = Path(__file__).parent
        self.app_data_dir = self._get_app_data_dir()
        self.github_repos_dir = Path.home() / ".filesearcher" / "repos"
        self.processes_killed = []
        self.github_items_removed = []
        
    def _get_app_data_dir(self) -> Path:
        """Get platform-appropriate app data directory"""
        system = platform.system()
        
        if system == "Darwin":  # macOS
            base_dir = Path.home() / "Library" / "Application Support"
        elif system == "Windows":
            base_dir = Path(os.environ.get("LOCALAPPDATA", ""))
        else:  # Linux and others
            base_dir = Path.home() / ".local" / "share"
        
        return base_dir / self.app_name
    
    def find_running_processes(self):
        """Find all running FileFinder-related processes"""
        processes = []
        
        try:
            for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
                try:
                    cmdline = proc.info['cmdline']
                    if cmdline:
                        cmdline_str = ' '.join(cmdline)
                        
                        # Look for FileFinder API processes
                        if any(keyword in cmdline_str.lower() for keyword in [
                            'api.py', 'main.py', 'filefinder', 'filesearcher'
                        ]):
                            # Exclude this cleanup script itself
                            if 'cleanup.py' not in cmdline_str:
                                processes.append({
                                    'pid': proc.info['pid'],
                                    'name': proc.info['name'],
                                    'cmdline': cmdline_str
                                })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
                    
        except Exception as e:
            print(f"⚠️  Warning: Could not scan all processes: {e}")
            
        return processes
    
    def stop_running_processes(self):
        """Stop all running FileFinder processes"""
        print("🔍 Searching for running FileFinder processes...")
        
        processes = self.find_running_processes()
        
        if not processes:
            print("✅ No running FileFinder processes found")
            return
        
        print(f"📋 Found {len(processes)} running processes:")
        for proc in processes:
            print(f"   PID {proc['pid']}: {proc['cmdline'][:80]}...")
        
        print("🛑 Stopping processes...")
        
        for proc in processes:
            try:
                pid = proc['pid']
                process = psutil.Process(pid)
                
                # Try graceful termination first
                print(f"   Terminating PID {pid}...")
                process.terminate()
                
                # Wait up to 5 seconds for graceful shutdown
                try:
                    process.wait(timeout=5)
                    print(f"   ✅ PID {pid} terminated gracefully")
                    self.processes_killed.append(pid)
                except psutil.TimeoutExpired:
                    # Force kill if still running
                    print(f"   💀 Force killing PID {pid}...")
                    process.kill()
                    self.processes_killed.append(pid)
                    print(f"   ✅ PID {pid} force killed")
                    
            except psutil.NoSuchProcess:
                print(f"   ✅ PID {pid} already stopped")
            except psutil.AccessDenied:
                print(f"   ❌ Permission denied for PID {pid}")
            except Exception as e:
                print(f"   ❌ Error stopping PID {pid}: {e}")
    
    def remove_app_data(self):
        """Remove all application data"""
        print(f"📂 Checking app data directory: {self.app_data_dir}")
        
        if not self.app_data_dir.exists():
            print("✅ No app data directory found (already clean)")
            return
        
        print("📋 App data contents:")
        try:
            for item in self.app_data_dir.iterdir():
                if item.is_dir():
                    # Count items in subdirectories
                    try:
                        item_count = len(list(item.iterdir()))
                        print(f"   📁 {item.name}/ ({item_count} items)")
                    except PermissionError:
                        print(f"   📁 {item.name}/ (permission denied)")
                else:
                    file_size = item.stat().st_size
                    print(f"   📄 {item.name} ({file_size} bytes)")
        except Exception as e:
            print(f"   ⚠️  Could not list contents: {e}")
        
        print(f"🗑️  Removing entire app data directory...")
        try:
            shutil.rmtree(self.app_data_dir)
            print("✅ App data directory removed successfully")
        except PermissionError:
            print("❌ Permission denied - try running with sudo/admin privileges")
            return False
        except Exception as e:
            print(f"❌ Error removing app data: {e}")
            return False
        
        return True
    
    def remove_local_cache_files(self):
        """Remove any local cache files in the project directory"""
        print("🔍 Checking for local cache files...")
        
        patterns_to_remove = [
            "*.db",
            "*.sqlite*",
            "*metadata*.json",
            "chroma_db/",
            "*.log"
        ]
        
        files_removed = []
        
        for pattern in patterns_to_remove:
            if pattern.endswith('/'):
                # Directory pattern
                dir_name = pattern.rstrip('/')
                dir_path = self.script_dir / dir_name
                if dir_path.exists() and dir_path.is_dir():
                    try:
                        shutil.rmtree(dir_path)
                        files_removed.append(str(dir_path))
                        print(f"   🗑️  Removed directory: {dir_name}/")
                    except Exception as e:
                        print(f"   ❌ Could not remove {dir_name}/: {e}")
            else:
                # File pattern
                for file_path in self.script_dir.glob(pattern):
                    if file_path.is_file():
                        try:
                            file_path.unlink()
                            files_removed.append(str(file_path))
                            print(f"   🗑️  Removed file: {file_path.name}")
                        except Exception as e:
                            print(f"   ❌ Could not remove {file_path.name}: {e}")
        
        if not files_removed:
            print("✅ No local cache files found")
        else:
            print(f"✅ Removed {len(files_removed)} local cache items")
    
    def remove_github_data(self):
        """Remove GitHub authentication and repository data but preserve OAuth app setup"""
        print("🔍 Checking for GitHub integration data...")
        
        # Remove GitHub access token from keyring
        if KEYRING_AVAILABLE:
            try:
                existing_token = keyring.get_password("filesearcher", "github_token")
                if existing_token:
                    keyring.delete_password("filesearcher", "github_token")
                    self.github_items_removed.append("GitHub access token from keyring")
                    print("   🗑️  Removed GitHub access token from secure storage")
                else:
                    print("   ✅ No GitHub access token found in keyring")
            except Exception as e:
                print(f"   ⚠️  Could not check/remove GitHub token: {e}")
        else:
            print("   ⚠️  Keyring not available - cannot check for stored tokens")
        
        # Remove cloned GitHub repositories
        if self.github_repos_dir.exists():
            print(f"   📂 Found GitHub repos directory: {self.github_repos_dir}")
            
            # List repositories before removal
            try:
                repos = list(self.github_repos_dir.iterdir())
                if repos:
                    print(f"   📋 Found {len(repos)} cloned repositories:")
                    for repo in repos:
                        if repo.is_dir():
                            print(f"      📁 {repo.name}")
                    
                    # Remove the entire repos directory
                    shutil.rmtree(self.github_repos_dir)
                    self.github_items_removed.append(f"{len(repos)} cloned repositories")
                    print(f"   🗑️  Removed {len(repos)} cloned repositories")
                else:
                    print("   ✅ No cloned repositories found")
                    # Remove empty directory
                    self.github_repos_dir.rmdir()
            except Exception as e:
                print(f"   ❌ Error removing GitHub repos: {e}")
        else:
            print("   ✅ No GitHub repos directory found")
        
        # Remove connected repos configuration file
        connected_repos_file = self.github_repos_dir / "connected_repos.json"
        if connected_repos_file.exists():
            try:
                connected_repos_file.unlink()
                self.github_items_removed.append("connected repositories configuration")
                print("   🗑️  Removed connected repos configuration")
            except Exception as e:
                print(f"   ❌ Error removing connected repos config: {e}")
        
        # Note about OAuth app preservation
        print("   ℹ️  OAuth app configuration (Client ID) preserved in code")
        
        if self.github_items_removed:
            print(f"✅ GitHub cleanup completed - removed {len(self.github_items_removed)} items")
        else:
            print("✅ No GitHub data found to clean")
    
    def verify_cleanup(self):
        """Verify that cleanup was successful"""
        print("🔍 Verifying cleanup...")
        
        issues = []
        
        # Check app data directory
        if self.app_data_dir.exists():
            issues.append(f"App data directory still exists: {self.app_data_dir}")
        
        # Check for running processes
        processes = self.find_running_processes()
        if processes:
            issues.append(f"Found {len(processes)} still-running processes")
        
        # Check for local files
        local_files = []
        for pattern in ["*.db", "*.sqlite*", "chroma_db/"]:
            if pattern.endswith('/'):
                dir_path = self.script_dir / pattern.rstrip('/')
                if dir_path.exists():
                    local_files.append(str(dir_path))
            else:
                local_files.extend([str(p) for p in self.script_dir.glob(pattern)])
        
        if local_files:
            issues.append(f"Found {len(local_files)} remaining local cache files")
        
        # Check for GitHub data
        github_issues = []
        if KEYRING_AVAILABLE:
            try:
                token = keyring.get_password("filesearcher", "github_token")
                if token:
                    github_issues.append("GitHub access token still in keyring")
            except:
                pass
        
        if self.github_repos_dir.exists():
            github_issues.append("GitHub repos directory still exists")
        
        if github_issues:
            issues.extend(github_issues)
        
        if issues:
            print("⚠️  Cleanup verification found issues:")
            for issue in issues:
                print(f"   • {issue}")
            return False
        else:
            print("✅ Cleanup verification passed - all data removed!")
            return True
    
    def generate_report(self):
        """Generate a cleanup report"""
        report = {
            "timestamp": time.time(),
            "app_data_dir": str(self.app_data_dir),
            "github_repos_dir": str(self.github_repos_dir),
            "processes_killed": self.processes_killed,
            "github_items_removed": self.github_items_removed,
            "cleanup_successful": self.verify_cleanup()
        }
        
        report_file = self.script_dir / "cleanup_report.json"
        try:
            with open(report_file, 'w') as f:
                json.dump(report, f, indent=2)
            print(f"📄 Cleanup report saved: {report_file}")
        except Exception as e:
            print(f"⚠️  Could not save report: {e}")
    
    def run_cleanup(self):
        """Run the complete cleanup process"""
        print("🧹 FILEFINDER COMPLETE DATA CLEANUP")
        print("=" * 50)
        print("This will remove ALL indexed data, embeddings, and metadata.")
        print("You will need to re-index all files after cleanup.")
        print()
        
        # Confirmation prompt
        try:
            response = input("Are you sure you want to proceed? (yes/no): ").strip().lower()
            if response not in ['yes', 'y']:
                print("❌ Cleanup cancelled by user")
                return False
        except KeyboardInterrupt:
            print("\n❌ Cleanup cancelled by user")
            return False
        
        print("\n🚀 Starting cleanup process...")
        
        # Step 1: Stop running processes
        self.stop_running_processes()
        
        # Step 2: Remove app data
        if not self.remove_app_data():
            print("❌ Critical error during app data removal")
            return False
        
        # Step 3: Remove local cache files
        self.remove_local_cache_files()
        
        # Step 4: Remove GitHub data (but preserve OAuth setup)
        self.remove_github_data()
        
        # Step 5: Verify cleanup
        success = self.verify_cleanup()
        
        # Step 6: Generate report
        self.generate_report()
        
        print("\n" + "=" * 50)
        if success:
            print("🎉 CLEANUP COMPLETED SUCCESSFULLY!")
            print("✅ All FileFinder data has been removed")
            print("✅ Ready for fresh indexing")
            print("\nNext steps:")
            print("1. Start the API: python api.py")
            print("2. Index your folders with clean data")
            print("3. Test MSMarco vs AllMiniLM differences")
        else:
            print("⚠️  CLEANUP COMPLETED WITH ISSUES")
            print("Some files or processes may still remain")
            print("Check the cleanup report for details")
        
        return success

def main():
    """Main function"""
    if len(sys.argv) > 1 and sys.argv[1] in ['-h', '--help']:
        print(__doc__)
        return
    
    cleaner = FileFinderCleanup()
    success = cleaner.run_cleanup()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
