import React, { useState } from 'react';
import LoadingState from './LoadingState';

interface BranchSyncModalProps {
  isOpen: boolean;
  repo: string;
  branch: string;
  changes: {
    added: string[];
    modified: string[];
    removed: string[];
  };
  totalChanges: number;
  onSync: (repo: string, branch: string) => void;
  onSkip: () => void;
  onClose: () => void;
}

const BranchSyncModal: React.FC<BranchSyncModalProps> = ({
  isOpen,
  repo,
  branch,
  changes,
  totalChanges,
  onSync,
  onSkip,
  onClose
}) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  if (!isOpen) return null;

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await onSync(repo, branch);
      onClose();
    } catch (error) {
      console.error('Sync failed:', error);
      setIsSyncing(false);
    }
  };

  const handleSkip = () => {
    onSkip();
    onClose();
  };

  // Limit file lists for display
  const maxFilesToShow = 10;
  const addedToShow = changes.added.slice(0, maxFilesToShow);
  const modifiedToShow = changes.modified.slice(0, maxFilesToShow);
  const removedToShow = changes.removed.slice(0, maxFilesToShow);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-semibold text-neutral-100">Branch Changes Detected</h2>
            <p className="text-sm text-neutral-400 mt-1">
              {repo} • {branch}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-200 transition-colors"
            disabled={isSyncing}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-6">
          <p className="text-neutral-300 mb-4">
            The following changes were detected since this branch was last indexed:
          </p>
          
          <div className="bg-neutral-800 border border-neutral-700 rounded p-4 space-y-3">
            {changes.added.length > 0 && (
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-green-900 rounded flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <div className="flex-1">
                  <span className="text-green-400 font-medium">{changes.added.length} files added</span>
                </div>
              </div>
            )}
            
            {changes.modified.length > 0 && (
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-brand-gold-900 rounded flex items-center justify-center">
                  <svg className="w-4 h-4 text-brand-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <span className="text-brand-gold-400 font-medium">{changes.modified.length} files modified</span>
                </div>
              </div>
            )}
            
            {changes.removed.length > 0 && (
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-red-900 rounded flex items-center justify-center">
                  <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div className="flex-1">
                  <span className="text-red-400 font-medium">{changes.removed.length} files removed</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Detailed file list (collapsible) */}
        {totalChanges > 0 && (
          <div className="mb-6">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-sm text-neutral-400 hover:text-neutral-200 transition-colors flex items-center space-x-1"
            >
              <svg 
                className={`w-3 h-3 transform transition-transform ${showDetails ? 'rotate-90' : ''}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span>{showDetails ? 'Hide' : 'Show'} file details</span>
            </button>
            
            {showDetails && (
              <div className="mt-3 max-h-48 overflow-y-auto bg-neutral-800 border border-neutral-700 rounded p-3 text-xs">
                {changes.added.length > 0 && (
                  <div className="mb-3">
                    <div className="text-green-400 font-medium mb-1">Added:</div>
                    <ul className="space-y-0.5">
                      {addedToShow.map((file, idx) => (
                        <li key={idx} className="text-neutral-400 pl-3">+ {file}</li>
                      ))}
                      {changes.added.length > maxFilesToShow && (
                        <li className="text-neutral-500 pl-3 italic">
                          ...and {changes.added.length - maxFilesToShow} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}
                
                {changes.modified.length > 0 && (
                  <div className="mb-3">
                    <div className="text-brand-gold-400 font-medium mb-1">Modified:</div>
                    <ul className="space-y-0.5">
                      {modifiedToShow.map((file, idx) => (
                        <li key={idx} className="text-neutral-400 pl-3">~ {file}</li>
                      ))}
                      {changes.modified.length > maxFilesToShow && (
                        <li className="text-neutral-500 pl-3 italic">
                          ...and {changes.modified.length - maxFilesToShow} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}
                
                {changes.removed.length > 0 && (
                  <div>
                    <div className="text-red-400 font-medium mb-1">Removed:</div>
                    <ul className="space-y-0.5">
                      {removedToShow.map((file, idx) => (
                        <li key={idx} className="text-neutral-400 pl-3">- {file}</li>
                      ))}
                      {changes.removed.length > maxFilesToShow && (
                        <li className="text-neutral-500 pl-3 italic">
                          ...and {changes.removed.length - maxFilesToShow} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end space-x-3">
          <button
            onClick={handleSkip}
            disabled={isSyncing}
            className="px-4 py-2 text-neutral-300 bg-neutral-800 border border-neutral-700 rounded hover:bg-neutral-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Skip for Now
          </button>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="px-4 py-2 bg-brand-gold-600 text-white rounded hover:bg-brand-gold-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {isSyncing ? (
              <LoadingState 
                variant="inline" 
                size="sm" 
                spinnerVariant="white" 
                message="Syncing..." 
              />
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Sync Changes</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BranchSyncModal;