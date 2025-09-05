import React, { useEffect } from 'react';
import { ModelLoadingOverlayProps } from '../types';
import { useHawkContext } from '../ui/hawk';
import GoldProgress from '../ui/GoldProgress';

const ModelLoadingOverlay: React.FC<ModelLoadingOverlayProps> = ({
  darkMode,
  onLoadingComplete,
  onLoadingError
}) => {
  const { setHawkMood } = useHawkContext();
  const [status, setStatus] = React.useState<{
    message: string;
    progress: number;
  } | null>(null);

  useEffect(() => {
    // Set hawk mood to loading when component mounts
    setHawkMood('loading');

    // Simulate loading progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 15;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        setTimeout(() => {
          onLoadingComplete();
        }, 500);
      }
      
      setStatus({
        message: progress < 30 ? 'Loading embedding model...' :
                progress < 60 ? 'Initializing vector database...' :
                progress < 90 ? 'Setting up search index...' :
                'Finalizing setup...',
        progress
      });
    }, 200);

    return () => clearInterval(interval);
  }, [setHawkMood, onLoadingComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-onyx/95 backdrop-blur-sm">
      <div className="soft-card p-6 max-w-md w-full mx-4">
        <div className="relative mb-4 flex items-center justify-center">
          <div className="w-6 h-6 rounded-full border-2 border-neutral-600 border-t-neutral-300 animate-spin" />
        </div>
        <h2 className="text-base font-semibold mb-1 text-neutral-200">Setting up model</h2>
        <p className="text-sm mb-4 text-neutral-500">{status?.message || 'Initializing…'}</p>
        <div className="w-full mb-2">
          <GoldProgress value={status?.progress || 0} showLabel={true} label="Progress" />
        </div>
      </div>
    </div>
  );
};

export default ModelLoadingOverlay;
