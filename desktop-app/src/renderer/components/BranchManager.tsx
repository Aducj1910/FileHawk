import React, { useState, useEffect } from 'react';
import { api } from '../utils/api';

interface IndexedBranch {
  name: string;
  gist_chunks: number;
  pinpoint_chunks: number;
  total_chunks: number;
  file_count: number;
  last_indexed: number;
}

interface BranchManagerProps {
  isOpen: boolean;
  repo: {
    full_name: string;
    active_branch: string;
  };
  onClose: () => void;
  onBranchDeleted: () => void;
}

const BranchManager: React.FC<BranchManagerProps> = ({
  isOpen,
  repo,
  onClose,
  onBranchDeleted
}) => {
  const [indexedBranches, setIndexedBranches] = useState<IndexedBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingBranch, setDeletingBranch] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && repo) {
      loadIndexedBranches();
    }
  }, [isOpen, repo]);

  const loadIndexedBranches = async () => {
    if (!repo) return;
    
    setLoading(true);
    try {
      const result = await api.getIndexedBranches(repo.full_name);
      if (result.success) {
        setIndexedBranches(result.branches);
      }
    } catch (error) {
      console.error('Failed to load indexed branches:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteBranchIndex = async (branch: string) => {
    if (!confirm(`Are you sure you want to delete the index for branch "${branch}"? This will remove all indexed data for this branch.`)) {
      return;
    }

    setDeletingBranch(branch);
    try {
      const result = await api.deleteBranchIndex(repo.full_name, branch, 'both');
      if (result.success) {
        // Reload the list
        await loadIndexedBranches();
        onBranchDeleted();
      } else {
        alert(`Failed to delete branch index: ${result.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to delete branch index:', error);
      alert('Failed to delete branch index');
    } finally {
      setDeletingBranch(null);
    }
  };

  const formatTimeAgo = (timestamp: number) => {
    if (!timestamp) return 'Never';
    
    const now = Date.now();
    const diff = now - timestamp * 1000; // Convert to milliseconds
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'Just now';
  };

  const formatChunkCount = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 border border-neutral-700 rounded shadow-xl max-w-5xl w-full max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-700 bg-neutral-800">
          <div>
            <h3 className="text-[13px] font-medium text-neutral-100">Manage Branch Indexes</h3>
            <p className="text-[11px] text-neutral-400 mt-0.5">{repo.full_name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-neutral-700 rounded transition-colors"
          >
            <svg className="w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col h-[calc(85vh-120px)]">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-neutral-400">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-gold-600 mr-2"></div>
              <span className="text-[12px]">Loading indexed branches...</span>
            </div>
          ) : indexedBranches.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-[12px] text-neutral-400">No branches have been indexed yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto flex-1">
              <table className="w-full table-fixed">
                <thead className="bg-neutral-800 border-b border-neutral-700 sticky top-0">
                  <tr>
                    <th className="w-48 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Branch
                    </th>
                    <th className="w-20 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="w-16 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Files
                    </th>
                    <th className="w-24 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Gist Chunks
                    </th>
                    <th className="w-28 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Pinpoint Chunks
                    </th>
                    <th className="w-24 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Last Indexed
                    </th>
                    <th className="w-20 px-3 py-2 text-left text-[10px] font-medium text-neutral-300 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {indexedBranches.map((branch) => (
                    <tr key={branch.name} className="hover:bg-neutral-800 transition-colors border-b border-neutral-800">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center space-x-2">
                          <span className="text-neutral-100 font-medium text-[12px] truncate" title={branch.name}>
                            {branch.name}
                          </span>
                          {branch.name === repo.active_branch && (
                            <span className="text-[9px] px-1 py-0.5 bg-brand-gold-600/20 text-brand-gold-400 rounded-sm">
                              Active
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-green-400 text-[11px]">Indexed</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-neutral-300 text-[11px]">{branch.file_count}</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-neutral-300 text-[11px]">
                          {formatChunkCount(branch.gist_chunks)}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-neutral-300 text-[11px]">
                          {formatChunkCount(branch.pinpoint_chunks)}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="text-neutral-400 text-[11px]">
                          {formatTimeAgo(branch.last_indexed)}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          onClick={() => handleDeleteBranchIndex(branch.name)}
                          disabled={deletingBranch === branch.name || branch.name === repo.active_branch}
                          className="px-2 py-1 text-[10px] bg-red-600/20 text-red-400 hover:bg-red-600/30 hover:text-red-300 rounded-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed border border-red-600/30"
                          title={branch.name === repo.active_branch ? "Cannot delete active branch index" : "Delete branch index"}
                        >
                          {deletingBranch === branch.name ? (
                            <div className="flex items-center space-x-1">
                              <div className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin"></div>
                              <span>Deleting...</span>
                            </div>
                          ) : (
                            'Delete'
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-neutral-700 bg-neutral-800">
          <div className="text-[10px] text-neutral-400">
            Total chunks: {indexedBranches.reduce((sum, b) => sum + b.total_chunks, 0).toLocaleString()}
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[11px] bg-neutral-700 hover:bg-neutral-600 text-neutral-200 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default BranchManager;