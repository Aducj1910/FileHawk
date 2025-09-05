import React, { useEffect, useState } from 'react';
import { IndexingStatusProps, ChunkingMode, MetadataStats } from '../types';
import { useHawkContext } from '../ui/hawk';
import GoldButton from '../ui/GoldButton';
import GoldProgress from '../ui/GoldProgress';
import LoadingSpinner from './LoadingSpinner';
import { api } from '../utils/api';

const IndexingStatus: React.FC<IndexingStatusProps> = ({ status, onSelectFolders, darkMode, currentChunkingMode }) => {
  const { setHawkMood } = useHawkContext();
  const [metadataStats, setMetadataStats] = useState<MetadataStats | null>(null);
  const [syncStatus, setSyncStatus] = useState<{
    needs_sync: boolean;
    total_changes: number;
    folders_affected: number;
    checking: boolean;
    monitor_running: boolean;
  }>({
    needs_sync: false,
    total_changes: 0,
    folders_affected: 0,
    checking: false,
    monitor_running: false
  });

  // Initialize data and check sync status on component mount
  useEffect(() => {
    const initializeData = async () => {
      try {
        const stats = await api.getMetadataStats();
        setMetadataStats(stats);
        
        // Force a startup scan to detect changes that happened while app was closed
        if (stats && stats.total_files > 0) {
          console.log('🔍 Performing startup sync scan...');
          await performStartupSyncScan();
          
          // Double-check sync status after a longer delay to ensure all deletions are detected
          setTimeout(async () => {
            console.log('🔍 Double-checking startup sync status...');
            await checkSyncStatus();
          }, 3000);
        }
        
        // Check if monitoring is running
        await checkMonitoringStatus();
      } catch (error) {
        console.error('Failed to initialize data:', error);
      }
    };

    initializeData();
  }, []);

  // Setup periodic sync status checking in separate effect
  useEffect(() => {
    console.log(`🔄 Setting up sync interval for ${currentChunkingMode}`);
    const syncInterval = setInterval(() => {
      console.log(`🔄 Interval tick for ${currentChunkingMode}`);
      checkSyncStatus();
    }, 2000);
    
    return () => {
      console.log(`🔄 Cleaning up sync interval for ${currentChunkingMode}`);
      clearInterval(syncInterval);
    };
  }, [currentChunkingMode]); // Re-setup when mode changes

  // Refresh metadata stats when indexing completes
  useEffect(() => {
    if (!status.is_indexing && status.message.includes('complete')) {
      const refreshStats = async () => {
        try {
          const stats = await api.getMetadataStats();
          setMetadataStats(stats);
        } catch (error) {
          console.error('Failed to refresh metadata stats:', error);
        }
      };
      
      // Small delay to ensure backend has finished updating
      setTimeout(refreshStats, 1000);
    }
  }, [status.is_indexing, status.message]);

  // Check sync status when chunking mode changes
  useEffect(() => {
    if (metadataStats && metadataStats.total_files > 0) {
      checkSyncStatus();
    }
  }, [currentChunkingMode]);

  // Check if sync monitoring is running
  const checkMonitoringStatus = async () => {
    try {
      const status = await api.getMonitorStatus();
      if (status.success) {
        setSyncStatus(prev => ({ ...prev, monitor_running: status.is_running }));
      }
    } catch (error) {
      console.error('Failed to check monitoring status:', error);
    }
  };

  const checkSyncStatus = async () => {
    try {
      console.log(`⏰ CHECKING SYNC STATUS for ${currentChunkingMode} at ${new Date().toLocaleTimeString()}`);
      
      // Don't set checking: true for background polls - only show loading when user actually clicks sync
      const result = await api.getSyncStatus(currentChunkingMode);
      console.log(`📊 API Result:`, result);
      
      if (result.success) {
        console.log(`📈 UPDATING UI: needs_sync=${result.needs_sync}, total_changes=${result.total_changes}`);
        
        // Only update state if values actually changed to prevent flickering
        setSyncStatus(prev => {
          const needsSync = result.needs_sync || false;
          const totalChanges = result.total_changes || 0;
          const foldersAffected = result.folders_affected || 0;
          
          // Check if any values actually changed
          if (prev.needs_sync !== needsSync || 
              prev.total_changes !== totalChanges || 
              prev.folders_affected !== foldersAffected) {
            
            console.log(`🔄 State changed - updating UI`);
            return {
              ...prev,
              needs_sync: needsSync,
              total_changes: totalChanges,
              folders_affected: foldersAffected
              // Don't touch checking status for background polls
            };
          } else {
            // No change needed, don't update anything
            console.log(`✅ No state change needed`);
            return prev;
          }
        });
        
        if (result.needs_sync) {
          console.log(`🔥 ${result.total_changes} files need syncing in ${currentChunkingMode} mode!`);
        } else {
          console.log(`✅ No sync needed for ${currentChunkingMode} mode`);
        }
      } else {
        console.log(`❌ API Error:`, result.error);
      }
    } catch (error) {
      console.error('Failed to check sync status:', error);
      // Don't update checking status for background polls
    }
  };

  const performStartupSyncScan = async () => {
    try {
      console.log('🔍 Starting startup sync scan...');
      
      // Force a comprehensive scan of all indexed folders to detect ANY changes
      // This includes new files, modified files, AND deleted files
      const result = await api.forceMonitorStart();
      
      if (result.success) {
        console.log('startup scan done');
        
        // Give the backend a moment to process all the file system events
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Now check sync status to show any detected changes (including deletions)
        await checkSyncStatus();
        
        console.log('startup sync scan: status updated');
      } else {
        console.error('startup scan failed:', result.error);
      }
    } catch (error) {
      console.error('error during startup scan:', error);
    }
  };

  const handleSync = async () => {
    try {
      const result = await api.executeSync(currentChunkingMode);
      if (result.success) {
        console.log(`Sync started for ${result.files_to_sync || 0} files`);
        // The progress will be shown through the existing indexing status
        // and sync status will be refreshed automatically
      }
    } catch (error) {
      console.error('Failed to start sync:', error);
    }
  };

  const handleCancelIndexing = async () => {
    try {
      const result = await api.cancelIndexing();
      if (result.success) {
        console.log('indexing cancelled');
        // Refresh metadata stats after cancellation
        setTimeout(async () => {
          try {
            const stats = await api.getMetadataStats();
            setMetadataStats(stats);
          } catch (error) {
            console.error('Failed to refresh metadata stats after cancel:', error);
          }
        }, 1000);
      }
    } catch (error) {
      console.error('Failed to cancel indexing:', error);
    }
  };

  // Update hawk mood based on indexing status
  useEffect(() => {
    if (status.is_indexing) {
      setHawkMood('loading');
    } else if (status.message.includes('Error')) {
      setHawkMood('error');
    } else if (status.message.includes('complete')) {
      setHawkMood('success');
    } else {
      setHawkMood('idle');
    }
  }, [status, setHawkMood]);

  const handleSelectFolders = () => {
    onSelectFolders(currentChunkingMode);
  };

  const getStatusChip = () => {
    if (status.is_indexing) return 'chip--warn';
    if (status.message.includes('Error')) return 'chip--error';
    if (status.message.includes('complete')) return 'chip--ok';
    return 'chip--muted';
  };

  const getStatusIcon = () => {
    if (status.is_indexing) {
      return (
        <div className="relative">
          <div className="w-6 h-6 rounded-sm flex items-center justify-center" style={{ backgroundColor: 'rgba(245, 158, 11, 0.2)' }}>
            <LoadingSpinner size="sm" variant="primary" />
          </div>
        </div>
      );
    }
    
    if (status.message.includes('Error')) {
      return (
        <div className="w-6 h-6 rounded-sm flex items-center justify-center" style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: 'var(--fg-primary)' }}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      );
    }
    
    if (status.message.includes('complete')) {
      return (
        <div className="w-6 h-6 rounded-sm flex items-center justify-center" style={{ backgroundColor: 'rgba(34, 197, 94, 0.2)', color: 'var(--fg-primary)' }}>
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
      );
    }
    
    return (
      <div className="w-6 h-6 rounded-sm flex items-center justify-center" style={{ backgroundColor: 'var(--bg-muted)', color: 'var(--fg-secondary)' }}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
    );
  };

  return (
    <div className="soft-card">
      <div className="p-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3 flex-1">
            {getStatusIcon()}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-sm font-semibold text-neutral-200">Indexing</h3>
                <div className="flex space-x-2">
                  {/* Sync Button - only show if there are indexed files */}
                  {metadataStats && metadataStats.total_files > 0 && !status.is_indexing && (
                    <GoldButton
                      variant={syncStatus.needs_sync ? "solid" : "ghost"}
                      size="sm"
                      onClick={handleSync}
                      disabled={status.is_indexing || syncStatus.checking}
                    >
                      {syncStatus.checking ? (
                        <svg className="-ml-1 mr-1.5 h-3 w-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      ) : (
                        <svg className="-ml-1 mr-1.5 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      {syncStatus.checking ? 'Checking…' : (syncStatus.needs_sync ? `Sync (${syncStatus.total_changes})` : 'Sync')}
                    </GoldButton>
                  )}
                  
                  {/* Cancel button when indexing */}
                  {status.is_indexing && (
                    <GoldButton
                      variant="ghost"
                      size="sm"
                      onClick={handleCancelIndexing}
                      className="text-red-500 hover:text-red-400 border-red-500/30 hover:border-red-400/50"
                    >
                      <svg className="-ml-1 mr-1.5 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Cancel
                    </GoldButton>
                  )}
                  
                  {/* Select folders button when not indexing */}
                  {!status.is_indexing && (
                    <GoldButton
                      variant="ghost"
                      size="sm"
                      onClick={handleSelectFolders}
                      disabled={status.is_indexing}
                    >
                      <svg className="-ml-1 mr-1.5 h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      Select folders
                    </GoldButton>
                  )}
                </div>
              </div>
              <div 
                className={`px-2 py-0.5 inline-flex text-[11px] rounded-sm border ${
                  getStatusChip() === 'chip--ok' 
                    ? 'border-emerald-600/50 bg-emerald-500/10' 
                    : getStatusChip() === 'chip--warn' 
                    ? 'border-amber-600/50 bg-amber-500/10' 
                    : getStatusChip() === 'chip--error' 
                    ? 'border-red-600/50 bg-red-500/10' 
                    : 'border-neutral-600/50 bg-neutral-500/10'
                }`}
                style={{
                  color: getStatusChip() === 'chip--ok' 
                    ? 'var(--fg-primary)' 
                    : getStatusChip() === 'chip--warn' 
                    ? 'var(--fg-primary)' 
                    : getStatusChip() === 'chip--error' 
                    ? 'var(--fg-primary)' 
                    : 'var(--fg-secondary)',
                  backgroundColor: getStatusChip() === 'chip--ok' 
                    ? 'rgba(34, 197, 94, 0.15)' 
                    : getStatusChip() === 'chip--warn' 
                    ? 'rgba(245, 158, 11, 0.15)' 
                    : getStatusChip() === 'chip--error' 
                    ? 'rgba(239, 68, 68, 0.15)' 
                    : 'var(--bg-muted)',
                  borderColor: getStatusChip() === 'chip--ok' 
                    ? 'rgba(34, 197, 94, 0.3)' 
                    : getStatusChip() === 'chip--warn' 
                    ? 'rgba(245, 158, 11, 0.3)' 
                    : getStatusChip() === 'chip--error' 
                    ? 'rgba(239, 68, 68, 0.3)' 
                    : 'var(--border-subtle)'
                }}
              >
                {status.message}
              </div>
              
              {/* Show indexed files count for current mode only */}
              {metadataStats && metadataStats.total_files > 0 && (
                <div className="flex items-center space-x-2 mt-2">
                  <div className="w-1 h-1 bg-emerald-500 rounded"></div>
                  <span className="text-[11px] text-neutral-500">{metadataStats.mode_stats[currentChunkingMode]?.files || 0} files indexed in {currentChunkingMode === 'gist' ? 'Gist' : 'Pinpoint'} mode</span>
                </div>
              )}
              
              {/* Show current chunking mode if indexing */}
              {status.is_indexing && status.chunking_mode && (
                <div className="flex items-center space-x-2 mt-2">
                  <div className="w-1 h-1 bg-neutral-600 rounded"></div>
                  <span className="text-[11px] text-neutral-500">Using {status.chunking_mode === 'gist' ? 'Gist' : 'Pinpoint'} mode</span>
                </div>
              )}
              
              {status.current_file && (
                <div className="flex items-center space-x-2 mt-2">
                  <div className="w-1 h-1 bg-neutral-600 rounded"></div>
                  <p className="text-[11px] font-mono text-neutral-500 transition-colors duration-150">{status.current_file}</p>
                </div>
              )}
              {status.is_indexing && status.total_files > 0 && status.indexing_type === 'local' && (
                <div className="flex items-center space-x-2 mt-1">
                  <div className="w-1 h-1 bg-neutral-600 rounded"></div>
                  <p className="text-[11px] text-neutral-500 transition-colors duration-150">{status.progress > 0 ? `${Math.round((status.progress / 100) * status.total_files)} of ${status.total_files}` : `${status.total_files}`} files to process</p>
                </div>
              )}
            </div>
          </div>
        </div>
        
        {/* Chunking Mode Selector - only show when not indexing */}
        {!status.is_indexing && (
          <div className="mt-4 pt-3 border-t border-neutral-800">
            {/* Removed ChunkingModeSelector as per edit hint */}
          </div>
        )}
        
        {status.is_indexing && status.total_files > 0 && status.indexing_type === 'local' && (
          <div className="mt-3">
            <GoldProgress
              value={status.progress}
              showLabel={true}
              label="Progress"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default IndexingStatus; 