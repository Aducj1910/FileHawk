import React, { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { FilterOptions, ConnectedRepo } from '../types';

interface GitHubFilterPopupProps {
  isOpen: boolean;
  onClose: () => void;
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  connectedRepos: ConnectedRepo[];
  darkMode: boolean;
}

const GitHubFilterPopup: React.FC<GitHubFilterPopupProps> = ({
  isOpen,
  onClose,
  filters,
  onFiltersChange,
  connectedRepos,
  darkMode
}) => {
  const [localFilters, setLocalFilters] = useState<FilterOptions>(filters);

  useEffect(() => {
    if (isOpen) {
      setLocalFilters(filters);
    }
  }, [isOpen, filters]);

  const handleRepoToggle = (repoName: string) => {
    const currentRepos = localFilters.repos || [];
    const newRepos = currentRepos.includes(repoName)
      ? currentRepos.filter(r => r !== repoName)
      : [...currentRepos, repoName];
    
    setLocalFilters(prev => ({
      ...prev,
      repos: newRepos
    }));
  };

  const handleBranchSelection = (repoName: string, branches: string[] | 'all') => {
    setLocalFilters(prev => ({
      ...prev,
      repoBranches: {
        ...prev.repoBranches,
        [repoName]: branches
      }
    }));
  };

  const handleSourceChange = (source: 'local' | 'github' | 'all') => {
    setLocalFilters(prev => ({
      ...prev,
      source
    }));
  };

  const handleApply = () => {
    onFiltersChange(localFilters);
    onClose();
  };

  const handleClear = () => {
    const clearedFilters: FilterOptions = {
      fileTypes: [],
      timeRange: {
        type: 'all',
        before: null,
        after: null,
        startDate: null,
        endDate: null
      },
      searchFolder: null,
      repos: [],
      repoBranches: {},
      source: 'all'
    };
    setLocalFilters(clearedFilters);
  };

  const selectedRepos = localFilters.repos || [];
  const totalConnectedRepos = connectedRepos.length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className={`rounded-lg shadow-xl max-w-md w-full max-h-[80vh] overflow-hidden ${
        darkMode ? 'bg-brand-coal border border-neutral-700' : 'bg-white border border-gray-200'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between p-4 border-b ${
          darkMode ? 'border-neutral-800' : 'border-gray-200'
        }`}>
          <h3 className={`text-lg font-semibold ${
            darkMode ? 'text-neutral-100' : 'text-gray-900'
          }`}>
            GitHub Search Filters
          </h3>
          <button
            onClick={onClose}
            className={`p-2 rounded-sm transition-colors ${
              darkMode ? 'hover:bg-neutral-800 text-neutral-400' : 'hover:bg-gray-100 text-gray-500'
            }`}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-6 overflow-y-auto max-h-[calc(80vh-140px)]">
          {/* Source Selection */}
          <div>
            <label className={`block text-sm font-medium mb-2 ${
              darkMode ? 'text-neutral-200' : 'text-gray-700'
            }`}>
              Search Source
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'all', label: 'All' },
                { value: 'local', label: 'Local Files' },
                { value: 'github', label: 'GitHub Only' }
              ].map(option => (
                <button
                  key={option.value}
                  onClick={() => handleSourceChange(option.value as any)}
                  className={`p-3 border rounded-sm text-sm font-medium transition-colors ${
                    localFilters.source === option.value
                      ? darkMode 
                        ? 'border-neutral-500 bg-neutral-800 text-neutral-100'
                        : 'border-brand-gold-500 bg-brand-gold-50 text-brand-gold-700'
                      : darkMode
                        ? 'border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800'
                        : 'border-gray-300 text-gray-700 hover:border-gray-400 hover:bg-gray-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Repository Selection */}
          {(localFilters.source === 'github' || localFilters.source === 'all') && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className={`text-sm font-medium ${
                  darkMode ? 'text-neutral-200' : 'text-gray-700'
                }`}>
                  GitHub Repositories
                </label>
                <span className={`text-xs ${
                  darkMode ? 'text-neutral-400' : 'text-gray-500'
                }`}>
                  {selectedRepos.length} of {totalConnectedRepos} selected
                </span>
              </div>
              
              {connectedRepos.length === 0 ? (
                <div className={`text-center py-4 text-sm ${
                  darkMode ? 'text-neutral-400' : 'text-gray-500'
                }`}>
                  No connected repositories found
                </div>
              ) : (
                <div className={`space-y-2 max-h-48 overflow-y-auto border rounded-sm p-3 ${
                  darkMode ? 'border-neutral-700 bg-neutral-900' : 'border-gray-200 bg-gray-50'
                }`}>
                  <button
                    onClick={() => {
                      const allRepos = connectedRepos.map(r => r.full_name);
                      setLocalFilters(prev => ({
                        ...prev,
                        repos: selectedRepos.length === totalConnectedRepos ? [] : allRepos
                      }));
                    }}
                    className={`w-full flex items-center space-x-2 p-2 rounded-sm text-sm hover:bg-opacity-80 transition-colors ${
                      darkMode ? 'hover:bg-neutral-800' : 'hover:bg-gray-100'
                    }`}
                  >
                    <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                      selectedRepos.length === totalConnectedRepos
                        ? darkMode 
                          ? 'bg-brand-gold-600 border-brand-gold-600' 
                          : 'bg-brand-gold-600 border-brand-gold-600'
                        : darkMode
                          ? 'border-neutral-600'
                          : 'border-gray-300'
                    }`}>
                      {selectedRepos.length === totalConnectedRepos && (
                        <Check className="w-3 h-3 text-white" />
                      )}
                    </div>
                    <span className={`font-medium ${
                      darkMode ? 'text-neutral-200' : 'text-gray-700'
                    }`}>
                      {selectedRepos.length === totalConnectedRepos ? 'Deselect All' : 'Select All'}
                    </span>
                  </button>
                  
                  {connectedRepos.map((repo) => {
                    const isSelected = selectedRepos.includes(repo.full_name);
                    return (
                      <div key={repo.full_name} className="space-y-1">
                        <button
                          onClick={() => handleRepoToggle(repo.full_name)}
                          className={`w-full flex items-center space-x-2 p-2 rounded-sm text-sm hover:bg-opacity-80 transition-colors ${
                            darkMode ? 'hover:bg-neutral-800' : 'hover:bg-gray-100'
                          }`}
                        >
                          <div className={`w-4 h-4 border rounded flex items-center justify-center ${
                            isSelected
                              ? darkMode 
                                ? 'bg-brand-gold-600 border-brand-gold-600' 
                                : 'bg-brand-gold-600 border-brand-gold-600'
                              : darkMode
                                ? 'border-neutral-600'
                                : 'border-gray-300'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <div className="flex-1 text-left">
                            <div className={`font-medium ${
                              darkMode ? 'text-neutral-200' : 'text-gray-700'
                            }`}>
                              {repo.full_name}
                            </div>
                            <div className={`text-xs ${
                              darkMode ? 'text-neutral-400' : 'text-gray-500'
                            }`}>
                              Branch: {repo.active_branch}
                            </div>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between p-4 border-t ${
          darkMode ? 'border-neutral-800 bg-neutral-900' : 'border-gray-200 bg-gray-50'
        }`}>
          <button
            onClick={handleClear}
            className={`px-4 py-2 text-sm transition-colors ${
              darkMode ? 'text-neutral-400 hover:text-neutral-200' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            Clear All
          </button>
          <div className="flex space-x-3">
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm transition-colors ${
                darkMode ? 'text-neutral-400 hover:text-neutral-200' : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              className={`px-4 py-2 rounded-sm text-sm font-medium transition-colors ${
                darkMode 
                  ? 'bg-brand-gold-600 text-brand-onyx hover:bg-brand-gold-500'
                  : 'bg-brand-gold-600 text-white hover:bg-brand-gold-700'
              }`}
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GitHubFilterPopup;