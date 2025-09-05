import React, { useState, useEffect } from 'react';
import { SearchBarProps, ChunkingMode, FilterOptions } from '../types';
import { useHawkContext } from '../ui/hawk';
import GoldButton from '../ui/GoldButton';
import { Filter as FilterIcon, Search as SearchIcon } from 'lucide-react';
import FilterPopup from './FilterPopup';
import LoadingState from './LoadingState';
import { addHistory, clearHistory, loadHistory, timeAgo } from '../utils/searchAssist';

const SearchBar: React.FC<SearchBarProps> = ({ 
  onSearch, 
  isLoading, 
  darkMode, 
  currentChunkingMode, 
  filters, 
  onFiltersChange, 
  onFolderSelect,
  focusSignal,
  submitSignal,
  clearSignal
}) => {
  const [query, setQuery] = useState('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [includeGranular, setIncludeGranular] = useState(true);
  const [isFilterPopupOpen, setIsFilterPopupOpen] = useState(false);
  const { setHawkMood } = useHawkContext();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [history, setHistory] = useState(loadHistory());

  // Filter history items based on current query
  const getMatchingHistory = () => {
    const trimmedQuery = query.trim().toLowerCase();
    if (trimmedQuery.length < 2) return [];
    
    return history.filter(item => 
      item.query.toLowerCase().includes(trimmedQuery)
    );
  };

  // Determine if dropdown should be shown
  const shouldShowDropdown = () => {
    const matchingItems = getMatchingHistory();
    return isDropdownOpen && matchingItems.length > 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsDropdownOpen(false); // Hide dropdown on submit
    if (query.trim() && !isLoading) {
      setHawkMood('search');
      addHistory(query);
      setHistory(loadHistory());
      onSearch(query.trim(), includeGranular, currentChunkingMode, filters);
    }
  };

  // Keyboard signals
  useEffect(() => {
    if (typeof focusSignal === 'number' && focusSignal > 0) {
      inputRef.current?.focus();
    }
  }, [focusSignal]);

  useEffect(() => {
    if (typeof submitSignal === 'number' && submitSignal > 0) {
      const fakeEvent = { preventDefault(){} } as unknown as React.FormEvent;
      handleSubmit(fakeEvent);
    }
  }, [submitSignal]);

  useEffect(() => {
    if (typeof clearSignal === 'number' && clearSignal > 0) {
      setQuery('');
      inputRef.current?.focus();
    }
  }, [clearSignal]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // no chips persistence

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      setIsDropdownOpen(false); // Hide dropdown on Enter
      handleSubmit(e);
    }
  };

  // No suggestion logic (disabled)

  return (
    <div className="soft-card">
      <form onSubmit={handleSubmit} className="p-3">
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <label htmlFor="search-query" className="block text-[13px] font-semibold transition-colors duration-150 text-neutral-200">
                Search Files
              </label>
              <div className="flex items-center space-x-1.5">
                {/* Filters Button */}
                <button
                  type="button"
                  onClick={() => setIsFilterPopupOpen(true)}
                  className={`p-1.5 rounded-sm border transition-colors duration-150 ${
                    darkMode 
                      ? 'border-brand-border text-neutral-300 hover:text-neutral-100 hover:border-neutral-500' 
                      : 'border-gray-300 text-gray-600 hover:text-gray-800'
                  } ${Object.values(filters).some(val => 
                    Array.isArray(val) ? val.length > 0 : val !== null && val !== 'all'
                  ) ? 'border-neutral-500 text-neutral-100 bg-neutral-800/40' : ''
                  }`}
                  title="Search Filters"
                >
                  <FilterIcon className="w-4 h-4" />
                </button>
                
                <GoldButton
                  variant="solid"
                  size="sm"
                  type="submit"
                  disabled={!query.trim() || isLoading}
                  onClick={() => setHawkMood('search')}
                >
                  {isLoading ? (
                    <LoadingState 
                      variant="inline" 
                      size="sm" 
                      spinnerVariant="white" 
                      message="Searching..."
                      className="-ml-1 mr-2"
                    />
                  ) : (
                    <>
                      <SearchIcon className="-ml-1 mr-2 h-4 w-4" />
                      Search
                    </>
                  )}
                </GoldButton>
              </div>
            </div>
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <SearchIcon className="h-4 w-4 text-neutral-500 group-focus-within:text-neutral-300 transition-colors duration-150" />
              </div>
              <input
                id="search-query"
                type="text"
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  const newQuery = e.target.value;
                  setQuery(newQuery);
                  
                  // Update dropdown visibility based on new query
                  const trimmed = newQuery.trim();
                  if (trimmed.length >= 2) {
                    const matchingItems = history.filter(item => 
                      item.query.toLowerCase().includes(trimmed.toLowerCase())
                    );
                    setIsDropdownOpen(matchingItems.length > 0);
                  } else {
                    setIsDropdownOpen(false);
                  }
                }}
                onKeyPress={handleKeyPress}
                placeholder="Enter your search query (e.g., 'machine learning algorithms', 'database connection issues')"
                className="block w-full pl-10 pr-3 py-2 border rounded-sm leading-5 placeholder-neutral-500 focus:outline-none focus:placeholder-neutral-400 focus:ring-2 focus:ring-neutral-400 focus:border-neutral-500 transition-colors duration-150 bg-brand-coal border-brand-border text-neutral-200 placeholder-neutral-500"
                disabled={isLoading}
                onFocus={() => {
                  // Only open if there are potential matches
                  if (query.trim().length >= 2 && getMatchingHistory().length > 0) {
                    setIsDropdownOpen(true);
                  }
                }}
                onBlur={() => setTimeout(() => setIsDropdownOpen(false), 120)}
              />
              {shouldShowDropdown() && (
                <div className="absolute z-40 mt-1 left-0 right-0 bg-neutral-900 border border-neutral-700 rounded-sm shadow-subtle">
                  <div className="p-2">
                    <div className="flex items-center justify-between px-1">
                      <div className="text-[11px] text-neutral-500">History</div>
                      <button className="text-[11px] text-neutral-400 hover:text-neutral-200" onMouseDown={() => { clearHistory(); setHistory([]); setIsDropdownOpen(false); }}>Clear</button>
                    </div>
                    <div className="mt-1 max-h-56 overflow-y-auto">
                      {getMatchingHistory().map((h) => (
                        <button 
                          key={h.ts} 
                          className="w-full flex items-center justify-between px-2 py-1.5 text-[13px] text-neutral-200 hover:bg-neutral-800" 
                          onMouseDown={() => {
                            setQuery(h.query);
                            setIsDropdownOpen(false);
                          }}
                        >
                          <span className="truncate mr-2">{h.query}</span>
                          <span className="text-[11px] text-neutral-500">{timeAgo(h.ts)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            {/* Inline filter chips removed */}
            <p className="mt-1.5 text-[12px] leading-5 transition-colors duration-150 text-neutral-500">
              Use natural language to search through your indexed files. The search is semantic, so it understands context and meaning.
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={includeGranular}
                onChange={(e) => setIncludeGranular(e.target.checked)}
                className="h-4 w-4 text-neutral-300 focus:ring-neutral-400 border-brand-border rounded-sm bg-brand-coal"
              />
              <span className="ml-2 text-[12px] text-neutral-300">
                Include granular chunks
              </span>
            </label>
          </div>
        </div>
      </form>
      
      {/* Filter Popup */}
      <FilterPopup
        isOpen={isFilterPopupOpen}
        onClose={() => setIsFilterPopupOpen(false)}
        filters={filters}
        onFiltersChange={onFiltersChange}
        onFolderSelect={onFolderSelect}
        darkMode={darkMode}
      />
    </div>
  );
};

export default SearchBar; 