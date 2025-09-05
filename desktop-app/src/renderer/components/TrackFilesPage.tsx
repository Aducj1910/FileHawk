import React, { useState, useEffect } from 'react';
import { TrackedFile, TrackedFilesResponse } from '../types';
import { api } from '../utils/api';

interface TrackFilesPageProps {
  currentChunkingMode: 'gist' | 'pinpoint';
}

const TrackFilesPage: React.FC<TrackFilesPageProps> = ({ currentChunkingMode }) => {
  const [files, setFiles] = useState<TrackedFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('last_indexed');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [sorting, setSorting] = useState(false);
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 25,
    total_files: 0,
    total_pages: 0,
    has_more: false
  });

  const loadFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const response: TrackedFilesResponse = await api.getTrackedFiles(
        currentChunkingMode,
        currentPage,
        25,
        searchQuery,
        sortBy,
        sortOrder
      );
      setFiles(response.files);
      setPagination(response.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, [currentChunkingMode, currentPage, sortBy, sortOrder]);

  useEffect(() => {
    // Reset to first page when search query changes
    setCurrentPage(1);
    const timeoutId = setTimeout(() => {
      loadFiles();
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  // Add real-time sync status polling
  useEffect(() => {
    const checkSyncStatus = async () => {
      try {
        const result = await api.getSyncStatus(currentChunkingMode);
        if (result.success && result.needs_sync) {
          // If there are pending sync changes, reload the files list to update status
          loadFiles();
        }
      } catch (error) {
        console.error('Error checking sync status:', error);
      }
    };

    // Check sync status every 3 seconds
    const interval = setInterval(checkSyncStatus, 3000);
    
    return () => clearInterval(interval);
  }, [currentChunkingMode]);

  const handleSort = async (field: string) => {
    setSorting(true);
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
    // Small delay to show sorting animation
    setTimeout(() => setSorting(false), 300);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const openFile = (filePath: string) => {
    window.electronAPI.openFile(filePath);
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatTimeAgo = (timestamp: number): string => {
    const now = Date.now() / 1000;
    const diff = now - timestamp;
    
    if (diff < 60) return `${Math.floor(diff)} sec ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hrs ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    if (diff < 2592000) return `${Math.floor(diff / 604800)} weeks ago`;
    if (diff < 31536000) return `${Math.floor(diff / 2592000)} months ago`;
    return `${Math.floor(diff / 31536000)} years ago`;
  };

  const getSortIcon = (field: string) => {
    if (sortBy !== field) return '↕';
    return sortOrder === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="flex-1 p-4 bg-brand-coal text-neutral-100">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-4">
          <h1 className="text-2xl font-display text-brand-gold-300 mb-1">
            Track Files
          </h1>
          <p className="text-sm text-neutral-400">
            Monitor indexed files and their sync status in {currentChunkingMode} mode
          </p>
        </div>

        {/* Search and Controls */}
        <div className="mb-4 flex flex-col sm:flex-row gap-3">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by filename or folder..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand-gold-500 focus:border-transparent text-sm"
            />
          </div>
          
          <div className="flex gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-neutral-100 focus:outline-none focus:ring-2 focus:ring-brand-gold-500 text-sm"
            >
              <option value="last_indexed">Last Indexed</option>
              <option value="file_name">File Name</option>
              <option value="file_size">File Size</option>
              <option value="parent_folder">Folder</option>
              <option value="status">Status</option>
            </select>
            
            <button
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              className="px-3 py-2 bg-neutral-800 border border-neutral-600 rounded text-neutral-100 hover:bg-neutral-700 focus:outline-none focus:ring-2 focus:ring-brand-gold-500 text-sm"
            >
              {sortOrder === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </div>

        {/* Files Table */}
        <div className="bg-neutral-900 rounded border border-neutral-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed">
              <thead className="bg-neutral-800 border-b border-neutral-700">
                <tr>
                  <th className="w-24 px-3 py-2 text-left text-xs font-medium text-neutral-300 uppercase tracking-wider cursor-pointer hover:bg-neutral-700 transition-colors" onClick={() => handleSort('status')}>
                    <div className="flex items-center justify-between">
                      <span>Status</span>
                      <span className={`transition-transform duration-200 ${sorting ? 'scale-110' : ''}`}>
                        {getSortIcon('status')}
                      </span>
                    </div>
                  </th>
                  <th className="w-48 px-3 py-2 text-left text-xs font-medium text-neutral-300 uppercase tracking-wider cursor-pointer hover:bg-neutral-700 transition-colors" onClick={() => handleSort('file_name')}>
                    <div className="flex items-center justify-between">
                      <span>File Name</span>
                      <span className={`transition-transform duration-200 ${sorting ? 'scale-110' : ''}`}>
                        {getSortIcon('file_name')}
                      </span>
                    </div>
                  </th>
                  <th className="w-64 px-3 py-2 text-left text-xs font-medium text-neutral-300 uppercase tracking-wider cursor-pointer hover:bg-neutral-700 transition-colors" onClick={() => handleSort('parent_folder')}>
                    <div className="flex items-center justify-between">
                      <span>Folder</span>
                      <span className={`transition-transform duration-200 ${sorting ? 'scale-110' : ''}`}>
                        {getSortIcon('parent_folder')}
                      </span>
                    </div>
                  </th>
                  <th className="w-20 px-3 py-2 text-left text-xs font-medium text-neutral-300 uppercase tracking-wider cursor-pointer hover:bg-neutral-700 transition-colors" onClick={() => handleSort('file_size')}>
                    <div className="flex items-center justify-between">
                      <span>Size</span>
                      <span className={`transition-transform duration-200 ${sorting ? 'scale-110' : ''}`}>
                        {getSortIcon('file_size')}
                      </span>
                    </div>
                  </th>
                  <th className="w-32 px-3 py-2 text-left text-xs font-medium text-neutral-300 uppercase tracking-wider cursor-pointer hover:bg-neutral-700 transition-colors" onClick={() => handleSort('last_indexed')}>
                    <div className="flex items-center justify-between">
                      <span>Last Indexed</span>
                      <span className={`transition-transform duration-200 ${sorting ? 'scale-110' : ''}`}>
                        {getSortIcon('last_indexed')}
                      </span>
                    </div>
                  </th>
                  <th className="w-16 px-3 py-2 text-left text-xs font-medium text-neutral-300 uppercase tracking-wider">
                    Chunks
                  </th>
                  <th className="w-20 px-3 py-2 text-left text-xs font-medium text-neutral-300 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-700">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-neutral-400">
                      <div className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand-gold-500"></div>
                        <span className="ml-2 text-sm">Loading files...</span>
                      </div>
                    </td>
                  </tr>
                ) : error ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-red-400 text-sm">
                      Error: {error}
                    </td>
                  </tr>
                ) : files.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-neutral-400 text-sm">
                      No files found
                    </td>
                  </tr>
                ) : (
                  files.map((file) => (
                    <tr key={file.file_path} className="hover:bg-neutral-800 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className={`w-2 h-2 rounded-full mr-2 ${
                            file.is_synced ? 'bg-green-500' : 'bg-gray-500'
                          }`}></div>
                          <span className={`text-xs font-medium ${
                            file.is_synced ? 'text-green-400' : 'text-gray-400'
                          }`}>
                            {file.is_synced ? 'Synced' : 'Out of sync'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="text-xs font-medium text-neutral-100 truncate" title={file.file_name}>
                          {file.file_name}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="text-xs text-neutral-400 truncate" title={file.parent_folder}>
                          {file.parent_folder}
                        </div>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-neutral-300">
                        {formatFileSize(file.file_size)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-neutral-300">
                        {formatTimeAgo(file.last_indexed)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-neutral-300 text-center">
                        {file.num_chunks}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          onClick={() => openFile(file.file_path)}
                          className="text-brand-gold-400 hover:text-brand-gold-300 text-xs font-medium hover:underline focus:outline-none focus:ring-1 focus:ring-brand-gold-500 rounded transition-colors"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {pagination.total_pages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-neutral-400">
              Showing {((currentPage - 1) * pagination.page_size) + 1} to {Math.min(currentPage * pagination.page_size, pagination.total_files)} of {pagination.total_files} files
            </div>
            
            <div className="flex items-center space-x-1">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="px-2 py-1 text-xs font-medium text-neutral-300 bg-neutral-800 border border-neutral-600 rounded hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-brand-gold-500 transition-colors"
              >
                Previous
              </button>
              
              <div className="flex items-center space-x-1">
                {Array.from({ length: Math.min(5, pagination.total_pages) }, (_, i) => {
                  let pageNum;
                  if (pagination.total_pages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= pagination.total_pages - 2) {
                    pageNum = pagination.total_pages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }
                  
                  return (
                    <button
                      key={pageNum}
                      onClick={() => handlePageChange(pageNum)}
                      className={`px-2 py-1 text-xs font-medium rounded focus:outline-none focus:ring-1 focus:ring-brand-gold-500 transition-colors ${
                        currentPage === pageNum
                          ? 'bg-brand-gold-600 text-white'
                          : 'text-neutral-300 bg-neutral-800 border border-neutral-600 hover:bg-neutral-700'
                      }`}
                    >
                      {pageNum}
                    </button>
                  );
                })}
              </div>
              
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === pagination.total_pages}
                className="px-2 py-1 text-xs font-medium text-neutral-300 bg-neutral-800 border border-neutral-600 rounded hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-brand-gold-500 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrackFilesPage;
