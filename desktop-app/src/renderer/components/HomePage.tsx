import React, { useEffect } from 'react';
import { AppState, IndexingStatus as IndexingStatusType, SearchResult, FilterOptions } from '../types';
import IndexingStatusComponent from './IndexingStatus';
import SearchBar from './SearchBar';
import SearchResults from './SearchResults';
import SearchTabs from './SearchTabs';
import ErrorState from './ErrorState';
import { useSearchTabs } from '../hooks/useSearchTabs';

interface HomePageProps {
  state: AppState;
  onSelectFolders: (chunkingMode: 'gist' | 'pinpoint') => void;
  onSearch: (query: string, includeGranular: boolean, chunkingMode: 'gist' | 'pinpoint', filters?: FilterOptions, tabId?: string) => void;
  onReindex: (filePath: string) => void;
  onToggleGranular: (filePath: string, enable: boolean) => void;
  onOpenFile: (filePath: string) => void;
  onLoadMore: (tabId?: string) => void;
  isLoadingMore: boolean;
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  onFolderSelect: () => void;
  // Error handling
  searchError: string | null;
  onRetrySearch: () => void;
  // keyboard shortcut signals
  focusSignal?: number;
  submitSignal?: number;
  clearSignal?: number;
  collapseAllSignal?: number;
  onResultSelected?: (result: SearchResult) => void;
}

const HomePage: React.FC<HomePageProps> = ({
  state,
  onSelectFolders,
  onSearch,
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
  clearSignal,
  collapseAllSignal,
  onResultSelected
}) => {
  const {
    tabs,
    activeTabId,
    activeTab,
    createTab,
    closeTab,
    switchTab,
    updateTab,
    renameTab,
    duplicateTab,
    clearTabResults
  } = useSearchTabs();

  // Update active tab with current state when it changes
  useEffect(() => {
    if (activeTab) {
      updateTab(activeTab.id, {
        results: state.searchResults,
        isLoading: state.isLoading,
        pagination: state.searchPagination,
        chunkingMode: state.currentChunkingMode
      });
    }
  }, [state.searchResults, state.isLoading, state.searchPagination, state.currentChunkingMode, activeTab, updateTab]);

  const handleTabSearch = (query: string, includeGranular: boolean, chunkingMode: 'gist' | 'pinpoint', searchFilters?: FilterOptions) => {
    // Always add source: 'local' filter for home page searches
    const localFilters = {
      ...(searchFilters || filters),
      source: 'local' as const
    };

    if (activeTab) {
      // Update tab with new search query
      updateTab(activeTab.id, {
        query,
        chunkingMode,
        filters: localFilters,
        title: query.length > 20 ? `${query.substring(0, 20)}...` : query || 'Search'
      });
    }
    
    // Trigger the search with local filter
    onSearch(query, includeGranular, chunkingMode, localFilters, activeTabId);
  };

  const handleTabSwitch = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab) {
      switchTab(tabId);
      // If the tab has a different search, trigger it
      if (tab.query && tab.query !== state.searchPagination.lastQuery) {
        onSearch(tab.query, true, tab.chunkingMode, tab.filters, tabId);
      }
    }
  };

  const handleCreateTab = () => {
    createTab();
  };

  return (
    <div className="space-y-0">
      {/* Indexing Status */}
      <div className="px-0 pb-6">
        <IndexingStatusComponent 
          status={state.indexingStatus}
          onSelectFolders={onSelectFolders}
          darkMode={true}
          currentChunkingMode={state.currentChunkingMode}
        />

      </div>

      {/* Search Tabs */}
      <SearchTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSwitch={handleTabSwitch}
        onTabClose={closeTab}
        onTabCreate={handleCreateTab}
        onTabRename={renameTab}
        onTabDuplicate={duplicateTab}
        onTabClear={clearTabResults}
      />

      {/* Search Content for Active Tab */}
      <div className="p-6 space-y-6">
        {/* Search Bar */}
        <SearchBar 
          onSearch={handleTabSearch}
          isLoading={state.isLoading}
          darkMode={true}
          currentChunkingMode={activeTab?.chunkingMode || state.currentChunkingMode}
          filters={activeTab?.filters || filters}
          onFiltersChange={onFiltersChange}
          onFolderSelect={onFolderSelect}
          focusSignal={focusSignal}
          submitSignal={submitSignal}
          clearSignal={clearSignal}
        />

        {/* Search Results or Error */}
        {searchError ? (
          <ErrorState
            title="Search Failed"
            message={searchError}
            onRetry={onRetrySearch}
            retryLabel="Retry Search"
          />
        ) : (
          <SearchResults
            results={activeTab?.results || state.searchResults}
            isLoading={activeTab?.isLoading || state.isLoading}
            onReindex={onReindex}
            onToggleGranular={onToggleGranular}
            onOpenFile={onOpenFile}
            darkMode={true}
            currentChunkingMode={activeTab?.chunkingMode || state.currentChunkingMode}
            hasMore={activeTab?.pagination.hasMore || state.searchPagination.hasMore}
            onLoadMore={() => onLoadMore(activeTabId)}
            isLoadingMore={isLoadingMore}
            totalResults={activeTab?.pagination.totalResults || state.searchPagination.totalResults}
            page={activeTab?.pagination.page || state.searchPagination.page}
            totalPages={activeTab?.pagination.totalPages || state.searchPagination.totalPages}
            currentQuery={activeTab?.query || state.searchPagination.lastQuery}
            onSelectFolders={() => onSelectFolders('gist')}
            onChangeFilters={() => {
              // For now, this could trigger the filter popup or clear filters
              // We'll implement a proper callback when we have the filter popup reference
              console.log('Change filters requested');
            }}
            collapseAllSignal={collapseAllSignal}
            onResultSelected={onResultSelected}
          />
        )}
      </div>
    </div>
  );
};

export default HomePage;
