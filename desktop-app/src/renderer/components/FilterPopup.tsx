import React, { useState, useRef, useEffect } from 'react';
import { FilterOptions } from '../types';

interface FilterPopupProps {
  isOpen: boolean;
  onClose: () => void;
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  onFolderSelect: () => void;
  darkMode: boolean;
}

const FilterPopup: React.FC<FilterPopupProps> = ({ 
  isOpen, 
  onClose, 
  filters, 
  onFiltersChange, 
  onFolderSelect,
  darkMode 
}) => {
  const popupRef = useRef<HTMLDivElement>(null);
  const [localFilters, setLocalFilters] = useState<FilterOptions>(filters);
  const [customPatternInput, setCustomPatternInput] = useState('');

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Update local filters when props change
  useEffect(() => {
    setLocalFilters(filters);
  }, [filters]);

  const handleApplyFilters = () => {
    onFiltersChange(localFilters);
    onClose();
  };

  const handleResetFilters = () => {
    const resetFilters: FilterOptions = {
      fileTypes: [],
      timeRange: {
        type: 'all',
        before: null,
        after: null,
        startDate: null,
        endDate: null
      },
      searchFolder: null
    };
    setLocalFilters(resetFilters);
    onFiltersChange(resetFilters);
  };

  const handleFileTypeChange = (fileType: string, checked: boolean) => {
    setLocalFilters(prev => ({
      ...prev,
      fileTypes: checked 
        ? [...prev.fileTypes, fileType]
        : prev.fileTypes.filter(type => type !== fileType)
    }));
  };

  const handleTimeRangeTypeChange = (type: 'all' | 'before' | 'after' | 'range') => {
    setLocalFilters(prev => ({
      ...prev,
      timeRange: {
        ...prev.timeRange,
        type,
        before: type === 'before' ? prev.timeRange.before : null,
        after: type === 'after' ? prev.timeRange.after : null,
        startDate: type === 'range' ? prev.timeRange.startDate : null,
        endDate: type === 'range' ? prev.timeRange.endDate : null
      }
    }));
  };

  const handleDateChange = (field: 'before' | 'after' | 'startDate' | 'endDate', value: string | null) => {
    setLocalFilters(prev => ({
      ...prev,
      timeRange: {
        ...prev.timeRange,
        [field]: value
      }
    }));
  };

  const handleFolderSelect = () => {
    // Call the parent's folder selection handler
    onFolderSelect();
  };

  // Helper functions for custom patterns
  const getCustomPatterns = () => {
    return localFilters.fileTypes.filter(type => 
      type.includes('*') || type.includes('?') || type.startsWith('!')
    );
  };

  const getStandardTypes = () => {
    return localFilters.fileTypes.filter(type => 
      !type.includes('*') && !type.includes('?') && !type.startsWith('!')
    );
  };

  const handleAddCustomPattern = () => {
    const input = customPatternInput.trim();
    if (!input) return;
    
    // Handle comma-separated patterns
    const patterns = input.split(',').map(p => p.trim()).filter(p => p);
    const validPatterns = patterns.filter(p => isPatternValid(p) && !localFilters.fileTypes.includes(p));
    
    if (validPatterns.length > 0) {
      setLocalFilters(prev => ({
        ...prev,
        fileTypes: [...prev.fileTypes, ...validPatterns]
      }));
      setCustomPatternInput('');
    }
  };

  const handleRemoveCustomPattern = (pattern: string) => {
    setLocalFilters(prev => ({
      ...prev,
      fileTypes: prev.fileTypes.filter(type => type !== pattern)
    }));
  };

  const handleCustomPatternKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCustomPattern();
    }
  };

  const validatePattern = (pattern: string): { valid: boolean; error?: string } => {
    const trimmed = pattern.trim();
    
    // Empty pattern
    if (!trimmed) return { valid: false, error: 'Pattern cannot be empty' };
    
    // Check for invalid characters
    const invalidChars = /[<>:"|]/;
    if (invalidChars.test(trimmed)) {
      return { valid: false, error: 'Invalid characters: < > : " |' };
    }
    
    // Check for malformed exclusion patterns
    if (trimmed === '!') {
      return { valid: false, error: 'Exclusion pattern needs content after !' };
    }
    
    // Check for multiple consecutive wildcards
    if (trimmed.includes('**') && !trimmed.match(/^\*\*\/|\*\*$/)) {
      return { valid: false, error: 'Use **/ for recursive directory matching' };
    }
    
    // Check for conflicting patterns
    if (trimmed.startsWith('!') && trimmed.includes('*') && trimmed.length > 10) {
      return { valid: false, error: 'Exclusion pattern might be too broad' };
    }
    
    return { valid: true };
  };

  const getPatternValidation = (pattern: string) => validatePattern(pattern);
  
  const isPatternValid = (pattern: string): boolean => validatePattern(pattern).valid;
  
  const isInputValid = (input: string): boolean => {
    if (!input.trim()) return false;
    const patterns = input.split(',').map(p => p.trim()).filter(p => p);
    return patterns.length > 0 && patterns.every(p => isPatternValid(p));
  };

  const getPatternHelp = (pattern: string): string => {
    if (pattern.startsWith('!')) {
      const innerPattern = pattern.slice(1);
      if (innerPattern.startsWith('*.')) return 'Exclude files with this extension';
      if (innerPattern.includes('/')) return 'Exclude files in specific path';
      return 'Exclude files matching this pattern';
    }
    if (pattern.startsWith('*.')) return 'Files with this extension';
    if (pattern.endsWith('*')) return 'Files starting with this name';
    if (pattern.startsWith('*') && pattern.endsWith('*')) return 'Files containing this text';
    if (pattern.startsWith('*')) return 'Files ending with this text';
    if (pattern.includes('*')) return 'Files matching this pattern';
    if (pattern.includes('/')) return 'Files in specific path';
    if (pattern.includes('?')) return 'Files with single character wildcards';
    return 'Simple extension match';
  };

  if (!isOpen) return null;

  const commonFileTypes = [
    'txt', 'md', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json',
    'pdf', 'docx', 'pptx', 'xlsx', 'csv', 'xml', 'yaml', 'yml'
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div 
        ref={popupRef}
        className="w-full max-w-md mx-4 p-6 rounded-xl shadow-2xl bg-brand-coal border border-brand-border/50 text-neutral-200 backdrop-blur-md"
      >
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold font-display text-neutral-100">Search Filters</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:bg-neutral-600/50 transition-all duration-200 group"
          >
            <svg className="w-5 h-5 text-neutral-400 group-hover:text-neutral-200 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-6">
          {/* File Type Filters */}
          <div>
            <h4 className="text-sm font-semibold mb-3 text-neutral-200 flex items-center">
              <svg className="w-4 h-4 mr-2 text-brand-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              File Types
            </h4>
            
            {/* Custom Pattern Input */}
            <div className="mb-3 p-3 bg-brand-onyx/30 rounded-md border border-brand-border/50">
              <div className="flex items-center space-x-2 mb-2">
                <input
                  type="text"
                  value={customPatternInput}
                  onChange={(e) => setCustomPatternInput(e.target.value)}
                  onKeyPress={handleCustomPatternKeyPress}
                  placeholder="*.py, test_*, !*.log, docs/*.md"
                  className="flex-1 px-3 py-1.5 text-sm rounded-md border bg-brand-coal/80 border-brand-border text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand-gold-400 focus:border-brand-gold-400 transition-all duration-200"
                />
                <button
                  type="button"
                  onClick={handleAddCustomPattern}
                  disabled={!isInputValid(customPatternInput)}
                  className="px-3 py-1.5 text-sm rounded-md bg-brand-gold-400 text-brand-coal hover:bg-brand-gold-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 font-medium"
                >
                  Add
                </button>
              </div>
              
              {/* Pattern Validation Error */}
              {customPatternInput.trim() && !isInputValid(customPatternInput) && (
                <div className="text-xs text-red-400 mt-1">
                  {(() => {
                    const patterns = customPatternInput.split(',').map(p => p.trim()).filter(p => p);
                    const invalidPattern = patterns.find(p => !isPatternValid(p));
                    if (invalidPattern) {
                      return `Invalid pattern "${invalidPattern}": ${getPatternValidation(invalidPattern).error}`;
                    }
                    return 'Invalid input';
                  })()}
                </div>
              )}
              
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <div>
                  Use wildcards: <code className="bg-brand-coal/60 px-1 rounded">*</code> (any), <code className="bg-brand-coal/60 px-1 rounded">?</code> (single), <code className="bg-brand-coal/60 px-1 rounded">!</code> (exclude)
                </div>
                <div className="flex gap-1">
                  {['*.log', 'test_*', '*config*', '!node_modules/*'].map(pattern => (
                    <button
                      key={pattern}
                      onClick={() => {
                        if (!localFilters.fileTypes.includes(pattern)) {
                          setLocalFilters(prev => ({
                            ...prev,
                            fileTypes: [...prev.fileTypes, pattern]
                          }));
                        }
                      }}
                      className="px-1.5 py-0.5 text-[10px] rounded bg-brand-coal/60 hover:bg-brand-coal/80 text-neutral-400 hover:text-neutral-200 transition-colors"
                      title={`Add ${pattern}`}
                    >
                      {pattern}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Custom Pattern Tags */}
              {getCustomPatterns().length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {getCustomPatterns().map((pattern, index) => (
                    <span 
                      key={index} 
                      className="inline-flex items-center px-2 py-1 rounded-sm text-xs bg-brand-gold-400/20 text-brand-gold-300 border border-brand-gold-400/30"
                      title={getPatternHelp(pattern)}
                    >
                      <code className="mr-1">{pattern}</code>
                      <button
                        onClick={() => handleRemoveCustomPattern(pattern)}
                        className="ml-1 hover:text-brand-gold-100 transition-colors"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Common File Types Checkboxes */}
            <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto p-2 bg-brand-onyx/30 rounded-md border border-brand-border/50">
              {commonFileTypes.map(fileType => (
                <label key={fileType} className="flex items-center space-x-2 group cursor-pointer hover:bg-brand-coal/50 rounded px-2 py-1 transition-colors">
                  <input
                    type="checkbox"
                    checked={getStandardTypes().includes(fileType)}
                    onChange={(e) => handleFileTypeChange(fileType, e.target.checked)}
                    className="h-4 w-4 text-brand-gold-600 focus:ring-brand-gold-400 border-brand-border rounded bg-brand-coal/80 checked:bg-brand-gold-500 checked:border-brand-gold-500 transition-all duration-200"
                  />
                  <span className="text-sm text-neutral-300 group-hover:text-neutral-200 transition-colors">.{fileType}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Time Range Filters */}
          <div>
            <h4 className="text-sm font-semibold mb-3 text-neutral-200 flex items-center">
              <svg className="w-4 h-4 mr-2 text-brand-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Time Indexed
            </h4>
            <div className="space-y-3 p-3 bg-brand-onyx/30 rounded-md border border-brand-border/50">
              <div className="flex items-center space-x-3 group cursor-pointer hover:bg-brand-coal/30 rounded px-2 py-1 transition-colors">
                <input
                  type="radio"
                  id="time-all"
                  name="timeRange"
                  checked={localFilters.timeRange.type === 'all'}
                  onChange={() => handleTimeRangeTypeChange('all')}
                  className="h-4 w-4 text-brand-gold-600 focus:ring-brand-gold-400 border-brand-border bg-brand-coal/80 checked:bg-brand-gold-500 checked:border-brand-gold-500 transition-all duration-200"
                />
                <label htmlFor="time-all" className="text-sm text-neutral-300 group-hover:text-neutral-200 transition-colors cursor-pointer">All time</label>
              </div>
              
              <div className="flex items-center space-x-3 group cursor-pointer hover:bg-brand-coal/30 rounded px-2 py-1 transition-colors">
                <input
                  type="radio"
                  id="time-before"
                  name="timeRange"
                  checked={localFilters.timeRange.type === 'before'}
                  onChange={() => handleTimeRangeTypeChange('before')}
                  className="h-4 w-4 text-brand-gold-600 focus:ring-brand-gold-400 border-brand-border bg-brand-coal/80 checked:bg-brand-gold-500 checked:border-brand-gold-500 transition-all duration-200"
                />
                <label htmlFor="time-before" className="text-sm text-neutral-300 group-hover:text-neutral-200 transition-colors cursor-pointer">Before</label>
                <input
                  type="date"
                  value={localFilters.timeRange.before || ''}
                  onChange={(e) => handleDateChange('before', e.target.value || null)}
                  disabled={localFilters.timeRange.type !== 'before'}
                  className="px-3 py-1.5 text-sm rounded-md border bg-brand-coal/80 border-brand-border text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand-gold-400 focus:border-brand-gold-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              
              <div className="flex items-center space-x-3 group cursor-pointer hover:bg-brand-coal/30 rounded px-2 py-1 transition-colors">
                <input
                  type="radio"
                  id="time-after"
                  name="timeRange"
                  checked={localFilters.timeRange.type === 'after'}
                  onChange={() => handleTimeRangeTypeChange('after')}
                  className="h-4 w-4 text-brand-gold-600 focus:ring-brand-gold-400 border-brand-border bg-brand-coal/80 checked:bg-brand-gold-500 checked:border-brand-gold-500 transition-all duration-200"
                />
                <label htmlFor="time-after" className="text-sm text-neutral-300 group-hover:text-neutral-200 transition-colors cursor-pointer">After</label>
                <input
                  type="date"
                  value={localFilters.timeRange.after || ''}
                  onChange={(e) => handleDateChange('after', e.target.value || null)}
                  disabled={localFilters.timeRange.type !== 'after'}
                  className="px-3 py-1.5 text-sm rounded-md border bg-brand-coal/80 border-brand-border text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand-gold-400 focus:border-brand-gold-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
              
              <div className="flex items-center space-x-3 group cursor-pointer hover:bg-brand-coal/30 rounded px-2 py-1 transition-colors">
                <input
                  type="radio"
                  id="time-range"
                  name="timeRange"
                  checked={localFilters.timeRange.type === 'range'}
                  onChange={() => handleTimeRangeTypeChange('range')}
                  className="h-4 w-4 text-brand-gold-600 focus:ring-brand-gold-400 border-brand-border bg-brand-coal/80 checked:bg-brand-gold-500 checked:border-brand-gold-500 transition-all duration-200"
                />
                <label htmlFor="time-range" className="text-sm text-neutral-300 group-hover:text-neutral-200 transition-colors cursor-pointer">Range</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="date"
                    value={localFilters.timeRange.startDate || ''}
                    onChange={(e) => handleDateChange('startDate', e.target.value || null)}
                    disabled={localFilters.timeRange.type !== 'range'}
                    className="px-3 py-1.5 text-sm rounded-md border bg-brand-coal/80 border-brand-border text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand-gold-400 focus:border-brand-gold-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="text-neutral-400 text-sm">to</span>
                  <input
                    type="date"
                    value={localFilters.timeRange.endDate || ''}
                    onChange={(e) => handleDateChange('endDate', e.target.value || null)}
                    disabled={localFilters.timeRange.type !== 'range'}
                    className="px-3 py-1.5 text-sm rounded-md border bg-brand-coal/80 border-brand-border text-neutral-200 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand-gold-400 focus:border-brand-gold-400 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Search in Folder */}
          <div>
            <h4 className="text-sm font-semibold mb-3 text-neutral-200 flex items-center">
              <svg className="w-4 h-4 mr-2 text-brand-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Search in Folder
            </h4>
            <div className="p-3 bg-brand-onyx/30 rounded-md border border-brand-border/50">
              <div className="flex items-center space-x-3">
                <input
                  type="text"
                  value={localFilters.searchFolder || ''}
                  placeholder="Select a folder to search within..."
                  readOnly
                  className="flex-1 px-3 py-2 text-sm rounded-md border bg-brand-coal/80 border-brand-border text-neutral-200 placeholder-neutral-500 cursor-pointer hover:border-brand-gold-300 transition-colors"
                  onClick={handleFolderSelect}
                />
                <button
                  type="button"
                  onClick={handleFolderSelect}
                  className="px-4 py-2 text-sm rounded-md border border-brand-gold-400 text-brand-gold-400 hover:bg-brand-gold-400 hover:text-brand-coal transition-all duration-200 font-medium"
                >
                  Browse
                </button>
              </div>
              {localFilters.searchFolder && (
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-neutral-400">
                    Selected: {localFilters.searchFolder}
                  </span>
                  <button
                    onClick={() => setLocalFilters(prev => ({ ...prev, searchFolder: null }))}
                    className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded hover:bg-red-400/10"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-brand-border/50">
          <button
            type="button"
            onClick={handleResetFilters}
            className="px-4 py-2 text-sm rounded-md border border-neutral-500 text-neutral-300 hover:border-neutral-400 hover:text-neutral-200 hover:bg-neutral-500/10 transition-all duration-200 font-medium"
          >
            Reset
          </button>
          <div className="flex space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border border-neutral-500 text-neutral-300 hover:border-neutral-400 hover:text-neutral-200 hover:bg-neutral-500/10 transition-all duration-200 font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApplyFilters}
              className="px-4 py-2 text-sm rounded-md bg-brand-gold-400 text-brand-coal hover:bg-brand-gold-300 transition-all duration-200 font-medium shadow-sm hover:shadow-md"
            >
              Apply Filters
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FilterPopup;
