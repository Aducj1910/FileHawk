import React, { useState, useEffect } from 'react';
import { AppState, IndexingStatus as IndexingStatusType, SearchResult, ConfigResponse, FilterOptions } from './types';
import { api } from './utils/api';
import { loadSettings } from './utils/settings';
import { loadHistory } from './utils/searchAssist';
import Sidebar from './components/Sidebar';
import HomePage from './components/HomePage';
import SettingsPage from './components/SettingsPage';
import TrackFilesPage from './components/TrackFilesPage';
import SavedPage from './components/SavedPage';
import GitHubConnectorPage from './components/GitHubConnectorPage';
import BrandHeader from './components/BrandHeader';
import CommandPalette from './components/CommandPalette';
import StatusBar from './components/StatusBar';
import ToastContainer from './components/ToastContainer';
import { ToastProvider } from './contexts/ToastContext';
import { HawkProvider, HawkTrail } from './ui/hawk';
import SplashScreen from './components/SplashScreen';
import ModelLoadingStatus from './components/ModelLoadingStatus';
import IndexingStatusComponent from './components/IndexingStatus';
import SearchBar from './components/SearchBar';
import SearchResults from './components/SearchResults';
import ErrorState from './components/ErrorState';
import LocalIndexingModal from './components/LocalIndexingModal';

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    indexingStatus: {
      is_indexing: false,
      progress: 0,
      total_files: 0,
      current_file: '',
      message: 'Ready'
    },
    searchResults: [],
    isLoading: false,
    selectedFolders: [],
    config: null,
    currentChunkingMode: 'gist',
    searchPagination: {
      page: 1,
      pageSize: 10,
      hasMore: false,
      totalResults: 0,
      totalPages: 0,
      lastQuery: '',
      lastIncludeGranular: true
    }
  });

  // Add error states for better UX
  const [searchError, setSearchError] = useState<string | null>(null);
  const [githubSearchError, setGithubSearchError] = useState<string | null>(null);

  // Local indexing modal state
  const [localIndexingModal, setLocalIndexingModal] = useState<{
    isOpen: boolean;
    selectedFolders: string[];
    chunkingMode: 'gist' | 'pinpoint';
  }>({
    isOpen: false,
    selectedFolders: [],
    chunkingMode: 'gist'
  });

  // Separate search state for GitHub page
  const [githubSearchState, setGithubSearchState] = useState<{
    searchResults: SearchResult[];
    isLoading: boolean;
    searchPagination: {
      page: number;
      pageSize: number;
      hasMore: boolean;
      totalResults: number;
      totalPages: number;
      lastQuery: string;
      lastIncludeGranular: boolean;
    };
  }>({
    searchResults: [],
    isLoading: false,
    searchPagination: {
      page: 1,
      pageSize: 10,
      hasMore: false,
      totalResults: 0,
      totalPages: 0,
      lastQuery: '',
      lastIncludeGranular: true
    }
  });

  const [filters, setFilters] = useState<FilterOptions>({
    fileTypes: [],
    timeRange: {
      type: 'all',
      before: null,
      after: null,
      startDate: null,
      endDate: null
    },
    searchFolder: null
  });

  const [modelLoading, setModelLoading] = useState(true);
  const [modelError, setModelError] = useState<string | null>(null);
  const [apiAvailable, setApiAvailable] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isGithubLoadingMore, setIsGithubLoadingMore] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<'home' | 'settings' | 'track-files' | 'saved' | 'github'>('home');
  const [syncMonitoringStarted, setSyncMonitoringStarted] = useState(false);
  const [shortcutSignals, setShortcutSignals] = useState({ focus: 0, submit: 0, clear: 0 });
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  // Update document title when route changes
  useEffect(() => {
    let title = 'FileHawk - Local Semantic Search';
    if (currentRoute === 'settings') title = 'Settings - FileHawk';
    else if (currentRoute === 'track-files') title = 'Track Files - FileHawk';
    else if (currentRoute === 'saved') title = 'Saved - FileHawk';
    else if (currentRoute === 'github') title = 'GitHub - FileHawk';
    document.title = title;
  }, [currentRoute]);

  useEffect(() => {
    // Wait for Python API to be available, then initialize and start polling
    let cancelled = false;
    const waitForApi = async () => {
      // quick-check once
      let available = await api.isApiAvailable();
      if (!available) {
        // poll until available
        while (!available && !cancelled) {
          await new Promise(r => setTimeout(r, 800));
          available = await api.isApiAvailable();
        }
      }
      if (cancelled) return;
      setApiAvailable(true);
      await initializeApp();

      // Set up indexing status polling after API available
      const cleanup = window.electronAPI.onStatusUpdate((status: IndexingStatusType) => {
        setState(prev => ({
          ...prev,
          indexingStatus: status
        }));
      });
      // store cleanup on window for unmount
      (window as any).__indexingCleanup = cleanup;

      // Start real-time sync monitoring at app level
      if (!syncMonitoringStarted) {
        startSyncMonitoring();
      }
    };
    waitForApi();

    // Set up periodic monitoring health check
    const monitoringHealthCheck = setInterval(async () => {
      if (syncMonitoringStarted) {
        try {
          const status = await api.getMonitorStatus();
          if (status.success && !status.is_running) {
            console.log('⚠️ App: Monitoring stopped unexpectedly, restarting...');
            setSyncMonitoringStarted(false);
            await startSyncMonitoring();
          }
        } catch (error) {
          console.error('App: Error checking monitoring health:', error);
        }
      }
    }, 10000); // Check every 10 seconds

    return () => {
      clearInterval(monitoringHealthCheck);
    };

    return () => {
      cancelled = true;
      (window as any).__indexingCleanup && (window as any).__indexingCleanup();
      // Stop sync monitoring when app unmounts
      if (syncMonitoringStarted) {
        stopSyncMonitoring();
      }
    };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      
      // Command palette takes priority
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }
      
      // Other shortcuts only work when command palette is closed
      if (isCommandPaletteOpen) return;
      
      if (e.key === 'Enter' && !e.shiftKey) {
        setShortcutSignals(s => ({ ...s, submit: s.submit + 1 }));
      } else if (e.key === 'Escape') {
        setShortcutSignals(s => ({ ...s, clear: s.clear + 1 }));
      } else if (mod && e.key.toLowerCase() === 'g') {
        setState(prev => ({ ...prev, currentChunkingMode: prev.currentChunkingMode === 'gist' ? 'pinpoint' : 'gist' }));
      } else if (mod && e.key.toLowerCase() === 'l') {
        if (state.searchPagination.hasMore && !isLoadingMore) {
          onLoadMoreShortcut();
        }
      } else if (mod && e.key === ',') {
        setCurrentRoute('settings');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [state.searchPagination.hasMore, isLoadingMore, isCommandPaletteOpen]);

  const onLoadMoreShortcut = async () => {
    await handleLoadMore();
  };

  const handleCommandPaletteSearch = (query: string) => {
    // Navigate to appropriate page and trigger search
    if (currentRoute === 'github') {
      handleSearch(query, true, state.currentChunkingMode, { ...filters, source: 'github' });
    } else {
      setCurrentRoute('home');
      setTimeout(() => {
        handleSearch(query, true, state.currentChunkingMode, { ...filters, source: 'local' });
      }, 100);
    }
  };

  const handleSettingsNavigation = (settingsItem: any) => {
    // Navigate to settings page
    setCurrentRoute('settings');
    
    // Wait for navigation to complete, then scroll to section and expand it
    setTimeout(() => {
      const sectionId = settingsItem.sectionId;
      if (sectionId) {
        // Trigger section expansion by dispatching a custom event
        const expandEvent = new CustomEvent('expandSettingsSection', { 
          detail: { sectionId, settingsItem } 
        });
        window.dispatchEvent(expandEvent);
        
        // Wait a bit more for expansion animation, then scroll
        setTimeout(() => {
          const element = document.getElementById(sectionId);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Briefly highlight the section
            element.classList.add('highlight-section');
            setTimeout(() => {
              element.classList.remove('highlight-section');
            }, 2000);
          }
        }, 200);
      }
    }, 100);
  };

  // Retry functions for error recovery
  const retrySearch = () => {
    const { lastQuery, lastIncludeGranular } = state.searchPagination;
    if (lastQuery) {
      handleSearch(lastQuery, lastIncludeGranular, state.currentChunkingMode, filters);
    }
  };

  const retryGithubSearch = () => {
    const { lastQuery, lastIncludeGranular } = githubSearchState.searchPagination;
    if (lastQuery) {
      handleSearch(lastQuery, lastIncludeGranular, state.currentChunkingMode, { ...filters, source: 'github' });
    }
  };

  const initializeApp = async () => {
    try {
      // Get initial status and config
      const [status, config] = await Promise.all([
        api.getStatus(),
        api.getConfig()
      ]);

      setState(prev => ({
        ...prev,
        indexingStatus: status,
        config
      }));
    } catch (error) {
      console.error('Failed to initialize app:', error);
    }
  };

  const startSyncMonitoring = async () => {
    try {
      // Check if monitoring is already running
      const monitorStatus = await api.getMonitorStatus();
      if (monitorStatus.success && monitorStatus.is_running) {
        console.log('✅ App: Monitoring already running, skipping start');
        setSyncMonitoringStarted(true);
        return;
      }

      console.log('app: starting real-time sync monitoring...');
      const result = await api.startRealtimeSync();
      
      if (result.success) {
        setSyncMonitoringStarted(true);
        console.log('app: real-time monitoring started');
      } else {
        console.error('app: failed to start monitoring:', result.error);
      }
    } catch (error) {
      console.error('app: error starting real-time monitoring:', error);
    }
  };

  const stopSyncMonitoring = async () => {
    try {
      await api.stopRealtimeSync();
      setSyncMonitoringStarted(false);
      console.log('App: Real-time monitoring stopped');
    } catch (error) {
      console.error('App: Failed to stop real-time monitoring:', error);
    }
  };

  const handleModelLoadingComplete = () => {
    setModelLoading(false);
    setModelError(null);
  };

  const handleModelLoadingError = (error: string) => {
    setModelLoading(false);
    setModelError(error);
  };

  const handleSelectFolders = async (chunkingMode: 'gist' | 'pinpoint') => {
    try {
      const folders = await window.electronAPI.selectFolders();
      if (folders.length > 0) {
        // Open modal for exclusion configuration instead of directly indexing
        setLocalIndexingModal({
          isOpen: true,
          selectedFolders: folders,
          chunkingMode
        });
      }
    } catch (error) {
      console.error('Failed to select folders:', error);
    }
  };

  const handleStartLocalIndexing = async (config: {
    folders: string[];
    mode: 'gist' | 'pinpoint';
    excludes: string[];
    maxSizeMb: number;
  }) => {
    try {
      // Close modal first
      setLocalIndexingModal(prev => ({ ...prev, isOpen: false }));

      // Update state
      setState(prev => ({
        ...prev,
        selectedFolders: config.folders,
        currentChunkingMode: config.mode
      }));

      // Start indexing with exclusions and size limit
      await api.indexFoldersWithExclusions(config.folders, config.mode, config.excludes, config.maxSizeMb);
    } catch (error) {
      console.error('Failed to start indexing:', error);
    }
  };

  const handleCloseLocalIndexingModal = () => {
    setLocalIndexingModal(prev => ({ ...prev, isOpen: false }));
  };

  const handleModeChange = (chunkingMode: 'gist' | 'pinpoint') => {
    setState(prev => ({
      ...prev,
      currentChunkingMode: chunkingMode
    }));
  };

  const handleFiltersChange = (newFilters: FilterOptions) => {
    setFilters(newFilters);
  };

  const handleFolderSelect = async () => {
    try {
      if (window.electronAPI && typeof window.electronAPI.selectSearchFolder === 'function') {
        const selectedFolder = await window.electronAPI.selectSearchFolder();
        if (selectedFolder) {
          setFilters(prev => ({ ...prev, searchFolder: selectedFolder }));
        }
      } else if (window.electronAPI && typeof window.electronAPI.selectFolders === 'function') {
        // Fallback to multi-select if single-select is not available
        console.warn('selectSearchFolder not available, falling back to selectFolders');
        const result = await window.electronAPI.selectFolders();
        if (Array.isArray(result) && result.length > 0) {
          setFilters(prev => ({ ...prev, searchFolder: result[0] }));
        }
      } else {
        console.error('No folder selection API available on window.electronAPI');
      }
    } catch (error) {
      console.error('Failed to select folder:', error);
    }
  };

  const handleSearch = async (query: string, includeGranular: boolean, chunkingMode: 'gist' | 'pinpoint', searchFilters?: FilterOptions) => {
    if (!query.trim()) return;

    const activeFilters = searchFilters || filters;
    const settings = loadSettings();
    const pageSize = 10; // Always use 10 for new pagination

    // Check if this is a GitHub search (has GitHub-specific filters)
    const isGithubSearch = activeFilters?.source === 'github' || 
                          (activeFilters?.repos && activeFilters.repos.length > 0);

    if (isGithubSearch) {
      // Handle GitHub search
      setGithubSearchState(prev => ({ 
        ...prev, 
        isLoading: true,
        searchPagination: {
          ...prev.searchPagination,
          page: 1,
          pageSize: pageSize,
          lastQuery: query,
          lastIncludeGranular: includeGranular
        }
      }));

      try {
        setGithubSearchError(null); // Clear previous errors
        const response = await api.search(query, includeGranular, chunkingMode, 1, pageSize, activeFilters);
        setGithubSearchState(prev => ({
          ...prev,
          searchResults: response.results,
          isLoading: false,
          searchPagination: {
            ...prev.searchPagination,
            page: response.page,
            pageSize: response.page_size,
            hasMore: response.has_more,
            totalResults: response.total_files,
            totalPages: response.total_pages,
            lastQuery: query,
            lastIncludeGranular: includeGranular
          }
        }));
      } catch (error) {
        console.error('GitHub search failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Search failed. Please check your connection and try again.';
        setGithubSearchError(errorMessage);
        setGithubSearchState(prev => ({ ...prev, isLoading: false }));
      }
    } else {
      // Handle home page search - always use local source filter
      const homeFilters = {
        ...activeFilters,
        source: 'local' as const
      };

      setState(prev => ({ 
        ...prev, 
        isLoading: true,
        currentChunkingMode: chunkingMode,
        searchPagination: {
          ...prev.searchPagination,
          page: 1,
          pageSize: pageSize,
          lastQuery: query,
          lastIncludeGranular: includeGranular
        }
      }));

      try {
        setSearchError(null); // Clear previous errors
        const response = await api.search(query, includeGranular, chunkingMode, 1, pageSize, homeFilters);
        setState(prev => ({
          ...prev,
          searchResults: response.results,
          isLoading: false,
          searchPagination: {
            ...prev.searchPagination,
            page: response.page,
            pageSize: response.page_size,
            hasMore: response.has_more,
            totalResults: response.total_files,
            totalPages: response.total_pages,
            lastQuery: query,
            lastIncludeGranular: includeGranular
          }
        }));
      } catch (error) {
        console.error('Search failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Search failed. Please check your connection and try again.';
        setSearchError(errorMessage);
        setState(prev => ({ ...prev, isLoading: false }));
      }
    }

    // Update chunking mode globally
    setState(prev => ({ ...prev, currentChunkingMode: chunkingMode }));
  };

  const handleLoadMore = async () => {
    if (!state.searchPagination.hasMore || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const nextPage = state.searchPagination.page + 1;
      const response = await api.search(
        state.searchPagination.lastQuery,
        state.searchPagination.lastIncludeGranular,
        state.currentChunkingMode,
        nextPage,
        state.searchPagination.pageSize
      );

      setState(prev => ({
        ...prev,
        searchResults: [...prev.searchResults, ...response.results],
        searchPagination: {
          ...prev.searchPagination,
          page: response.page,
          hasMore: response.has_more,
          totalResults: response.total_files,
          totalPages: response.total_pages
        }
      }));
    } catch (error) {
      console.error('Load more failed:', error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handleGithubLoadMore = async () => {
    if (!githubSearchState.searchPagination.hasMore || isGithubLoadingMore) return;

    setIsGithubLoadingMore(true);
    try {
      const nextPage = githubSearchState.searchPagination.page + 1;
      const response = await api.search(
        githubSearchState.searchPagination.lastQuery,
        githubSearchState.searchPagination.lastIncludeGranular,
        state.currentChunkingMode,
        nextPage,
        githubSearchState.searchPagination.pageSize
      );

      setGithubSearchState(prev => ({
        ...prev,
        searchResults: [...prev.searchResults, ...response.results],
        searchPagination: {
          ...prev.searchPagination,
          page: response.page,
          hasMore: response.has_more,
          totalResults: response.total_files,
          totalPages: response.total_pages
        }
      }));
    } catch (error) {
      console.error('GitHub load more failed:', error);
    } finally {
      setIsGithubLoadingMore(false);
    }
  };

  const handleReindex = async (filePath: string) => {
    try {
      await api.reindexPath(filePath, state.currentChunkingMode);
      // Optionally refresh search results if we have any
      if (state.searchResults.length > 0) {
        // Re-run the last search
        // This would need to be implemented based on the last search query
      }
    } catch (error) {
      console.error('Reindex failed:', error);
    }
  };

  const handleToggleGranular = async (filePath: string, enable: boolean) => {
    try {
      await api.toggleGranularTracking(filePath, enable);
      // Optionally refresh search results
    } catch (error) {
      console.error('Toggle granular tracking failed:', error);
    }
  };

  const handleOpenFile = async (filePath: string) => {
    try {
      const result = await window.electronAPI.openFile(filePath);
      if (!result.success) {
        console.error('Failed to open file:', result.error);
        // You could add a toast notification here
      }
    } catch (error) {
      console.error('Failed to open file:', error);
    }
  };

  // Show error state if model failed to load
  if (modelError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-onyx">
        <div className="text-center p-8 soft-card">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2 text-neutral-200">
            Model Loading Failed
          </h3>
          <p className="text-sm mb-4 text-neutral-400">
            {modelError}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-brand-gold-600 text-brand-onyx rounded-md hover:bg-brand-gold-500 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!apiAvailable) {
    return (
      <SplashScreen message="Starting FileHawk" subMessage="Spinning up file searching model..." />
    );
  }

  return (
    <ToastProvider>
      <HawkProvider>
        <div className="h-screen bg-brand-onyx text-neutral-200 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-brand-coal border-brand-border border-b z-10 flex-shrink-0">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-6">
              <div className="flex items-center">
                <BrandHeader 
                  selectedMode={state.currentChunkingMode}
                  onModeChange={handleModeChange}
                  disabled={state.indexingStatus.is_indexing}
                />
              </div>
              <div className="flex items-center space-x-3">
                {state.config && (
                  <div className="chip chip--muted">
                    <div className="flex items-center space-x-2">
                      <div className="w-1.5 h-1.5 bg-brand-gold-500 rounded-full"></div>
                      <span>
                        {state.currentChunkingMode === 'gist' 
                          ? 'MSMarco-MiniLM-L6'
                          : 'AllMiniLM-L6-v2'
                        }
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Hawk Trail - just the animated line without icon */}
            <div className="pb-4">
              <div className="hawk-trail">
                {/* Trail lines only - no hawk icon */}
              </div>
            </div>
          </div>
        </header>

        {/* Model Loading Status */}
        {modelLoading && (
          <ModelLoadingStatus
            darkMode={true}
            onLoadingComplete={handleModelLoadingComplete}
            onLoadingError={handleModelLoadingError}
          />
        )}

        {/* Main Content with Sidebar Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="flex-shrink-0">
            <Sidebar 
              currentRoute={currentRoute}
              onRouteChange={setCurrentRoute}
            />
          </div>
          
          {/* Main Content Area */}
          <main className="flex-1 overflow-auto">
            {currentRoute === 'home' ? (
              <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <HomePage
                  state={state}
                  onSelectFolders={handleSelectFolders}
                  onSearch={handleSearch}
                  onReindex={handleReindex}
                  onToggleGranular={handleToggleGranular}
                  onOpenFile={handleOpenFile}
                  onLoadMore={handleLoadMore}
                  isLoadingMore={isLoadingMore}
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  onFolderSelect={handleFolderSelect}
                  searchError={searchError}
                  onRetrySearch={retrySearch}
                  focusSignal={shortcutSignals.focus}
                  submitSignal={shortcutSignals.submit}
                  clearSignal={shortcutSignals.clear}
                  onResultSelected={(r: SearchResult) => console.log('Selected result', r.file_path)}
                />
              </div>
            ) : currentRoute === 'settings' ? (
              <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <SettingsPage />
              </div>
            ) : currentRoute === 'track-files' ? (
              <TrackFilesPage currentChunkingMode={state.currentChunkingMode} />
            ) : currentRoute === 'saved' ? (
              <SavedPage />
            ) : currentRoute === 'github' ? (
              <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <GitHubConnectorPage
                  state={{
                    ...state,
                    searchResults: githubSearchState.searchResults,
                    isLoading: githubSearchState.isLoading,
                    searchPagination: githubSearchState.searchPagination
                  }}
                  onSearch={handleSearch}
                  onModeChange={handleModeChange}
                  onReindex={handleReindex}
                  onToggleGranular={handleToggleGranular}
                  onOpenFile={handleOpenFile}
                  onLoadMore={handleGithubLoadMore}
                  isLoadingMore={isGithubLoadingMore}
                  filters={filters}
                  onFiltersChange={handleFiltersChange}
                  onFolderSelect={handleFolderSelect}
                  searchError={githubSearchError}
                  onRetrySearch={retryGithubSearch}
                  focusSignal={shortcutSignals.focus}
                  submitSignal={shortcutSignals.submit}
                  clearSignal={shortcutSignals.clear}
                />
              </div>
            ) : null}
          </main>
        </div>

        {/* Fixed Status Bar */}
        <div className="flex-shrink-0">
          <StatusBar
            indexingStatus={state.indexingStatus}
            currentChunkingMode={state.currentChunkingMode}
            currentRoute={currentRoute}
            searchResultsCount={state.searchResults.length}
            connectedRepos={0} // TODO: Get actual connected repos count
            modelName={state.config ? 
              (state.currentChunkingMode === 'gist' ? 'MSMarco-MiniLM-L6' : 'AllMiniLM-L6-v2') : 
              undefined
            }
            onModeToggle={() => setState(prev => ({ 
              ...prev, 
              currentChunkingMode: prev.currentChunkingMode === 'gist' ? 'pinpoint' : 'gist' 
            }))}
            onNavigate={(route) => {
              // Optional: Could scroll to top or refresh current page
              console.log(`Current route: ${route}`);
            }}
            onShowRepos={() => setCurrentRoute('github')}
            onShowSettings={() => setCurrentRoute('settings')}
          />
        </div>

        {/* Command Palette */}
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          onNavigate={setCurrentRoute}
          onSettingsNavigate={handleSettingsNavigation}
          onSearch={handleCommandPaletteSearch}
          recentSearches={loadHistory().map(h => h.query).slice(0, 5)}
          currentRoute={currentRoute}
        />

        {/* Local Indexing Modal */}
        <LocalIndexingModal
          isOpen={localIndexingModal.isOpen}
          folders={localIndexingModal.selectedFolders}
          onClose={handleCloseLocalIndexingModal}
          onIndexStart={handleStartLocalIndexing}
        />

        {/* Toast Container */}
        <ToastContainer />
      </div>
    </HawkProvider>
  </ToastProvider>
  );
};

export default App; 