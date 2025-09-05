import React, { useState, useEffect } from 'react';
import { GitHubRepo, GitHubBranch } from '../types';
import { api } from '../utils/api';
import { X, Folder, File, ChevronRight, ChevronDown } from 'lucide-react';

interface FileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  excluded?: boolean;
  size?: number;
}

interface PostCloneModalProps {
  isOpen: boolean;
  repo: GitHubRepo | null;
  onClose: () => void;
  onIndexStart: (config: {
    branch: string;
    mode: 'gist' | 'pinpoint' | 'both';
    excludes: string[];
    maxSizeMb: number;
  }) => void;
}

const PostCloneModal: React.FC<PostCloneModalProps> = ({
  isOpen,
  repo,
  onClose,
  onIndexStart
}) => {
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [mode, setMode] = useState<'gist' | 'pinpoint' | 'both'>('both');
  const [maxSizeMb, setMaxSizeMb] = useState(10);
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([]);
  const [excludes, setExcludes] = useState<Set<string>>(new Set([
    'node_modules',
    '.git',
    '.DS_Store',
    '*.log',
    'dist',
    'build'
  ]));
  const [loading, setLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && repo) {
      loadBranches();
      loadFileTree();
    }
  }, [isOpen, repo]);

  useEffect(() => {
    if (branches.length > 0 && repo) {
      // Always set to the repo's default_branch when modal opens (this could be the switched branch)
      const targetBranch = branches.find(b => b.name === repo.default_branch) || branches[0];
      setSelectedBranch(targetBranch.name);
    }
  }, [branches, repo?.default_branch]);

  // Reload file tree when selected branch changes
  useEffect(() => {
    if (selectedBranch && repo) {
      loadFileTree();
    }
  }, [selectedBranch]);

  const handleBranchChange = async (newBranch: string) => {
    if (!repo || newBranch === selectedBranch) return;
    
    const previousBranch = selectedBranch;
    
    try {
      setLoading(true);
      console.log(`Checking out branch ${newBranch} for ${repo.full_name}`);
      
      // Checkout the new branch first
      const checkoutResult = await api.checkoutGitHubBranch(repo.full_name, newBranch);
      
      if (checkoutResult.success) {
        // Update the selected branch and reload file tree
        setSelectedBranch(newBranch);
        await loadFileTree();
        console.log(`checked out branch ${newBranch}`);
      } else {
        // Keep the previous selection if checkout failed
        console.error('Failed to checkout branch:', checkoutResult.error);
        alert(`Failed to switch to branch "${newBranch}": ${checkoutResult.error || 'Unknown error'}`);
      }
    } catch (error) {
      // Keep the previous selection if there was an error
      console.error('Error checking out branch:', error);
      alert(`Error switching to branch "${newBranch}": ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const loadBranches = async () => {
    if (!repo) return;
    try {
      const result = await api.getGitHubBranches(repo.full_name);
      setBranches(result.branches);
    } catch (error) {
      console.error('Failed to load branches:', error);
    }
  };

  const loadFileTree = async () => {
    if (!repo) return;
    try {
      setLoading(true);
      const result = await api.getGitHubFileTree(repo.full_name, selectedBranch || undefined);
      if (result.success && result.tree) {
        // Convert the tree to an array format for easier handling
        const convertTree = (node: any): FileTreeNode => ({
          path: node.path,
          name: node.name,
          type: node.type,
          size: node.size,
          children: node.children ? node.children.map(convertTree) : undefined
        });
        
        setFileTree(result.tree.children ? result.tree.children.map(convertTree) : []);
        
        // Auto-expand the first few directories
        const autoExpand = new Set<string>();
        const addToAutoExpand = (nodes: FileTreeNode[], maxDepth = 2, currentDepth = 0) => {
          if (currentDepth >= maxDepth) return;
          nodes.forEach(node => {
            if (node.type === 'directory' && node.children && node.children.length > 0) {
              autoExpand.add(node.path);
              if (node.children.length <= 5) { // Only expand if not too many children
                addToAutoExpand(node.children, maxDepth, currentDepth + 1);
              }
            }
          });
        };
        
        addToAutoExpand(result.tree.children || []);
        setExpandedDirs(autoExpand);
      }
    } catch (error) {
      console.error('Failed to load file tree:', error);
    } finally {
      setLoading(false);
    }
  };

  const getAllChildPaths = (node: FileTreeNode): string[] => {
    const paths: string[] = [node.path];
    if (node.children) {
      node.children.forEach(child => {
        paths.push(...getAllChildPaths(child));
      });
    }
    return paths;
  };

  const toggleExclude = (path: string, node?: FileTreeNode) => {
    setExcludes(prev => {
      const newExcludes = new Set(prev);
      
      // If we have the node and it's a directory, handle recursively
      if (node && node.type === 'directory' && node.children) {
        const allPaths = getAllChildPaths(node);
        
        if (newExcludes.has(path)) {
          // Unchecking - remove this and all children
          allPaths.forEach(p => newExcludes.delete(p));
        } else {
          // Checking to exclude - add this and all children
          allPaths.forEach(p => newExcludes.add(p));
        }
      } else {
        // Simple toggle for files or when node not provided
        if (newExcludes.has(path)) {
          newExcludes.delete(path);
        } else {
          newExcludes.add(path);
        }
      }
      
      return newExcludes;
    });
  };

  const toggleExpanded = (path: string) => {
    setExpandedDirs(prev => {
      const newExpanded = new Set(prev);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      return newExpanded;
    });
  };

  const renderFileTreeNode = (node: FileTreeNode, level: number = 0): React.ReactNode => {
    const isExcluded = excludes.has(node.path) || excludes.has(node.name);
    const isExpanded = expandedDirs.has(node.path);
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div key={node.path} className={`${level > 0 ? 'ml-4' : ''}`}>
        <div className="flex items-center space-x-2 py-1 hover:bg-neutral-800 rounded-sm">
          <div className="flex items-center space-x-1 flex-1 min-w-0">
            {hasChildren && (
              <button
                onClick={() => toggleExpanded(node.path)}
                className="p-0.5 hover:bg-neutral-700 rounded"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-neutral-400" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-neutral-400" />
                )}
              </button>
            )}
            {!hasChildren && <div className="w-4" />}
            
            <input
              type="checkbox"
              checked={!isExcluded}
              onChange={() => toggleExclude(node.path, node)}
              className="h-3 w-3 text-neutral-300 focus:ring-neutral-400 border-brand-border rounded-sm bg-brand-coal"
            />
            
            {node.type === 'directory' ? (
              <Folder className="w-4 h-4 text-neutral-400" />
            ) : (
              <File className="w-4 h-4 text-neutral-500" />
            )}
            
            <span className={`text-sm truncate ${isExcluded ? 'text-neutral-500 line-through' : 'text-neutral-300'}`}>
              {node.name}
            </span>
            
            {node.size && (
              <span className="text-xs text-neutral-500 ml-auto">
                {(node.size / 1024).toFixed(1)}KB
              </span>
            )}
          </div>
        </div>
        
        {hasChildren && isExpanded && (
          <div className="ml-2">
            {node.children?.map(child => renderFileTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  const handleIndexStart = () => {
    if (!selectedBranch) return;
    
    const config = {
      branch: selectedBranch,
      mode,
      excludes: Array.from(excludes),
      maxSizeMb
    };
    
    onIndexStart(config);
  };

  if (!isOpen || !repo) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-brand-coal border border-neutral-700 rounded-sm shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b border-neutral-800">
          <div>
            <h3 className="text-[14px] font-semibold text-neutral-100">
              Configure Repository Indexing
            </h3>
            <p className="text-[12px] text-neutral-400 mt-0.5">
              {repo.full_name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-neutral-800 rounded-sm transition-colors"
          >
            <X className="w-4 h-4 text-neutral-400" />
          </button>
        </div>

        <div className="p-3 space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">
          {/* Branch Selection */}
          <div>
            <label className="block text-[12px] font-medium text-neutral-200 mb-1.5">
              Branch to Index
            </label>
            <div className="relative">
              <select
                value={selectedBranch}
                onChange={(e) => handleBranchChange(e.target.value)}
                disabled={loading}
                className="w-full bg-neutral-800 border border-neutral-700 text-neutral-200 rounded-sm px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-neutral-500 disabled:opacity-50"
              >
                {branches.map(branch => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name}
                    {branch.name === repo.default_branch && ' (default)'}
                    {!branch.available_locally && ' (will fetch on demand)'}
                  </option>
                ))}
              </select>
              {loading && (
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                  <div className="w-3 h-3 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
            </div>
            {loading && (
              <p className="text-[10px] text-brand-gold-300 mt-1">
                {selectedBranch && !branches.find(b => b.name === selectedBranch)?.available_locally
                  ? 'Fetching branch from remote and switching...'
                  : 'Switching branch and reloading files...'
                }
              </p>
            )}
          </div>

          {/* Chunking Mode */}
          <div>
            <label className="block text-[12px] font-medium text-neutral-200 mb-1.5">
              Chunking Mode
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'gist', label: 'Gist', desc: 'File-level search' },
                { value: 'pinpoint', label: 'Pinpoint', desc: 'Precise line-level' },
                { value: 'both', label: 'Both', desc: 'Complete coverage' }
              ].map(option => (
                <button
                  key={option.value}
                  onClick={() => setMode(option.value as any)}
                  className={`p-2 border rounded-sm text-left transition-colors ${
                    mode === option.value
                      ? 'border-neutral-500 bg-neutral-800 text-neutral-100'
                      : 'border-neutral-700 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-800'
                  }`}
                >
                  <div className="font-medium text-[12px]">{option.label}</div>
                  <div className="text-[10px] text-neutral-400 mt-0.5">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Max File Size */}
          <div>
            <label className="block text-[12px] font-medium text-neutral-200 mb-1.5">
              Max File Size (MB)
            </label>
            <input
              type="number"
              value={maxSizeMb}
              onChange={(e) => setMaxSizeMb(Number(e.target.value))}
              min="1"
              max="100"
              className="w-full bg-neutral-800 border border-neutral-700 text-neutral-200 rounded-sm px-2.5 py-1.5 text-[12px] focus:outline-none focus:border-neutral-500"
            />
            <p className="text-[10px] text-neutral-500 mt-1">
              Files larger than this will be skipped during indexing
            </p>
          </div>

          {/* File Tree */}
          <div>
            <label className="block text-[12px] font-medium text-neutral-200 mb-1.5">
              Files to Index
            </label>
            <div className="border border-neutral-700 rounded-sm p-3 max-h-64 overflow-y-auto bg-neutral-900">
              {loading ? (
                <div className="flex items-center justify-center py-8 text-neutral-400">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-gold-600 mr-2"></div>
                  <span className="text-[12px]">Loading files...</span>
                </div>
              ) : fileTree.length > 0 ? (
                fileTree.map(node => renderFileTreeNode(node))
              ) : (
                <div className="text-center py-8 text-neutral-400 text-[12px]">
                  No files found
                </div>
              )}
            </div>
            <p className="text-[10px] text-neutral-500 mt-1">
              Uncheck files or folders to exclude them from indexing
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t border-neutral-800 bg-neutral-900">
          <div className="text-[12px] text-neutral-400">
            Ready to index with {mode} mode
          </div>
          <div className="flex space-x-2">
            <button
              onClick={onClose}
              className="px-2.5 py-1.5 text-[12px] text-neutral-400 hover:text-neutral-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleIndexStart}
              disabled={!selectedBranch}
              className="px-2.5 py-1.5 text-[12px] bg-brand-gold-600 text-white rounded-sm hover:bg-brand-gold-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Index Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PostCloneModal;