import React, { useState, useEffect } from 'react';
import { GitHubAuthStatus, GitHubRepo, ConnectedRepo, AppState, FilterOptions, GitHubBranch, SearchResult } from '../types';
import { api } from '../utils/api';
import { githubCache } from '../utils/githubCache';
import SearchBar from './SearchBar';
import SearchResults from './SearchResults';
import ErrorState from './ErrorState';
import EmptyState, { EmptyStates } from './EmptyState';
import LoadingSpinner from './LoadingSpinner';
import PostCloneModal from './PostCloneModal';
import GitHubFilterPopup from './GitHubFilterPopup';
import BranchSyncModal from './BranchSyncModal';
import BranchManager from './BranchManager';
import BranchSelector from './BranchSelector';
import CompactModeSelector from './CompactModeSelector';
import { RepositoryListSkeleton } from './LoadingSkeletons';
import GoldProgress from '../ui/GoldProgress';

interface GitHubConnectorPageProps {
  state: AppState;
  onSearch: (query: string, includeGranular: boolean, chunkingMode: 'gist' | 'pinpoint', filters?: FilterOptions) => void;
  onModeChange?: (mode: 'gist' | 'pinpoint') => void;
  onReindex: (filePath: string) => void;
  onToggleGranular: (filePath: string, enable: boolean) => void;
  onOpenFile: (filePath: string) => void;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  onFolderSelect: () => void;
  // Error handling
  searchError: string | null;
  onRetrySearch: () => void;
  focusSignal?: number;
  submitSignal?: number;
  clearSignal?: number;
}

const GitHubConnectorPage: React.FC<GitHubConnectorPageProps> = ({
  state,
  onSearch,
  onModeChange,
  onReindex,
  onToggleGranular,
  onOpenFile,
  onLoadMore,
  isLoadingMore,
  filters,
  onFiltersChange,
  onFolderSelect,
  searchError,
  onRetrySearch,
  focusSignal,
  submitSignal,
  clearSignal
}) => {
  const [authStatus, setAuthStatus] = useState<GitHubAuthStatus>({ connected: false });
  const [allRepos, setAllRepos] = useState<GitHubRepo[]>([]);
  const [connectedRepos, setConnectedRepos] = useState<ConnectedRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [reposPage, setReposPage] = useState(1);
  const [hasMoreRepos, setHasMoreRepos] = useState(true);
  const [repoSearch, setRepoSearch] = useState('');
  const [totalRepoCount, setTotalRepoCount] = useState(0);
  const [showPostCloneModal, setShowPostCloneModal] = useState(false);
  const [currentCloneRepo, setCurrentCloneRepo] = useState<GitHubRepo | null>(null);
  const [repoBranches, setRepoBranches] = useState<Record<string, GitHubBranch[]>>({});
  const [syncingRepos, setSyncingRepos] = useState<Set<string>>(new Set());
  const [fetchingRepos, setFetchingRepos] = useState<Set<string>>(new Set());
  const [githubFilters, setGithubFilters] = useState<FilterOptions>({
    ...filters,
    source: 'github',
    repos: []
  });
  const [showGithubFilterPopup, setShowGithubFilterPopup] = useState(false);
  const [authFlow, setAuthFlow] = useState<{
    user_code?: string;
    verification_uri?: string;
    device_code?: string;
  } | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [cloningRepos, setCloningRepos] = useState<Set<string>>(new Set());
  const [repoChanges, setRepoChanges] = useState<Record<string, {
    total_changes: number;
    has_changes: boolean;
    last_checked: number;
  }>>({});
  const [showBranchSyncModal, setShowBranchSyncModal] = useState<{
    repo: string;
    branch: string;
    changes: { added: string[]; modified: string[]; removed: string[] };
    totalChanges: number;
  } | null>(null);
  const [showBranchManager, setShowBranchManager] = useState<ConnectedRepo | null>(null);
  
  // Indexing progress tracking
  const [indexingProgress, setIndexingProgress] = useState<{
    repo: string | null;
    progress: number;
    total_files: number;
    current_file: string;
    message: string;
    indexing_type: 'local' | 'github' | null;
  }>({
    repo: null,
    progress: 0,
    total_files: 0,
    current_file: '',
    message: '',
    indexing_type: null
  });
  const [searchTab, setSearchTab] = useState<'search' | 'repositories'>('search');
  const [selectedRepos, setSelectedRepos] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('github-selected-repos');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Save selected repos to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('github-selected-repos', JSON.stringify(selectedRepos));
  }, [selectedRepos]);

  // Initialize selected repos with all indexed repos when connected repos change
  useEffect(() => {
    const indexedRepos = connectedRepos.filter(repo => repo.status === 'indexed');
    const indexedRepoNames = indexedRepos.map(repo => repo.full_name);
    
    // If no repos are selected, or if selected repos don't match current indexed repos, update selection
    if (selectedRepos.length === 0 || !selectedRepos.some(repo => indexedRepoNames.includes(repo))) {
      setSelectedRepos(indexedRepoNames);
    }
  }, [connectedRepos]);

  useEffect(() => {
    checkAuthStatus();
    loadCachedRepos();
  }, []); // Only run once on mount

  // Check for changes in indexed repositories
  useEffect(() => {
    if (connectedRepos.length === 0) return;
    
    const checkChangesForRepos = async () => {
      for (const repo of connectedRepos) {
        if (repo.status === 'indexed') {
          try {
            const result = await api.checkGitHubChanges(repo.full_name, repo.active_branch);
            if (result.success) {
              setRepoChanges(prev => ({
                ...prev,
                [repo.full_name]: {
                  total_changes: result.total_changes,
                  has_changes: result.has_changes,
                  last_checked: Date.now()
                }
              }));
            }
          } catch (error) {
            console.error(`Failed to check changes for ${repo.full_name}:`, error);
          }
        }
      }
    };
    
    // Check immediately
    checkChangesForRepos();
    
    // Set up periodic checking every 5 minutes
    const interval = setInterval(checkChangesForRepos, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [connectedRepos]);

  const loadCachedRepos = () => {
    const cached = githubCache.getCachedRepos();
    if (cached) {
      console.log(`Loading ${cached.repos.length} repositories from cache`);
      setAllRepos(cached.repos);
      setTotalRepoCount(cached.totalCount);
    }
  };

  const checkAuthStatus = async () => {
    try {
      const status = await api.getGitHubAuthStatus();
      setAuthStatus(status);
      if (status.connected) {
        // Only load from API if we don't have valid cache AND no repos loaded
        if (!githubCache.isCacheValid() && allRepos.length === 0) {
          console.log('No valid cache and no repos loaded, fetching from GitHub...');
          loadRepositories();
        }
        loadConnectedRepos();
      }
    } catch (error) {
      console.error('Failed to check GitHub auth status:', error);
      setAuthStatus({ connected: false });
    }
  };

  const handleConnect = async () => {
    try {
      setLoading(true);
      const result = await api.startGitHubAuth();
      if (result.success && result.user_code && result.verification_uri) {
        // Show device code flow UI
        setAuthFlow({
          user_code: result.user_code,
          verification_uri: result.verification_uri,
          device_code: result.device_code
        });
        // Start polling for authentication completion
        startPolling();
      } else {
        console.error('Failed to start GitHub auth:', result.error);
      }
    } catch (error) {
      console.error('Failed to connect to GitHub:', error);
    } finally {
      setLoading(false);
    }
  };

  const startPolling = async () => {
    setIsPolling(true);
    const poll = async () => {
      try {
        const result = await api.pollGitHubAuth();
        if (result.success) {
          // Authentication successful
          setAuthFlow(null);
          setIsPolling(false);
          checkAuthStatus(); // Refresh auth status
        } else if (result.pending) {
          // Still waiting for user to authorize
          setTimeout(poll, 5000); // Poll every 5 seconds
        } else if (result.slow_down) {
          // Rate limited, wait longer
          setTimeout(poll, 10000); // Poll every 10 seconds
        } else {
          // Error or expired
          console.error('GitHub auth error:', result.error);
          setAuthFlow(null);
          setIsPolling(false);
        }
      } catch (error) {
        console.error('Polling error:', error);
        setAuthFlow(null);
        setIsPolling(false);
      }
    };
    setTimeout(poll, 2000); // Start polling after 2 seconds
  };

  const loadRepositories = async (forceRefresh: boolean = false) => {
    // Check if we have valid cache and not forcing refresh
    if (!forceRefresh && githubCache.isCacheValid()) {
      const cached = githubCache.getCachedRepos();
      if (cached) {
        setAllRepos(cached.repos);
        setTotalRepoCount(cached.totalCount);
        return;
      }
    }
    
    try {
      console.log('Loading all repositories from GitHub...');
      setLoading(true);
      const allReposList: GitHubRepo[] = [];
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        const result = await api.getGitHubRepos(page);
        console.log(`GitHub repos result page ${page}:`, result);
        
        if (result && result.repos) {
          allReposList.push(...result.repos);
          hasMore = result.has_more || false;
          page++;
        } else {
          hasMore = false;
        }
      }
      
      console.log(`Loaded all ${allReposList.length} repositories from GitHub`);
      setAllRepos(allReposList);
      setTotalRepoCount(allReposList.length);
      setReposPage(1);
      
      // Cache the results
      githubCache.setCachedRepos(allReposList, allReposList.length);
    } catch (error) {
      console.error('Failed to load repositories:', error);
      setAllRepos([]);
      setTotalRepoCount(0);
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshRepos = async () => {
    setReposPage(1);
    setAllRepos([]);
    githubCache.clearCache();
    await loadRepositories(true);
  };

  const filteredRepos = allRepos.filter(repo => {
    if (!repoSearch) return true;
    return repo.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
           (repo.description && repo.description.toLowerCase().includes(repoSearch.toLowerCase()));
  });

  const REPOS_PER_PAGE = 30;
  const startIndex = (reposPage - 1) * REPOS_PER_PAGE;
  const endIndex = startIndex + REPOS_PER_PAGE;
  const paginatedRepos = filteredRepos.slice(startIndex, endIndex);
  const totalPages = Math.ceil(filteredRepos.length / REPOS_PER_PAGE);
  const hasNextPage = reposPage < totalPages;
  const hasPreviousPage = reposPage > 1;

  const loadConnectedRepos = async () => {
    try {
      const result = await api.getConnectedRepos();
      setConnectedRepos(result.repos || []);
      
      // Load branches for each connected repo that is successfully cloned
      for (const repo of (result.repos || [])) {
        if ((repo.status === 'cloned' || repo.status === 'indexed') && !repoBranches[repo.full_name]) {
          try {
            const branchResult = await api.getGitHubBranches(repo.full_name);
            setRepoBranches(prev => ({
              ...prev,
              [repo.full_name]: branchResult.branches
            }));
          } catch (error) {
            console.error(`Failed to load branches for ${repo.full_name}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load connected repos:', error);
      setConnectedRepos([]);
    }
  };

  const handleClone = async (repo: GitHubRepo) => {
    try {
      // Add to cloning set
      setCloningRepos(prev => new Set([...prev, repo.full_name]));
      setCurrentCloneRepo(repo);
      
      const result = await api.cloneGitHubRepo(repo.full_name);
      if (result.success) {
        setShowPostCloneModal(true);
        loadConnectedRepos(); // Refresh connected repos
      } else {
        console.error('Failed to clone repository:', result.error);
      }
    } catch (error) {
      console.error('Failed to clone repository:', error);
    } finally {
      // Remove from cloning set
      setCloningRepos(prev => {
        const newSet = new Set(prev);
        newSet.delete(repo.full_name);
        return newSet;
      });
    }
  };
  
  const handleCancelClone = async (repoFullName: string) => {
    try {
      await api.cancelGitHubClone();
      setCloningRepos(prev => {
        const newSet = new Set(prev);
        newSet.delete(repoFullName);
        return newSet;
      });
    } catch (error) {
      console.error('Error cancelling clone:', error);
    }
  };
  
  const handleRetryClone = async (repo: GitHubRepo) => {
    // Remove from cloning set first, then retry
    setCloningRepos(prev => {
      const newSet = new Set(prev);
      newSet.delete(repo.full_name);
      return newSet;
    });
    // Wait a moment then retry
    setTimeout(() => handleClone(repo), 500);
  };

  const handlePostCloneIndex = async (config: {
    branch: string;
    mode: 'gist' | 'pinpoint' | 'both';
    excludes: string[];
    maxSizeMb: number;
  }) => {
    if (!currentCloneRepo) return;
    
    console.log('🚀 Starting GitHub indexing with config:', config);
    console.log('📦 Repository:', currentCloneRepo.full_name);
    
    try {
      setLoading(true);
      console.log('📡 Sending indexing request...');
      
      const result = await api.indexGitHubRepo(
        currentCloneRepo.full_name,
        config.branch,
        config.mode,
        config.excludes,
        config.maxSizeMb
      );
      
      console.log('📝 Indexing result:', result);
      
      if (result.success) {
        console.log('✅ Indexing started, closing modal and monitoring progress');
        setShowPostCloneModal(false);
        setCurrentCloneRepo(null);
        
        // Start monitoring indexing progress
        setIndexingProgress({
          repo: currentCloneRepo.full_name,
          progress: 0,
          total_files: 0,
          current_file: '',
          message: 'Starting indexing...',
          indexing_type: 'github'
        });
        
        const checkProgress = setInterval(async () => {
          try {
            const status = await api.getStatus();
            
            // Update progress state
            setIndexingProgress(prev => ({
              ...prev,
              progress: status.progress,
              total_files: status.total_files,
              current_file: status.current_file || '',
              message: status.message || 'Indexing...',
              indexing_type: status.indexing_type || null
            }));
            
            if (!status.is_indexing) {
              // Indexing completed
              clearInterval(checkProgress);
              setIndexingProgress({
                repo: null,
                progress: 0,
                total_files: 0,
                current_file: '',
                message: '',
                indexing_type: null
              });
              loadConnectedRepos(); // Refresh connected repos list
              console.log('indexing done');
            }
          } catch (error) {
            console.error('Error checking indexing status:', error);
            clearInterval(checkProgress);
            setIndexingProgress({
              repo: null,
              progress: 0,
              total_files: 0,
              current_file: '',
              message: '',
              indexing_type: null
            });
          }
        }, 1000); // Check every second
        
        // Set a timeout to stop checking after 5 minutes
        setTimeout(() => {
          clearInterval(checkProgress);
          loadConnectedRepos();
        }, 300000);
      } else {
        console.error('❌ Indexing failed:', result.error);
        alert(`Indexing failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('❌ Failed to index repository:', error);
      alert(`Failed to index repository: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBranchSwitch = async (repoFullName: string, newBranch: string) => {
    try {
      // Step 1: Perform the checkout
      const result = await api.checkoutGitHubBranch(repoFullName, newBranch);
      
      if (result.success) {
        // Step 2: Update the active branch in local state immediately
        setConnectedRepos(prev => 
          prev.map(repo => 
            repo.full_name === repoFullName 
              ? { ...repo, active_branch: newBranch, pending_changes: undefined }
              : repo
          )
        );
        
        // Clear the change tracking for this repo since content changed
        setRepoChanges(prev => {
          const newChanges = { ...prev };
          delete newChanges[repoFullName];
          return newChanges;
        });
        
        console.log(`✅ Branch switched to ${newBranch} for ${repoFullName}`);
        
        // Step 3: Check if this branch has been indexed before
        const indexStatus = await api.getBranchIndexStatus(repoFullName, newBranch);
        
        if (!indexStatus.has_index) {
          // Step 3a: First time on this branch - prompt for full index
          console.log(`🆕 Branch ${newBranch} has never been indexed, prompting for initial index`);
          
          // Find the repo data for the modal
          const repoData = connectedRepos.find(r => r.full_name === repoFullName);
          if (repoData) {
            setCurrentCloneRepo({
              full_name: repoFullName,
              name: repoFullName.split('/')[1],
              default_branch: newBranch
            } as any);
            setShowPostCloneModal(true);
          }
        } else {
          // Step 3b: Branch was indexed before - check for changes
          console.log(`🔍 Branch ${newBranch} was indexed before, checking for changes...`);
          
          const changes = await api.checkGitHubChanges(repoFullName, newBranch);
          
          if (changes.has_changes && changes.total_changes > 0) {
            console.log(`📝 Found ${changes.total_changes} changes on branch ${newBranch}`);
            
            // Update the repo state to show pending changes
            setConnectedRepos(prev => 
              prev.map(repo => 
                repo.full_name === repoFullName 
                  ? { 
                      ...repo, 
                      pending_changes: {
                        count: changes.total_changes,
                        ahead: changes.changes.added.length + changes.changes.modified.length,
                        behind: changes.changes.removed.length
                      }
                    }
                  : repo
              )
            );
            
            // Update the change tracking
            setRepoChanges(prev => ({
              ...prev,
              [repoFullName]: {
                total_changes: changes.total_changes,
                has_changes: true,
                last_checked: Date.now()
              }
            }));
            
            // Optionally show a notification or highlight the sync button
            // The sync button will automatically be highlighted due to the state change
          } else {
            console.log(`✅ Branch ${newBranch} is up to date`);
          }
        }
      } else {
        console.error(`❌ Failed to switch branch: ${result.error}`);
        alert(`Failed to switch branch: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to switch branch:', error);
      alert(`Failed to switch branch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleRetryRepo = async (repoFullName: string) => {
    try {
      const result = await api.retryGitHubRepo(repoFullName);
      if (result.success) {
        if (result.needs_indexing && result.repo) {
          // Repository is ready for indexing, open the PostCloneModal
          setCurrentCloneRepo({
            full_name: result.repo.full_name,
            name: result.repo.full_name.split('/')[1],
            default_branch: result.repo.active_branch
          } as GitHubRepo);
          setShowPostCloneModal(true);
        } else {
          // Refresh connected repos to show updated status
          loadConnectedRepos();
        }
      } else {
        console.error('Failed to retry repository:', result.error);
      }
    } catch (error) {
      console.error('Failed to retry repository:', error);
    }
  };

  const handleFetch = async (repoFullName: string) => {
    try {
      setFetchingRepos(prev => new Set([...prev, repoFullName]));
      const result = await api.fetchGitHubRepo(repoFullName);
      
      if (result.success) {
        // Update connected repos with pending changes info
        setConnectedRepos(prev => 
          prev.map(repo => {
            if (repo.full_name === repoFullName) {
              const pendingChanges = (result.ahead || 0) + (result.behind || 0) > 0 
                ? {
                    count: (result.ahead || 0) + (result.behind || 0),
                    ahead: result.ahead || 0,
                    behind: result.behind || 0
                  }
                : undefined;
              
              return {
                ...repo,
                last_fetch_ts: result.timestamp || Date.now(),
                pending_changes: pendingChanges
              };
            }
            return repo;
          })
        );
      }
    } catch (error) {
      console.error('Failed to fetch repository:', error);
    } finally {
      setFetchingRepos(prev => {
        const newSet = new Set(prev);
        newSet.delete(repoFullName);
        return newSet;
      });
    }
  };

  const handleSync = async (repoFullName: string, branch?: string) => {
    try {
      setSyncingRepos(prev => new Set([...prev, repoFullName]));
      
      const repo = connectedRepos.find(r => r.full_name === repoFullName);
      if (!repo) return;
      
      const branchToSync = branch || repo.active_branch;
      const result = await api.syncGitHubRepo(repoFullName, branchToSync);
      
      if (result.success) {
        // Clear pending changes after successful sync
        setConnectedRepos(prev => 
          prev.map(r => 
            r.full_name === repoFullName 
              ? { ...r, pending_changes: undefined }
              : r
          )
        );
        
        // Clear enhanced change tracking
        setRepoChanges(prev => ({
          ...prev,
          [repoFullName]: {
            total_changes: 0,
            has_changes: false,
            last_checked: Date.now()
          }
        }));
      }
    } catch (error) {
      console.error('Failed to sync repository:', error);
    } finally {
      setSyncingRepos(prev => {
        const newSet = new Set(prev);
        newSet.delete(repoFullName);
        return newSet;
      });
    }
  };

  const handleOpenInGitHub = (repoFullName: string) => {
    const repo = allRepos.find(r => r.full_name === repoFullName) || 
                  { html_url: `https://github.com/${repoFullName}` };
    window.electronAPI?.openExternal?.(repo.html_url) || 
    window.open(repo.html_url, '_blank');
  };

  const handleGitHubSearch = (query: string, includeGranular: boolean, chunkingMode: 'gist' | 'pinpoint') => {
    // Build branch filters for selected indexed repos only
    const repoBranches: Record<string, string[]> = {};
    const selectedIndexedRepos = connectedRepos.filter(repo => 
      repo.status === 'indexed' && 
      selectedRepos.includes(repo.full_name) && 
      repo.active_branch
    );
    
    selectedIndexedRepos.forEach(repo => {
      repoBranches[repo.full_name] = [repo.active_branch];
    });
    
    // Merge with existing filters and add branch filtering
    const enhancedFilters = {
      ...githubFilters,
      source: 'github' as const,
      repos: selectedRepos, // Only search in selected repos
      repoBranches: repoBranches
    };
    
    console.log('GitHub Search - Selected repos:', selectedRepos);
    console.log('GitHub Search - Enhanced filters:', enhancedFilters);
    
    // Use GitHub-specific filters for search
    onSearch(query, includeGranular, chunkingMode, enhancedFilters);
  };

  const handleGitHubFiltersChange = (newFilters: FilterOptions) => {
    setGithubFilters(newFilters);
  };

  const handleGitHubFolderSelect = () => {
    // For GitHub, this could open a repo selector instead of a folder selector
    setShowGithubFilterPopup(true);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  // Repository selection helpers
  const getIndexedRepos = () => connectedRepos.filter(repo => repo.status === 'indexed');
  
  const toggleRepoSelection = (repoName: string) => {
    setSelectedRepos(prev => 
      prev.includes(repoName) 
        ? prev.filter(r => r !== repoName)
        : [...prev, repoName]
    );
  };

  const selectAllRepos = () => {
    const indexedRepoNames = getIndexedRepos().map(repo => repo.full_name);
    setSelectedRepos(indexedRepoNames);
  };

  const selectNoRepos = () => {
    setSelectedRepos([]);
  };

  if (!authStatus.connected) {
    return (
      <div className="space-y-6">
        {/* Connect to GitHub Card */}
        <div className="soft-card p-4">
          <div className="text-center max-w-sm mx-auto">
            <div className="w-10 h-10 bg-neutral-800 rounded-sm flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-neutral-300" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </div>
            
            {authFlow ? (
              <div className="max-w-md mx-auto">
                <div className="flex items-center space-x-2 mb-3">
                  <div className="w-5 h-5 bg-brand-gold-600 rounded-sm flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
                    </svg>
                  </div>
                  <h3 className="text-[14px] font-semibold text-neutral-100">
                    Complete GitHub Authorization
                  </h3>
                </div>
                <p className="text-[12px] text-neutral-400 mb-4">
                  Follow these steps to connect your GitHub account
                </p>
                
                {/* Step 1: Visit URL */}
                <div className="bg-brand-coal border border-brand-border rounded-sm p-3 mb-3">
                  <div className="flex items-start space-x-2">
                    <div className="w-4 h-4 bg-brand-gold-600 rounded-sm flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-brand-coal text-[10px] font-bold">1</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-[12px] font-medium text-neutral-200 mb-2">Open GitHub Device Login</p>
                      <a 
                        href={authFlow.verification_uri} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-2.5 py-1.5 bg-brand-gold-600 hover:bg-brand-gold-500 text-white text-[12px] font-medium rounded-sm transition-colors duration-150"
                      >
                        <svg className="w-3 h-3 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        Open GitHub
                      </a>
                    </div>
                  </div>
                </div>

                {/* Step 2: Enter Code */}
                <div className="bg-brand-coal border border-brand-border rounded-sm p-3 mb-4">
                  <div className="flex items-start space-x-2">
                    <div className="w-4 h-4 bg-brand-gold-600 rounded-sm flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-brand-coal text-[10px] font-bold">2</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-[12px] font-medium text-neutral-200 mb-2">Enter this code on GitHub:</p>
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 bg-neutral-800 border border-neutral-700 rounded-sm p-2">
                          <div className="font-mono text-[16px] font-bold text-neutral-100 text-center tracking-wider">
                            {authFlow.user_code}
                          </div>
                        </div>
                        <button
                          onClick={() => copyToClipboard(authFlow.user_code!)}
                          className={`px-2 py-2 rounded-sm border transition-all duration-150 ${
                            copySuccess 
                              ? 'bg-brand-gold-600 border-brand-gold-500 text-white' 
                              : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700 hover:border-neutral-600'
                          }`}
                          title="Copy code to clipboard"
                        >
                          {copySuccess ? (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </button>
                      </div>
                      {copySuccess && (
                        <p className="text-[11px] text-brand-gold-300 mt-1.5">
                          ✓ Code copied to clipboard!
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Waiting Animation */}
                {isPolling && (
                  <div className="text-center py-3">
                    <div className="inline-flex items-center space-x-2 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded-sm">
                      <div className="w-3 h-3 border-2 border-neutral-500 border-t-brand-gold-600 rounded-full animate-spin"></div>
                      <span className="text-neutral-300 text-[12px] font-medium">
                        Waiting for authorization...
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-500 mt-2">
                      This will update automatically once you authorize the app
                    </p>
                  </div>
                )}

                {/* Cancel Button */}
                <div className="text-center mt-4">
                  <button
                    onClick={() => {
                      setAuthFlow(null);
                      setIsPolling(false);
                    }}
                    className="text-[12px] text-neutral-400 hover:text-neutral-200 transition-colors px-2.5 py-1.5 rounded-sm hover:bg-neutral-800"
                  >
                    Cancel Authorization
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-[14px] font-semibold text-neutral-100 mb-2">
                  Connect to GitHub
                </h3>
                <p className="text-[12px] text-neutral-400 mb-4">
                  Connect your GitHub account to index and search through your private repositories alongside your local files.
                </p>
                <button
                  onClick={handleConnect}
                  disabled={loading}
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 text-neutral-200 rounded-sm hover:bg-neutral-700 hover:border-neutral-600 transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed text-[13px]"
                >
                  {loading ? (
                    <div className="flex items-center justify-center">
                      <div className="w-3 h-3 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin mr-2"></div>
                      Connecting...
                    </div>
                  ) : (
                    'Connect GitHub Account'
                  )}
                </button>
                <p className="text-[11px] text-neutral-500 mt-2">
                  We request minimal permissions to read your repositories. Your access token is stored securely in your OS keychain.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-brand-coal text-neutral-100">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="p-4 border-b border-neutral-800">
          <h1 className="text-2xl font-display text-brand-gold-300 mb-1">
            GitHub Integration
          </h1>
          <p className="text-sm text-neutral-400">
            Connect and manage your GitHub repositories for semantic search
          </p>
        </div>

        {/* Available Remote Repositories */}
        <div className="p-4 border-b border-neutral-800">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">Available Remote Repositories</h2>
              <p className="text-sm text-neutral-400">
                Connect repositories to index and search through your GitHub code
                {totalRepoCount > 0 && ` (${totalRepoCount} total)`}
              </p>
            </div>
            {authStatus.user && (
              <div className="flex items-center space-x-2">
                <img 
                  src={authStatus.user.avatar_url} 
                  alt={authStatus.user.name} 
                  className="w-6 h-6 rounded-full"
                />
                <span className="text-sm text-neutral-300">{authStatus.user.login}</span>
              </div>
            )}
          </div>
          
          {/* Search and Controls */}
          <div className="mb-3 flex items-center space-x-3">
            <div className="flex-1 relative">
              <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search repositories..."
                value={repoSearch}
                onChange={(e) => {
                  setRepoSearch(e.target.value);
                  setReposPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 bg-neutral-800 border border-neutral-700 rounded-sm text-[13px] text-neutral-200 placeholder-neutral-500 focus:outline-none focus:border-neutral-600"
              />
            </div>
            <button
              onClick={handleRefreshRepos}
              disabled={loading}
              className="px-2 py-1.5 text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh repositories"
            >
              {loading ? (
                <div className="w-3.5 h-3.5 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              )}
            </button>
          </div>
          
          {/* Repository Table */}
          <div className="bg-neutral-900 rounded border border-neutral-700 overflow-hidden">
          <div className="h-96 overflow-hidden flex flex-col">
            <div className="overflow-x-auto flex-1">
              <table className="w-full table-fixed">
                <thead className="bg-neutral-800 border-b border-neutral-700 sticky top-0">
                  <tr>
                    <th className="w-6 px-2 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      <div className="w-2 h-2 rounded-full bg-neutral-600"></div>
                    </th>
                    <th className="w-64 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Repository
                    </th>
                    <th className="w-48 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Description
                    </th>
                    <th className="w-20 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="w-24 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Updated
                    </th>
                    <th className="w-20 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-700 overflow-y-auto">
                  {loading ? (
                    Array.from({ length: 8 }, (_, i) => (
                      <tr key={i}>
                        <td className="px-2 py-2">
                          <div className="w-2 h-2 bg-neutral-600 rounded-full animate-pulse"></div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="space-y-1">
                            <div className="h-3 bg-neutral-600 rounded w-32 animate-pulse"></div>
                            <div className="h-2 bg-neutral-700 rounded w-16 animate-pulse"></div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="h-3 bg-neutral-600 rounded w-20 animate-pulse"></div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="h-3 bg-neutral-600 rounded w-16 animate-pulse"></div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="h-3 bg-neutral-600 rounded w-12 animate-pulse"></div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="h-6 bg-neutral-600 rounded w-16 animate-pulse"></div>
                        </td>
                      </tr>
                    ))
                  ) : paginatedRepos.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4">
                        {allRepos.length === 0 ? (
                          <EmptyState
                            {...EmptyStates.noConnectedRepos(
                              () => {
                                console.log('Connect repository requested');
                                // This could trigger repository selection
                              },
                              () => {
                                handleRefreshRepos();
                              }
                            )}
                            className="border-none bg-transparent p-4"
                          />
                        ) : (
                          <div className="text-center py-4">
                            <p className="text-[12px] text-neutral-400 mb-2">No repositories match your search</p>
                            <p className="text-[11px] text-neutral-500">Try adjusting your search terms</p>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    paginatedRepos.map((repo) => (
                      <tr key={repo.id} className="hover:bg-neutral-800 transition-colors">
                        <td className="px-2 py-2 whitespace-nowrap">
                          <div className={`w-2 h-2 rounded-full ${
                            repo.private ? 'bg-brand-gold-500' : 'bg-green-500'
                          }`}></div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-[12px] font-medium text-neutral-100 truncate" title={repo.full_name}>
                            {repo.full_name}
                          </div>
                          <div className="flex items-center space-x-1 mt-0.5">
                            {repo.private && (
                              <span className="text-[9px] px-1 py-0.5 bg-brand-gold-600/20 text-brand-gold-400 rounded-sm">Private</span>
                            )}
                            {repo.archived && (
                              <span className="text-[9px] px-1 py-0.5 bg-neutral-600/20 text-neutral-400 rounded-sm">Archived</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-[11px] text-neutral-400 truncate" title={repo.description || ''}>
                            {repo.description || 'No description'}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="text-[11px] text-neutral-300">
                            {repo.private ? 'Private' : 'Public'}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-[11px] text-neutral-300">
                          {new Date(repo.updated_at).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button
                            onClick={() => !cloningRepos.has(repo.full_name) && handleClone(repo)}
                            className="text-brand-gold-300 hover:text-brand-gold-200 text-[11px] font-medium hover:underline focus:outline-none focus:ring-1 focus:ring-brand-gold-500 rounded transition-colors"
                          >
                            {cloningRepos.has(repo.full_name) ? (
                              <div className="flex items-center space-x-1">
                                <div className="w-2 h-2 border border-brand-gold-500 border-t-transparent rounded-full animate-spin"></div>
                                <span className="text-[10px] text-neutral-400">Cloning</span>
                                <button
                                  onClick={() => handleCancelClone(repo.full_name)}
                                  className="text-[10px] text-red-400 hover:text-red-300 ml-1"
                                  title="Cancel"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              'Connect'
                            )}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          {/* Pagination Footer */}
          {(totalRepoCount > REPOS_PER_PAGE || filteredRepos.length > 0) && (
            <div className="bg-neutral-800 border-t border-neutral-700 px-4 py-2 flex items-center justify-between">
              <div className="text-[11px] text-neutral-400">
                {repoSearch ? (
                  `Showing ${Math.min(paginatedRepos.length, filteredRepos.length)} of ${filteredRepos.length} repositories (filtered)`
                ) : (
                  `Showing ${Math.min(endIndex, totalRepoCount)} of ${totalRepoCount} repositories`
                )}
              </div>
              
              {filteredRepos.length > REPOS_PER_PAGE && (
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => setReposPage(Math.max(1, reposPage - 1))}
                    disabled={!hasPreviousPage}
                    className="px-2 py-1 text-[11px] font-medium text-neutral-300 bg-neutral-700 border border-neutral-600 rounded hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-brand-gold-500 transition-colors"
                  >
                    Previous
                  </button>
                  
                  <div className="flex items-center space-x-1">
                    {Array.from({ length: Math.min(3, totalPages) }, (_, i) => {
                      const pageNum = Math.max(1, reposPage - 1) + i;
                      if (pageNum > totalPages) return null;
                      
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setReposPage(pageNum)}
                          className={`px-2 py-1 text-[11px] font-medium rounded focus:outline-none focus:ring-1 focus:ring-brand-gold-500 transition-colors ${
                            reposPage === pageNum
                              ? 'bg-brand-gold-600 text-white'
                              : 'text-neutral-300 bg-neutral-700 border border-neutral-600 hover:bg-neutral-600'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    })}
                  </div>
                  
                  <button
                    onClick={() => setReposPage(reposPage + 1)}
                    disabled={!hasNextPage}
                    className="px-2 py-1 text-[11px] font-medium text-neutral-300 bg-neutral-700 border border-neutral-600 rounded hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-brand-gold-500 transition-colors"
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
          </div>
        </div>

        {/* Connected Repos */}
        {connectedRepos.length > 0 && (
          <div className="p-4 border-b border-neutral-800">
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-neutral-100">Connected Repositories</h2>
              <p className="text-sm text-neutral-400">
                Repositories currently indexed and available for search
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {connectedRepos.map((repo) => {
              const branches = repoBranches[repo.full_name] || [];
              const isSyncing = syncingRepos.has(repo.full_name);
              const isFetching = fetchingRepos.has(repo.full_name);
              const hasError = repo.status === 'clone_failed' || repo.status === 'index_failed';
              const needsAction = hasError || repo.status === 'cloned';
              const changeInfo = repoChanges[repo.full_name];
              
              return (
                <div key={repo.full_name} className="border border-neutral-800 rounded p-3">
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center space-x-2">
                      <h3 className="font-medium text-neutral-200 truncate">{repo.full_name}</h3>
                      
                      {/* Status badges */}
                      {changeInfo && changeInfo.has_changes && repo.status === 'indexed' && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-orange-500/15 text-orange-400 border border-orange-500/25">
                          <svg className="w-2.5 h-2.5 mr-1" fill="currentColor" viewBox="0 0 16 16">
                            <path fillRule="evenodd" d="M8 2.5a5.487 5.487 0 00-4.131 1.869l1.204 1.204A.25.25 0 014.896 6H1.25A.25.25 0 011 5.75V2.104a.25.25 0 01.427-.177L2.73 3.23A7.987 7.987 0 018 .5a8.003 8.003 0 017.95 7.5.75.75 0 01-1.5.1A6.5 6.5 0 008 2.5zM1.705 8.005a.75.75 0 01.834.656 6.5 6.5 0 006.461 5.839 5.487 5.487 0 004.131-1.869l-1.204-1.204a.25.25 0 01.177-.427h3.646a.25.25 0 01.25.25v3.646a.25.25 0 01-.427.177l-1.38-1.38A7.987 7.987 0 018 15.5a8.003 8.003 0 01-7.95-7.5.75.75 0 01.655-.995z"/>
                          </svg>
                          SYNC AVAILABLE
                        </span>
                      )}
                      
                      {repo.status === 'indexed' && !changeInfo?.has_changes && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-green-500/15 text-green-400 border border-green-500/25">
                          <svg className="w-2.5 h-2.5 mr-1" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                          </svg>
                          UP TO DATE
                        </span>
                      )}
                      {hasError && (
                        <button
                          onClick={() => handleRetryRepo(repo.full_name)}
                          className="p-1 text-brand-gold-500 hover:text-brand-gold-400 transition-colors"
                          title={`${repo.status === 'clone_failed' ? 'Clone failed' : 'Index failed'} - Click to retry`}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.081 16.5c-.77.833.192 2.5 1.731 2.5z" />
                          </svg>
                        </button>
                      )}
                      {repo.status === 'cloned' && (
                        <button
                          onClick={() => handleRetryRepo(repo.full_name)}
                          className="p-1 text-brand-gold-500 hover:text-brand-gold-400 transition-colors"
                          title="Ready for indexing - Click to configure"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                      )}
                      {repo.status === 'cloning' && (
                        <div title="Cloning in progress">
                          <LoadingSpinner size="sm" variant="accent" />
                        </div>
                      )}
                      {repo.status === 'indexing' && (
                        <div title="Indexing in progress">
                          <LoadingSpinner size="sm" variant="primary" />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center space-x-1">
                      {repo.status === 'indexed' && (
                        <>
                          <button 
                            onClick={() => handleFetch(repo.full_name)}
                            disabled={isFetching || isSyncing}
                            className="p-1.5 text-neutral-400 hover:text-neutral-200 transition-colors disabled:opacity-50 hover:bg-neutral-800 rounded"
                            title="Fetch latest changes"
                          >
                            {isFetching ? (
                              <div className="w-3.5 h-3.5 border border-neutral-400 border-t-transparent rounded-full animate-spin"></div>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
                              </svg>
                            )}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {/* Status display */}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-neutral-400">Status:</span>
                      <span className={`capitalize ${
                        repo.status === 'indexed' ? 'text-green-400' :
                        repo.status === 'cloning' ? 'text-brand-gold-400' :
                        repo.status === 'cloned' ? 'text-brand-gold-400' :
                        repo.status === 'indexing' ? 'text-brand-gold-400' :
                        hasError ? 'text-red-400' : 'text-neutral-400'
                      }`}>
                        {repo.status === 'clone_failed' ? 'Clone Failed' :
                         repo.status === 'index_failed' ? 'Index Failed' :
                         repo.status === 'cloned' ? 'Ready to Index' :
                         repo.status}
                      </span>
                    </div>
                    {hasError && repo.error_message && (
                      <div className="text-[11px] text-red-400 bg-red-900/20 p-2 rounded border border-red-800">
                        {repo.error_message}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-neutral-400">Branch:</span>
                      <BranchSelector
                        currentBranch={repo.active_branch}
                        branches={branches}
                        onBranchChange={(branchName) => handleBranchSwitch(repo.full_name, branchName)}
                        disabled={isSyncing}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-neutral-400">Last fetch:</span>
                      <span className="text-neutral-300">
                        {repo.last_fetch_ts ? formatTimeAgo(repo.last_fetch_ts) : 'Never'}
                      </span>
                    </div>
                    
                    {/* Enhanced change information */}
                    {changeInfo && changeInfo.has_changes && (
                      <div className="text-[11px] space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-neutral-400">Pending changes:</span>
                          <span className="text-brand-gold-300 font-medium">
                            {changeInfo.total_changes} file{changeInfo.total_changes !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="text-[10px] text-neutral-500">
                          Last checked: {formatTimeAgo(changeInfo.last_checked)}
                        </div>
                      </div>
                    )}
                    
                    {/* Original pending changes display (for backward compatibility) */}
                    {repo.pending_changes && repo.pending_changes.count > 0 && (
                      <div className="text-[11px]">
                        <span className="text-brand-gold-300">
                          Sync available: {repo.pending_changes.count} changes
                        </span>
                        {repo.pending_changes.behind > 0 && (
                          <span className="text-neutral-500 ml-2">
                            ({repo.pending_changes.behind} behind)
                          </span>
                        )}
                      </div>
                    )}

                    {/* Indexing progress bar */}
                    {indexingProgress.repo === repo.full_name && indexingProgress.progress > 0 && indexingProgress.indexing_type === 'github' && (
                      <div className="mt-2">
                        <GoldProgress
                          value={indexingProgress.progress}
                          showLabel={true}
                          label="indexing progress"
                        />
                        <div className="text-[10px] text-neutral-400 mt-1">
                          {indexingProgress.current_file && (
                            <span>processing: {indexingProgress.current_file.split('/').pop()}</span>
                          )}
                          {indexingProgress.total_files > 0 && (
                            <span className="ml-2">
                              ({Math.round(indexingProgress.progress)}% of {indexingProgress.total_files} files)
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center space-x-1 text-[11px]">
                      <span className="text-neutral-500">Modes:</span>
                      {repo.modes.map(mode => (
                        <span key={mode} className="chip chip--muted text-[10px]">
                          {mode}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex space-x-1.5 mt-2.5">
                    <button 
                      onClick={() => handleSync(repo.full_name)}
                      disabled={isSyncing || (!changeInfo?.has_changes && (!repo.pending_changes || repo.pending_changes.count === 0))}
                      className={`flex-1 px-2.5 py-1.5 rounded text-[12px] font-medium transition-all duration-150 flex items-center justify-center space-x-1.5 ${
                        changeInfo?.has_changes || (repo.pending_changes && repo.pending_changes.count > 0) 
                          ? 'bg-brand-gold-600 border border-brand-gold-500 text-white hover:bg-brand-gold-500 shadow-sm'
                          : 'bg-neutral-800 border border-neutral-700 text-neutral-200 hover:bg-neutral-700'
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {isSyncing ? (
                        <>
                          <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin"></div>
                          <span>Syncing...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                            <path fillRule="evenodd" d="M8 2.5a5.487 5.487 0 00-4.131 1.869l1.204 1.204A.25.25 0 014.896 6H1.25A.25.25 0 011 5.75V2.104a.25.25 0 01.427-.177L2.73 3.23A7.987 7.987 0 018 .5a8.003 8.003 0 017.95 7.5.75.75 0 01-1.5.1A6.5 6.5 0 008 2.5zM1.705 8.005a.75.75 0 01.834.656 6.5 6.5 0 006.461 5.839 5.487 5.487 0 004.131-1.869l-1.204-1.204a.25.25 0 01.177-.427h3.646a.25.25 0 01.25.25v3.646a.25.25 0 01-.427.177l-1.38-1.38A7.987 7.987 0 018 15.5a8.003 8.003 0 01-7.95-7.5.75.75 0 01.655-.995z"/>
                          </svg>
                          <span>Sync{changeInfo?.has_changes ? ` (${changeInfo.total_changes})` : ''}</span>
                        </>
                      )}
                    </button>
                    <button 
                      onClick={() => setShowBranchManager(repo)}
                      className="px-2.5 py-1.5 bg-neutral-800 border border-neutral-700 text-neutral-200 hover:bg-neutral-700 transition-colors text-[12px] font-medium rounded flex items-center space-x-1.5"
                      title="Manage indexed branches"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                        <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.5 2.5 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
                      </svg>
                      <span>Branches</span>
                    </button>
                    <button 
                      onClick={() => handleOpenInGitHub(repo.full_name)}
                      className="px-2.5 py-1.5 text-neutral-400 hover:text-neutral-200 transition-colors text-[12px] font-medium rounded flex items-center space-x-1.5"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                      </svg>
                      <span>Open</span>
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        )}

        {/* GitHub Search Section */}
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">Search GitHub Repositories</h2>
              <p className="text-sm text-neutral-400">
                Search through your connected GitHub repositories
              </p>
            </div>
            {selectedRepos.length > 0 && (
              <div className="text-sm text-neutral-400">
                {selectedRepos.length} of {getIndexedRepos().length} repositories selected
              </div>
            )}
          </div>

          {/* Search Card with Tabs */}
          <div className="soft-card">
            {/* Tab Headers */}
            <div className="flex border-b border-neutral-700">
              <button
                onClick={() => setSearchTab('search')}
                className={`px-4 py-3 text-[13px] font-medium transition-colors ${
                  searchTab === 'search'
                    ? 'text-neutral-100 border-b-2 border-brand-gold-400'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <span>Search</span>
                </div>
              </button>
              <button
                onClick={() => setSearchTab('repositories')}
                className={`px-4 py-3 text-[13px] font-medium transition-colors ${
                  searchTab === 'repositories'
                    ? 'text-neutral-100 border-b-2 border-brand-gold-400'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                <div className="flex items-center space-x-2">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                  </svg>
                  <span>Repositories</span>
                  {selectedRepos.length > 0 && (
                    <span className="bg-brand-gold-400 text-brand-coal text-[10px] px-1.5 py-0.5 rounded-full font-medium">
                      {selectedRepos.length}
                    </span>
                  )}
                </div>
              </button>
            </div>

            {/* Tab Content */}
            <div className="p-0">
              {searchTab === 'search' ? (
                <div>
                  {/* Mode Selector and Search Description */}
                  <div className="px-4 pt-4 pb-2 border-b border-neutral-700/50">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[12px] text-neutral-400">
                          Search in {selectedRepos.length} selected repositories
                        </p>
                      </div>
                      <CompactModeSelector
                        selectedMode={state.currentChunkingMode}
                        onModeChange={onModeChange || (() => {})}
                        disabled={state.isLoading}
                      />
                    </div>
                  </div>
                  
                  <SearchBar 
                    onSearch={handleGitHubSearch}
                    isLoading={state.isLoading}
                    darkMode={true}
                    currentChunkingMode={state.currentChunkingMode}
                    filters={githubFilters}
                    onFiltersChange={handleGitHubFiltersChange}
                    onFolderSelect={handleGitHubFolderSelect}
                    focusSignal={focusSignal}
                    submitSignal={submitSignal}
                    clearSignal={clearSignal}
                  />
                  
                  {/* Selected Repositories Chips */}
                  {selectedRepos.length > 0 && selectedRepos.length < getIndexedRepos().length && (
                    <div className="px-4 pb-3">
                      <div className="text-[11px] text-neutral-500 mb-2">Searching in:</div>
                      <div className="flex flex-wrap gap-1">
                        {selectedRepos.slice(0, 3).map(repoName => (
                          <span key={repoName} className="inline-flex items-center px-2 py-1 rounded-sm text-[10px] bg-neutral-800 text-neutral-300 border border-neutral-700">
                            {repoName.split('/')[1] || repoName}
                            <button
                              onClick={() => toggleRepoSelection(repoName)}
                              className="ml-1 hover:text-neutral-100 transition-colors"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {selectedRepos.length > 3 && (
                          <span className="inline-flex items-center px-2 py-1 rounded-sm text-[10px] bg-neutral-800 text-neutral-400 border border-neutral-700">
                            +{selectedRepos.length - 3} more
                          </span>
                        )}
                        <button
                          onClick={() => setSearchTab('repositories')}
                          className="inline-flex items-center px-2 py-1 rounded-sm text-[10px] text-neutral-400 hover:text-neutral-200 border border-neutral-700 hover:border-neutral-600 transition-colors"
                        >
                          Edit selection
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Search Results or Error - Only shown in search tab */}
                  <div className="px-4 pb-4">
                    {searchError ? (
                      <ErrorState
                        title="GitHub Search Failed"
                        message={searchError}
                        onRetry={onRetrySearch}
                        retryLabel="Retry Search"
                      />
                    ) : (
                      <SearchResults
                        results={state.searchResults}
                        isLoading={state.isLoading}
                        onReindex={onReindex}
                        onToggleGranular={onToggleGranular}
                        onOpenFile={onOpenFile}
                        darkMode={true}
                        currentChunkingMode={state.currentChunkingMode}
                        hasMore={state.searchPagination.hasMore}
                        onLoadMore={onLoadMore}
                        isLoadingMore={isLoadingMore}
                        totalResults={state.searchPagination.totalResults}
                        page={state.searchPagination.page}
                        totalPages={state.searchPagination.totalPages}
                        currentQuery={state.searchPagination.lastQuery}
                        onSelectFolders={() => {
                          // For GitHub, this doesn't make as much sense, but could mean "connect more repos"
                          console.log('Select folders/repos requested');
                        }}
                        onChangeFilters={() => {
                          // Similar to HomePage, trigger filter changes
                          console.log('Change GitHub filters requested');
                        }}
                        onResultSelected={(r: SearchResult) => console.log('Selected result', r.file_path)}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-[13px] font-semibold text-neutral-200">
                        Repository Selection
                      </h3>
                      <p className="text-[11px] text-neutral-400 mt-0.5">
                        Choose which repositories to include in your searches
                      </p>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={selectAllRepos}
                        className="px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200 border border-neutral-700 rounded-sm hover:border-neutral-600 transition-colors"
                      >
                        Select All
                      </button>
                      <button
                        onClick={selectNoRepos}
                        className="px-2 py-1 text-[11px] text-neutral-400 hover:text-neutral-200 border border-neutral-700 rounded-sm hover:border-neutral-600 transition-colors"
                      >
                        Select None
                      </button>
                    </div>
                  </div>

                  {getIndexedRepos().length === 0 ? (
                    <div className="text-center py-12 text-neutral-400">
                      <div className="w-12 h-12 bg-neutral-800 rounded-sm flex items-center justify-center mx-auto mb-3">
                        <svg className="w-6 h-6 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                      </div>
                      <p className="text-[13px] font-medium text-neutral-300 mb-1">No Indexed Repositories</p>
                      <p className="text-[11px] text-neutral-500">
                        Connect and index repositories to make them available for search
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-0 max-h-96 overflow-y-auto border border-neutral-700 rounded-sm">
                      {getIndexedRepos().map((repo, index) => {
                        const isSelected = selectedRepos.includes(repo.full_name);
                        return (
                          <label
                            key={repo.full_name}
                            className={`flex items-center px-3 py-3 hover:bg-neutral-800/50 cursor-pointer transition-colors ${
                              index !== getIndexedRepos().length - 1 ? 'border-b border-neutral-700' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRepoSelection(repo.full_name)}
                              className="h-4 w-4 text-brand-gold-600 focus:ring-brand-gold-400 border-neutral-600 rounded bg-neutral-800 checked:bg-brand-gold-500 checked:border-brand-gold-500"
                            />
                            <div className="ml-3 flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                {/* GitHub Icon */}
                                <svg className="w-4 h-4 text-neutral-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                                </svg>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[13px] font-medium text-neutral-200 truncate">
                                    {repo.full_name}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center space-x-3 mt-1.5">
                                {/* Branch Badge */}
                                <div className="flex items-center space-x-1.5">
                                  <svg className="w-3 h-3 text-neutral-400" fill="currentColor" viewBox="0 0 16 16">
                                    <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.5 2.5 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
                                  </svg>
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] bg-neutral-800 text-neutral-300 border border-neutral-700">
                                    {repo.active_branch}
                                  </span>
                                </div>
                                {/* Mode Badges */}
                                {repo.modes && repo.modes.length > 0 && (
                                  <div className="flex items-center space-x-1">
                                    {repo.modes.includes('gist') && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] bg-blue-900/30 text-blue-300 border border-blue-700/30">
                                        Gist
                                      </span>
                                    )}
                                    {repo.modes.includes('pinpoint') && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm text-[9px] bg-green-900/30 text-green-300 border border-green-700/30">
                                        Pinpoint
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  
                  {/* Summary */}
                  {getIndexedRepos().length > 0 && (
                    <div className="mt-4 p-3 bg-neutral-800/50 rounded-sm border border-neutral-700">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-neutral-400">
                          {selectedRepos.length} of {getIndexedRepos().length} repositories selected
                        </span>
                        <span className="text-neutral-300">
                          Ready for search
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>

      {/* Post-Clone Configuration Modal */}
      <PostCloneModal
        isOpen={showPostCloneModal}
        repo={currentCloneRepo}
        onClose={() => {
          setShowPostCloneModal(false);
          setCurrentCloneRepo(null);
        }}
        onIndexStart={handlePostCloneIndex}
      />

      {/* GitHub Search Filter Popup */}
      <GitHubFilterPopup
        isOpen={showGithubFilterPopup}
        onClose={() => setShowGithubFilterPopup(false)}
        filters={githubFilters}
        onFiltersChange={handleGitHubFiltersChange}
        connectedRepos={connectedRepos}
        darkMode={true}
      />

      {/* Branch Sync Modal */}
      {showBranchSyncModal && (
        <BranchSyncModal
          isOpen={true}
          repo={showBranchSyncModal.repo}
          branch={showBranchSyncModal.branch}
          changes={showBranchSyncModal.changes}
          totalChanges={showBranchSyncModal.totalChanges}
          onSync={handleSync}
          onSkip={() => setShowBranchSyncModal(null)}
          onClose={() => setShowBranchSyncModal(null)}
        />
      )}

      {/* Branch Manager Modal */}
      {showBranchManager && (
        <BranchManager
          isOpen={true}
          repo={showBranchManager}
          onClose={() => setShowBranchManager(null)}
          onBranchDeleted={() => {
            // Optionally refresh the connected repos list
            loadConnectedRepos();
          }}
        />
      )}
      </div>
    </div>
  );
};

export default GitHubConnectorPage;