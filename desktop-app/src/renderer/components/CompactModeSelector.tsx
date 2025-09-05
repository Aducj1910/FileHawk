import React from 'react';
import { ChunkingMode } from '../types';

interface CompactModeSelectorProps {
  selectedMode: ChunkingMode;
  onModeChange: (mode: ChunkingMode) => void;
  disabled?: boolean;
}

const CompactModeSelector: React.FC<CompactModeSelectorProps> = ({
  selectedMode,
  onModeChange,
  disabled = false
}) => {
  return (
    <div className="flex items-center space-x-2">
      <span className="text-[11px] font-medium text-neutral-400">Mode</span>
      <div className="relative bg-neutral-900 rounded-sm p-0.5 border border-neutral-700">
        <div 
          className="absolute inset-0.5 bg-neutral-800 border border-neutral-700 rounded-[3px] transition-all duration-150 ease-out"
          style={{
            left: selectedMode === 'gist' ? '2px' : 'calc(50% + 1px)',
            width: 'calc(50% - 3px)'
          }}
        />
        <div className="relative flex">
          {[
            { mode: 'gist' as ChunkingMode, name: 'Gist', description: '35 lines' },
            { mode: 'pinpoint' as ChunkingMode, name: 'Pinpoint', description: '3 lines' }
          ].map((option) => (
            <button
              key={option.mode}
              onClick={() => onModeChange(option.mode)}
              disabled={disabled}
              className={`
                relative w-20 px-2.5 py-1.5 text-[12px] font-medium rounded-[3px] transition-all duration-150 ease-out
                flex items-center justify-center text-center
                ${selectedMode === option.mode
                  ? 'text-brand-gold-300'
                  : 'text-neutral-400 hover:text-neutral-200'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
              title={`${option.name} Mode: ${option.description}`}
            >
              {option.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CompactModeSelector;
