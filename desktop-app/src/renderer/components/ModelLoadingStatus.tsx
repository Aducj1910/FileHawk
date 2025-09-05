import React, { useEffect, useRef } from 'react';
import { ModelLoadingStatusProps, ModelStatus } from '../types';
import { useHawkContext } from '../ui/hawk';
import LoadingSpinner from './LoadingSpinner';

const ModelLoadingStatus: React.FC<ModelLoadingStatusProps> = ({
  darkMode,
  onLoadingComplete,
  onLoadingError
}) => {
  const { setHawkMood } = useHawkContext();
  const [status, setStatus] = React.useState<ModelStatus | null>(null);
  const hasCompletedRef = useRef(false);

  useEffect(() => {
    // Set hawk mood to loading when component mounts
    setHawkMood('loading');

    // Start polling model status via preload API
    const cleanup = window.electronAPI.onModelStatusUpdate((modelStatus: ModelStatus) => {
      setStatus(modelStatus);
    });

    return cleanup;
  }, [setHawkMood]);

  // React to status updates
  useEffect(() => {
    if (!status) return;

    if (status.error && !hasCompletedRef.current) {
      setHawkMood('error');
      hasCompletedRef.current = true;
      onLoadingError(typeof status.error === 'string' ? status.error : 'Model initialization failed');
      return;
    }

    if (!status.is_loading && !hasCompletedRef.current) {
      setHawkMood('success');
      hasCompletedRef.current = true;
      onLoadingComplete();
    }
  }, [status, onLoadingComplete, onLoadingError, setHawkMood]);

  return (
    <div className="w-full py-1.5 px-4 bg-brand-coal/30 border-b border-brand-border transition-colors duration-150">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <LoadingSpinner size="sm" variant="secondary" />
            <span className="text-[12px] font-medium text-neutral-300">{status?.message || 'Initializing…'}</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-20 h-1 bg-neutral-700 rounded-sm overflow-hidden">
              <div className="h-full bg-neutral-300 transition-all duration-300 ease-out" style={{ width: `${status?.progress || 0}%` }} />
            </div>
            <span className="text-[11px] font-medium text-neutral-400">{Math.round(status?.progress || 0)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelLoadingStatus;
