import React from 'react';
import { 
  Activity, 
  Database, 
  GitBranch, 
  Globe, 
  HardDrive, 
  Zap, 
  Clock, 
  CheckCircle,
  AlertCircle,
  Loader,
  Search
} from 'lucide-react';
import { IndexingStatus, AppState } from '../types';

interface StatusBarProps {
  indexingStatus: IndexingStatus;
  currentChunkingMode: 'gist' | 'pinpoint';
  currentRoute: string;
  searchResultsCount?: number;
  connectedRepos?: number;
  modelName?: string;
  darkMode?: boolean;
  onModeToggle?: () => void;
  onNavigate?: (route: string) => void;
  onShowRepos?: () => void;
  onShowSettings?: () => void;
}

const StatusBar: React.FC<StatusBarProps> = ({
  indexingStatus,
  currentChunkingMode,
  currentRoute,
  searchResultsCount = 0,
  connectedRepos = 0,
  modelName,
  darkMode = true,
  onModeToggle,
  onNavigate,
  onShowRepos,
  onShowSettings
}) => {
  const formatFileCount = (count: number) => {
    if (count < 1000) return count.toString();
    if (count < 1000000) return `${(count / 1000).toFixed(1)}k`;
    return `${(count / 1000000).toFixed(1)}m`;
  };

  const getStatusIcon = () => {
    if (indexingStatus.is_indexing) {
      return <Loader size={14} className="animate-spin text-brand-gold-400" />;
    }
    if (indexingStatus.message === 'Ready') {
      return <CheckCircle size={14} className="text-green-400" />;
    }
    if (indexingStatus.message.includes('Error') || indexingStatus.message.includes('Failed')) {
      return <AlertCircle size={14} className="text-red-400" />;
    }
    return <Activity size={14} className="text-neutral-400" />;
  };

  const getRouteInfo = () => {
    switch (currentRoute) {
      case 'home':
        return {
          icon: <HardDrive size={14} />,
          label: 'Local Files',
          description: 'Searching local indexed files'
        };
      case 'github':
        return {
          icon: <Globe size={14} />,
          label: 'GitHub',
          description: `${connectedRepos} repositories connected`
        };
      case 'settings':
        return {
          icon: <Activity size={14} />,
          label: 'Settings',
          description: 'Application configuration'
        };
      case 'track-files':
        return {
          icon: <Database size={14} />,
          label: 'File Tracking',
          description: 'Manage indexed files'
        };
      case 'saved':
        return {
          icon: <Search size={14} />,
          label: 'Saved Searches',
          description: 'Bookmarked search queries'
        };
      default:
        return {
          icon: <Activity size={14} />,
          label: 'FileHawk',
          description: 'Ready'
        };
    }
  };

  const routeInfo = getRouteInfo();

  return (
    <div className="bg-brand-coal border-t border-brand-border px-4 py-2 flex items-center justify-between text-xs text-neutral-400 flex-shrink-0">
      {/* Left section - Current status and route */}
      <div className="flex items-center space-x-6">
        {/* Indexing Status */}
        <div className="flex items-center space-x-2">
          {getStatusIcon()}
          <span className="flex items-center space-x-1">
            <span>{indexingStatus.message}</span>
            {indexingStatus.is_indexing && indexingStatus.total_files > 0 && (
              <span className="text-neutral-500">
                ({indexingStatus.progress}/{indexingStatus.total_files})
              </span>
            )}
          </span>
        </div>

        {/* Current Route - Clickable */}
        <button 
          onClick={() => onNavigate?.(currentRoute)}
          className="flex items-center space-x-2 border-l border-neutral-700 pl-4 hover:text-neutral-200 transition-colors cursor-pointer"
          title="Current page info"
        >
          <div className="text-neutral-400">
            {routeInfo.icon}
          </div>
          <span className="font-medium text-neutral-300">{routeInfo.label}</span>
          <span className="text-neutral-500">•</span>
          <span>{routeInfo.description}</span>
        </button>

        {/* Search Results (when applicable) */}
        {searchResultsCount > 0 && (
          <div className="flex items-center space-x-2 border-l border-neutral-700 pl-4">
            <Search size={14} className="text-neutral-400" />
            <span>
              {formatFileCount(searchResultsCount)} result{searchResultsCount !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* Right section - Technical info */}
      <div className="flex items-center space-x-6">
        {/* Search Mode - Clickable to toggle */}
        <button 
          onClick={() => onModeToggle?.()}
          className="flex items-center space-x-2 hover:text-neutral-200 transition-colors cursor-pointer"
          title="Click to toggle between Gist and Pinpoint modes"
        >
          <Zap size={14} className="text-brand-gold-400" />
          <span className="font-medium text-neutral-300">
            {currentChunkingMode === 'gist' ? 'Gist Mode' : 'Pinpoint Mode'}
          </span>
          <span className="text-neutral-500">•</span>
          <span>
            {modelName || (currentChunkingMode === 'gist' ? 'MSMarco-MiniLM-L6' : 'AllMiniLM-L6-v2')}
          </span>
        </button>

        {/* GitHub Repos (if on GitHub page) - Clickable */}
        {currentRoute === 'github' && connectedRepos > 0 && (
          <button 
            onClick={() => onShowRepos?.()}
            className="flex items-center space-x-2 border-l border-neutral-700 pl-4 hover:text-neutral-200 transition-colors cursor-pointer"
            title="View connected repositories"
          >
            <GitBranch size={14} className="text-neutral-400" />
            <span>
              {connectedRepos} repo{connectedRepos !== 1 ? 's' : ''}
            </span>
          </button>
        )}

        {/* Memory/Performance indicator - Clickable for settings */}
        <button 
          onClick={() => onShowSettings?.()}
          className="flex items-center space-x-2 border-l border-neutral-700 pl-4 hover:text-neutral-200 transition-colors cursor-pointer"
          title="Open settings"
        >
          <Database size={14} className="text-neutral-400" />
          <span>Ready</span>
        </button>
      </div>
    </div>
  );
};

export default StatusBar;