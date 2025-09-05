import React, { useState, useEffect, useRef } from 'react';
import { SearchResultsProps } from '../types';
import FileResult from './FileResult';
import { useHawkContext } from '../ui/hawk';
import GoldButton from '../ui/GoldButton';
import LoadingState from './LoadingState';
import EmptyState, { EmptyStates } from './EmptyState';
import { SearchResultsListSkeleton } from './LoadingSkeletons';
import SearchPreview from './SearchPreview';
import GroupedSearchResults, { GroupingType } from './GroupedSearchResults';
import { Grid, List } from 'lucide-react';

interface PropsWithSignals extends SearchResultsProps {
  collapseAllSignal?: number;
}

const SearchResults: React.FC<PropsWithSignals> = ({ 
  results, 
  isLoading, 
  onReindex, 
  onToggleGranular,
  onOpenFile,
  darkMode,
  currentChunkingMode,
  hasMore,
  onLoadMore,
  isLoadingMore,
  totalResults,
  page,
  totalPages,
  currentQuery,
  onSelectFolders,
  onChangeFilters,
  collapseAllSignal,
  onResultSelected
}) => {
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [newResultsStartIndex, setNewResultsStartIndex] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('list');
  const [groupingType, setGroupingType] = useState<GroupingType>('file-type');
  const previousResultsLength = useRef(0);
  const { setHawkMood } = useHawkContext();

  // Update hawk mood based on search results
  useEffect(() => {
    if (isLoading) {
      setHawkMood('search');
    } else if (results.length > 0) {
      setHawkMood('success');
    } else if (results.length === 0 && !isLoading) {
      setHawkMood('idle');
    }
  }, [results, isLoading, setHawkMood]);

  // Handle new results and animations
  useEffect(() => {
    const currentLength = results.length;
    const previousLength = previousResultsLength.current;

    if (currentLength > previousLength && previousLength > 0) {
      // New results were loaded (load more)
      setNewResultsStartIndex(previousLength);
      setIsRefreshing(true);
      
      // Clear refresh state after animation
      const refreshTimer = setTimeout(() => {
        setIsRefreshing(false);
      }, 800);
      
      return () => clearTimeout(refreshTimer);
    } else if (currentLength > 0 && previousLength === 0) {
      // Fresh search results
      setNewResultsStartIndex(0);
    }

    previousResultsLength.current = currentLength;
  }, [results.length]);

  const toggleFileExpansion = (filePath: string) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(filePath)) {
      newExpanded.delete(filePath);
    } else {
      newExpanded.add(filePath);
    }
    setExpandedFiles(newExpanded);
  };

  const handlePreview = (filePath: string, query?: string) => {
    setPreviewFile(filePath);
    setPreviewQuery(query || currentQuery || '');
  };


  if (isLoading) {
    return <SearchResultsListSkeleton count={6} />;
  }

  if (results.length === 0) {
    const emptyStateProps = EmptyStates.noSearchResults(
      () => {
        // Reindex all files - we can trigger a general reindex
        if (onReindex) {
          onReindex(''); // Empty path typically means reindex all
        }
      },
      () => {
        // Change filters
        if (onChangeFilters) {
          onChangeFilters();
        }
      },
      () => {
        // Select folders
        if (onSelectFolders) {
          onSelectFolders();
        }
      },
      currentQuery
    );

    return <EmptyState {...emptyStateProps} />;
  }

  const getResultTypeLabel = () => {
    return currentChunkingMode === 'gist' ? 'files' : 'chunks';
  };

  const getResultCount = () => {
    if (currentChunkingMode === 'gist') {
      return totalResults;
    } else {
      // For pinpoint mode, show total chunks if available, otherwise show current results
      return results.length;
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <h2 className="text-base font-semibold transition-colors duration-150 text-neutral-200">Results</h2>
          <span className="px-1.5 py-0.5 rounded-sm text-[11px] border border-neutral-700 text-neutral-300">
            {getResultCount()} {getResultTypeLabel()}
          </span>
          {totalPages > 1 && (
            <span className="px-1.5 py-0.5 rounded-sm text-[11px] border border-neutral-800 text-neutral-400">
              Page {page} of {totalPages}
            </span>
          )}
        </div>
        
        {/* View Mode Toggle */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-neutral-800 border border-neutral-700 rounded-md p-0.5">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded transition-colors duration-150 ${
                viewMode === 'list' 
                  ? 'bg-brand-gold-600 text-neutral-900' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="List view"
            >
              <List size={14} />
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={`p-1.5 rounded transition-colors duration-150 ${
                viewMode === 'grouped' 
                  ? 'bg-brand-gold-600 text-neutral-900' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
              title="Grouped view"
            >
              <Grid size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Results Content */}
      {viewMode === 'grouped' ? (
        <GroupedSearchResults
          results={results}
          groupBy={groupingType}
          onGroupChange={setGroupingType}
          isLoading={isLoading}
          onReindex={onReindex}
          onToggleGranular={onToggleGranular}
          onOpenFile={onOpenFile}
          onPreview={handlePreview}
          darkMode={darkMode}
          currentQuery={currentQuery}
          onResultSelected={onResultSelected}
        />
      ) : (
        <div className="space-y-3">
          <div className="space-y-2.5">
            {results.map((result, index) => {
              const isNewResult = index >= newResultsStartIndex;
              const delay = isNewResult ? (index - newResultsStartIndex) * 50 : index * 30;
              
              return (
                <div 
                  key={`${result.file_path}-${index}`}
                  className={`${isNewResult ? 'animate-load-more-flow' : 'animate-search-result-flow'} ${isRefreshing && isNewResult ? 'animate-refresh-pulse' : ''}`}
                  style={{ animationDelay: `${delay}ms` }}
                >
                  <FileResult
                    result={result}
                    isExpanded={expandedFiles.has(result.file_path)}
                    onToggleExpansion={() => toggleFileExpansion(result.file_path)}
                    onReindex={onReindex}
                    onToggleGranular={onToggleGranular}
                    onOpenFile={onOpenFile}
                    onPreview={handlePreview}
                    darkMode={darkMode}
                    onSelect={onResultSelected}
                  />
                </div>
              );
            })}
          </div>

          {/* Load More Section */}
          {hasMore && (
            <div className="flex items-center justify-center pt-4">
              <GoldButton
                variant="solid"
                size="md"
                onClick={onLoadMore}
                disabled={isLoadingMore}
                className="min-w-[140px]"
              >
                {isLoadingMore ? (
                  <LoadingState 
                    variant="inline" 
                    size="sm" 
                    spinnerVariant="white" 
                    message="Loading..."
                    className="-ml-1 mr-2"
                  />
                ) : (
                  <>
                    <svg className="-ml-1 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    Load More
                  </>
                )}
              </GoldButton>
            </div>
          )}

          {/* Results Summary */}
          {results.length > 0 && (
            <div className="text-center pt-1.5">
              <p className="text-[11px] text-neutral-500">
                Showing {results.length} of {getResultCount()} {getResultTypeLabel()} {currentChunkingMode === 'gist' ? '(top files by relevance)' : '(top chunks by relevance)'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Search Preview Modal */}
      <SearchPreview
        filePath={previewFile || undefined}
        query={previewQuery}
        isOpen={previewFile !== null}
        onClose={() => setPreviewFile(null)}
        darkMode={darkMode}
      />
    </div>
  );
};

export default SearchResults; 