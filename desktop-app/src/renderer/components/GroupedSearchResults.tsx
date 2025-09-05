import React, { useState, useMemo } from 'react';
import { 
  ChevronDown, 
  ChevronRight, 
  FileText, 
  Code, 
  Database, 
  Image, 
  Calendar,
  Folder,
  GitBranch,
  Target
} from 'lucide-react';
import { SearchResult } from '../types';
import FileResult from './FileResult';

export type GroupingType = 'file-type' | 'relevance' | 'repository' | 'folder' | 'none';

interface GroupedSearchResultsProps {
  results: SearchResult[];
  groupBy: GroupingType;
  onGroupChange: (groupBy: GroupingType) => void;
  isLoading: boolean;
  onReindex: (filePath: string) => void;
  onToggleGranular: (filePath: string, enable: boolean) => void;
  onOpenFile: (filePath: string) => void;
  onPreview?: (filePath: string, query?: string) => void;
  darkMode: boolean;
  currentQuery?: string;
  onResultSelected?: (result: SearchResult) => void;
}

interface ResultGroup {
  key: string;
  title: string;
  count: number;
  icon: React.ReactNode;
  results: SearchResult[];
  color?: string;
}

const GroupedSearchResults: React.FC<GroupedSearchResultsProps> = ({
  results,
  groupBy,
  onGroupChange,
  isLoading,
  onReindex,
  onToggleGranular,
  onOpenFile,
  onPreview,
  darkMode,
  currentQuery,
  onResultSelected
}) => {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  // Helper functions for file type grouping
  const getFileTypeIcon = (extension: string) => {
    const codeExtensions = ['JS', 'TS', 'PY', 'JAVA', 'CPP', 'C', 'CS', 'PHP', 'RB', 'GO', 'RS'];
    const dataExtensions = ['JSON', 'XML', 'CSV', 'SQL', 'YML', 'YAML'];
    const imageExtensions = ['PNG', 'JPG', 'JPEG', 'GIF', 'SVG', 'WEBP'];

    if (codeExtensions.includes(extension)) {
      return <Code size={16} />;
    }
    if (dataExtensions.includes(extension)) {
      return <Database size={16} />;
    }
    if (imageExtensions.includes(extension)) {
      return <Image size={16} />;
    }
    return <FileText size={16} />;
  };

  const getFileTypeColor = (extension: string) => {
    const colorMap: Record<string, string> = {
      'JS': 'text-yellow-400',
      'TS': 'text-blue-400',
      'PY': 'text-green-400',
      'JAVA': 'text-red-400',
      'CPP': 'text-blue-500',
      'C': 'text-blue-500',
      'CS': 'text-purple-400',
      'PHP': 'text-purple-500',
      'RB': 'text-red-500',
      'GO': 'text-cyan-400',
      'RS': 'text-orange-400',
      'JSON': 'text-yellow-300',
      'XML': 'text-orange-300',
      'MD': 'text-blue-300',
      'TXT': 'text-neutral-400'
    };
    return colorMap[extension] || 'text-neutral-400';
  };

  // Group results based on the selected grouping type
  const groupedResults = useMemo(() => {
    if (groupBy === 'none') {
      return [{
        key: 'all',
        title: 'All Results',
        count: results.length,
        icon: <FileText size={16} />,
        results,
        color: 'text-neutral-400'
      }];
    }

    const groups: Record<string, ResultGroup> = {};

    results.forEach(result => {
      let groupKey: string;
      let groupTitle: string;
      let groupIcon: React.ReactNode;
      let groupColor: string;

      switch (groupBy) {
        case 'file-type':
          const extension = result.file_type.startsWith('.') 
            ? result.file_type.slice(1).toUpperCase()
            : result.file_type.toUpperCase();
          groupKey = extension;
          groupTitle = `${extension} Files`;
          groupColor = getFileTypeColor(extension);
          groupIcon = getFileTypeIcon(extension);
          break;

        case 'relevance':
          // Group by confidence/relevance level
          const confidence = result.confidence;
          if (confidence >= 0.8) {
            groupKey = 'high-confidence';
            groupTitle = 'High Relevance';
            groupColor = 'text-green-400';
          } else if (confidence >= 0.6) {
            groupKey = 'medium-confidence';
            groupTitle = 'Medium Relevance';
            groupColor = 'text-yellow-400';
          } else if (confidence >= 0.4) {
            groupKey = 'low-confidence';
            groupTitle = 'Lower Relevance';
            groupColor = 'text-orange-400';
          } else {
            groupKey = 'minimal-confidence';
            groupTitle = 'Minimal Relevance';
            groupColor = 'text-neutral-500';
          }
          groupIcon = <Target size={16} />;
          break;

        case 'repository':
          if (result.file_path.includes('gh://')) {
            // GitHub repository
            const repoMatch = result.file_path.match(/gh:\/\/([^@]+)@/);
            groupKey = repoMatch ? repoMatch[1] : 'unknown-repo';
            groupTitle = groupKey;
            groupIcon = <GitBranch size={16} />;
            groupColor = 'text-brand-gold-400';
          } else {
            // Local files
            groupKey = 'local';
            groupTitle = 'Local Files';
            groupIcon = <Folder size={16} />;
            groupColor = 'text-neutral-400';
          }
          break;

        case 'folder':
          const pathParts = result.file_path.split('/');
          const folder = pathParts.length > 1 ? pathParts[pathParts.length - 2] : 'Root';
          groupKey = folder;
          groupTitle = folder;
          groupIcon = <Folder size={16} />;
          groupColor = 'text-neutral-400';
          break;

        default:
          groupKey = 'all';
          groupTitle = 'All Results';
          groupIcon = <FileText size={16} />;
          groupColor = 'text-neutral-400';
      }

      if (!groups[groupKey]) {
        groups[groupKey] = {
          key: groupKey,
          title: groupTitle,
          count: 0,
          icon: groupIcon,
          results: [],
          color: groupColor
        };
      }

      groups[groupKey].results.push(result);
      groups[groupKey].count++;
    });

    // Sort groups by count (descending)
    return Object.values(groups).sort((a, b) => b.count - a.count);
  }, [results, groupBy]);

  // Auto-expand groups when groupBy changes
  React.useEffect(() => {
    if (groupedResults.length <= 3) {
      // Auto-expand all groups if there are 3 or fewer
      setExpandedGroups(new Set(groupedResults.map(g => g.key)));
    } else {
      // Auto-expand the largest group
      const largestGroup = groupedResults[0];
      if (largestGroup) {
        setExpandedGroups(new Set([largestGroup.key]));
      }
    }
  }, [groupBy, groupedResults]);

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupKey)) {
        newSet.delete(groupKey);
      } else {
        newSet.add(groupKey);
      }
      return newSet;
    });
  };

  const toggleFileExpansion = (filePath: string) => {
    setExpandedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  };

  if (isLoading) {
    return (
      <div className="soft-card p-6">
        <div className="flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-neutral-600 border-t-neutral-200 rounded-full animate-spin mr-3" />
          <span className="text-neutral-300">Loading results...</span>
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="soft-card p-6 text-center">
        <FileText size={32} className="mx-auto mb-3 text-neutral-500" />
        <h3 className="text-lg font-medium mb-2 text-neutral-200">No results found</h3>
        <p className="text-sm text-neutral-400">Try adjusting your search terms or filters</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Grouping Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <h2 className="text-base font-semibold text-neutral-200">Search Results</h2>
          <span className="px-2 py-1 bg-neutral-800 border border-neutral-700 rounded text-xs text-neutral-300">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          <span className="text-xs text-neutral-400">Group by:</span>
          <select
            value={groupBy}
            onChange={(e) => onGroupChange(e.target.value as GroupingType)}
            className="bg-neutral-800 border border-neutral-700 rounded px-2 py-1 text-xs text-neutral-200 focus:outline-none focus:ring-2 focus:ring-brand-gold-500"
          >
            <option value="none">None</option>
            <option value="file-type">File Type</option>
            <option value="relevance">Relevance</option>
            <option value="repository">Repository</option>
            <option value="folder">Folder</option>
          </select>
        </div>
      </div>

      {/* Grouped Results */}
      <div className="space-y-3">
        {groupedResults.map((group) => (
          <div key={group.key} className="soft-card">
            {/* Group Header */}
            <button
              onClick={() => toggleGroup(group.key)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-neutral-800 transition-colors rounded-t-md"
            >
              <div className="flex items-center space-x-3">
                {expandedGroups.has(group.key) ? (
                  <ChevronDown size={16} className="text-neutral-400" />
                ) : (
                  <ChevronRight size={16} className="text-neutral-400" />
                )}
                
                <div className={`${group.color}`}>
                  {group.icon}
                </div>
                
                <span className="font-medium text-neutral-200">{group.title}</span>
                
                <span className="px-2 py-1 bg-neutral-700 rounded text-xs text-neutral-300">
                  {group.count}
                </span>
              </div>
              
              <div className="text-xs text-neutral-500">
                {expandedGroups.has(group.key) ? 'Collapse' : 'Expand'}
              </div>
            </button>

            {/* Group Content */}
            {expandedGroups.has(group.key) && (
              <div className="border-t border-neutral-700">
                <div className="space-y-2 p-2">
                  {group.results.map((result, index) => (
                    <div key={`${result.file_path}-${index}`} className="animate-fade-in">
                      <FileResult
                        result={result}
                        isExpanded={expandedFiles.has(result.file_path)}
                        onToggleExpansion={() => toggleFileExpansion(result.file_path)}
                        onReindex={onReindex}
                        onToggleGranular={onToggleGranular}
                        onOpenFile={onOpenFile}
                        onPreview={onPreview}
                        darkMode={darkMode}
                        onSelect={onResultSelected}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default GroupedSearchResults;