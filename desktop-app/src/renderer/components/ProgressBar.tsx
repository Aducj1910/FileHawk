import React from 'react';
import { ProgressBarProps } from '../types';
import GoldProgress from '../ui/GoldProgress';

const ProgressBar: React.FC<ProgressBarProps> = ({ progress, message, isVisible, darkMode }) => {
  if (!isVisible) {
    return null;
  }

  return (
    <div className="soft-card">
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-medium text-neutral-300">
            {message}
          </span>
          <span className="text-[12px] font-medium text-neutral-400">
            {Math.round(progress)}%
          </span>
        </div>
        
        <GoldProgress
          value={progress}
          showLabel={false}
        />
      </div>
    </div>
  );
};

export default ProgressBar; 