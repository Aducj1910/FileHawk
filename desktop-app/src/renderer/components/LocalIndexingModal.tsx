import React, { useState, useEffect } from 'react';
import { X, Folder, File, ChevronRight, ChevronDown } from 'lucide-react';
import { api } from '../utils/api';
import GoldButton from '../ui/GoldButton';

interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  excluded?: boolean;
  size?: number;
}

interface LocalIndexingModalProps {
  isOpen: boolean;
  folders: string[];
  onClose: () => void;
  onIndexStart: (config: {
    folders: string[];
    mode: 'gist' | 'pinpoint';
    excludes: string[];
    maxSizeMb: number;
  }) => void;
}

const LocalIndexingModal: React.FC<LocalIndexingModalProps> = ({
  isOpen,
  folders,
  onClose,
  onIndexStart
}) => {
  const [mode, setMode] = useState<'gist' | 'pinpoint'>('gist');
  const [maxSizeMb, setMaxSizeMb] = useState(10);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [excludes, setExcludes] = useState<Set<string>>(new Set([
    'node_modules',
    '.git',
    '.DS_Store',
    '*.log',
    'dist',
    'build',
    '__pycache__',
    '.vscode',
    '.idea',
    '*.pyc'
  ]));
  const [loading, setLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && folders.length > 0) {
      loadFileTree();
      loadPreviousSettings();
    }
  }, [isOpen, folders]);

  const loadPreviousSettings = async () => {
    try {
      const result = await api.getFolderSettings(folders);
      if (result.success && result.excludes && result.max_size_mb) {
        setExcludes(new Set(result.excludes));
        setMaxSizeMb(result.max_size_mb);
      }
    } catch (error) {
      console.error('Error loading previous settings:', error);
      // Continue with default settings
    }
  };

  const loadFileTree = async () => {
    if (!folders.length) return;
    
    setLoading(true);
    try {
      // Scan the first folder for structure (if multiple folders, we'll just show the first one's structure)
      const result = await api.scanFolderStructure(folders[0]);
      if (result.success) {
        setFileTree(result.tree || []);
        // Auto-expand first level
        const firstLevel = new Set(result.tree?.map((node: FileTreeNode) => node.path) || []);
        setExpandedDirs(firstLevel);
      }
    } catch (error) {
      console.error('Error loading file tree:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (path: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedDirs(newExpanded);
  };

  const toggleExclusion = (path: string) => {
    const newExcludes = new Set(excludes);
    if (newExcludes.has(path)) {
      newExcludes.delete(path);
    } else {
      newExcludes.add(path);
    }
    setExcludes(newExcludes);
  };

  const renderTreeNode = (node: FileTreeNode, depth: number = 0) => {
    const isExpanded = expandedDirs.has(node.path);
    const isExcluded = excludes.has(node.path) || excludes.has(node.name);
    
    return (
      <div key={node.path}>
        <div 
          className={`flex items-center py-1 px-2 rounded cursor-pointer transition-colors ${
            isExcluded 
              ? 'bg-red-500/10 text-red-400' 
              : 'hover:bg-neutral-800/50'
          }`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => toggleExclusion(node.path)}
        >
          {node.type === 'directory' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(node.path);
              }}
              className="mr-1 p-0.5 hover:bg-neutral-700 rounded"
            >
              {isExpanded ? (
                <ChevronDown className="h-3 w-3 text-neutral-400" />
              ) : (
                <ChevronRight className="h-3 w-3 text-neutral-400" />
              )}
            </button>
          )}
          
          {node.type === 'directory' ? (
            <Folder className={`h-4 w-4 mr-2 ${isExcluded ? 'text-red-400' : 'text-blue-400'}`} />
          ) : (
            <File className={`h-4 w-4 mr-2 ${isExcluded ? 'text-red-400' : 'text-neutral-400'}`} />
          )}
          
          <span className={`text-sm flex-1 ${isExcluded ? 'line-through' : ''}`}>
            {node.name}
            {node.size && node.type === 'file' && (
              <span className="text-xs text-neutral-500 ml-2">
                ({(node.size / 1024 / 1024).toFixed(1)}MB)
              </span>
            )}
          </span>
          
          {isExcluded && (
            <span className="text-xs text-red-500 ml-2">excluded</span>
          )}
        </div>
        
        {node.type === 'directory' && isExpanded && node.children && (
          <div>
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const handleStartIndexing = () => {
    onIndexStart({
      folders,
      mode,
      excludes: Array.from(excludes),
      maxSizeMb
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 rounded-lg border border-neutral-700 w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-neutral-800">
          <div>
            <h2 className="text-lg font-semibold text-neutral-200">Configure Indexing</h2>
            <p className="text-sm text-neutral-400 mt-1">
              Select files and folders to exclude, set size limits
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto flex flex-col p-6 space-y-6">
          {/* Selected Folders */}
          <div>
            <h3 className="text-sm font-medium text-neutral-300 mb-2">Selected Folders</h3>
            <div className="space-y-1">
              {folders.map(folder => (
                <div key={folder} className="text-sm text-neutral-400 font-mono bg-neutral-800/30 px-3 py-1.5 rounded">
                  {folder}
                </div>
              ))}
            </div>
          </div>

          {/* Chunking Mode */}
          <div>
            <h3 className="text-sm font-medium text-neutral-300 mb-3">Indexing Mode</h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center space-x-3 p-3 border border-neutral-700 rounded cursor-pointer hover:border-neutral-600">
                <input
                  type="radio"
                  name="mode"
                  value="gist"
                  checked={mode === 'gist'}
                  onChange={() => setMode('gist')}
                  className="text-amber-500 focus:ring-amber-500"
                />
                <div>
                  <div className="text-sm font-medium text-neutral-200">Gist Mode</div>
                  <div className="text-xs text-neutral-400">Large chunks, better for topics</div>
                </div>
              </label>
              <label className="flex items-center space-x-3 p-3 border border-neutral-700 rounded cursor-pointer hover:border-neutral-600">
                <input
                  type="radio"
                  name="mode"
                  value="pinpoint"
                  checked={mode === 'pinpoint'}
                  onChange={() => setMode('pinpoint')}
                  className="text-amber-500 focus:ring-amber-500"
                />
                <div>
                  <div className="text-sm font-medium text-neutral-200">Pinpoint Mode</div>
                  <div className="text-xs text-neutral-400">Small chunks, precise search</div>
                </div>
              </label>
            </div>
          </div>

          {/* Max File Size */}
          <div>
            <h3 className="text-sm font-medium text-neutral-300 mb-2">Max File Size</h3>
            <div className="flex items-center space-x-3">
              <input
                type="number"
                value={maxSizeMb}
                onChange={(e) => setMaxSizeMb(Math.max(1, parseInt(e.target.value) || 10))}
                className="w-20 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-sm focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                min="1"
              />
              <span className="text-sm text-neutral-400">MB per file</span>
            </div>
          </div>

          {/* File Structure */}
          <div className="flex flex-col">
            <h3 className="text-sm font-medium text-neutral-300 mb-2">
              File Structure {folders.length > 1 && `(showing ${folders[0]})`}
            </h3>
            <div className="max-h-64 border border-neutral-700 rounded bg-neutral-900/50 overflow-auto">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <div className="text-sm text-neutral-400">Loading file structure...</div>
                </div>
              ) : fileTree.length > 0 ? (
                <div className="p-2">
                  {fileTree.map(node => renderTreeNode(node))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-32">
                  <div className="text-sm text-neutral-500">No files found</div>
                </div>
              )}
            </div>
          </div>

          {/* Current Exclusions */}
          <div>
            <h3 className="text-sm font-medium text-neutral-300 mb-2">
              Excluded Patterns ({excludes.size})
            </h3>
            <div className="max-h-24 overflow-y-auto border border-neutral-700 rounded bg-neutral-800/30 p-2">
              {Array.from(excludes).length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {Array.from(excludes).map(exclude => (
                    <span
                      key={exclude}
                      className="inline-flex items-center px-2 py-1 bg-red-500/20 text-red-300 text-xs rounded border border-red-500/30"
                    >
                      {exclude}
                      <button
                        onClick={() => toggleExclusion(exclude)}
                        className="ml-1 hover:text-red-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-neutral-500">No exclusions</div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-neutral-800 p-6">
          <div className="flex justify-end space-x-3">
            <GoldButton
              variant="ghost"
              onClick={onClose}
            >
              Cancel
            </GoldButton>
            <GoldButton
              variant="solid"
              onClick={handleStartIndexing}
              disabled={loading}
            >
              {loading ? 'Loading...' : 'Start Indexing'}
            </GoldButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocalIndexingModal;