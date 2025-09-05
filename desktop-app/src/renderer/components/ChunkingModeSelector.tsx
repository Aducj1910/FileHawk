import React, { useState } from 'react';
import { ChunkingMode, ChunkingModeInfo } from '../types';
import { BookOpen, Target } from 'lucide-react';

interface ChunkingModeSelectorProps {
  selectedMode: ChunkingMode;
  onModeChange: (mode: ChunkingMode) => void;
  darkMode: boolean;
  disabled?: boolean;
}

const ChunkingModeSelector: React.FC<ChunkingModeSelectorProps> = ({
  selectedMode,
  onModeChange,
  darkMode,
  disabled = false
}) => {
  const [showInfo, setShowInfo] = useState(false);
  
  const modes: Array<ChunkingModeInfo & { iconNode: React.ReactNode }> = [
    {
      mode: 'gist',
      name: 'Gist',
      description: 'Topic-level chunks (~35 lines)',
      chunkSize: 35,
      icon: '',
      iconNode: <BookOpen size={14} strokeWidth={1.75} />
    },
    {
      mode: 'pinpoint',
      name: 'Pinpoint',
      description: 'Line-level chunks (~3 lines)',
      chunkSize: 3,
      icon: '',
      iconNode: <Target size={14} strokeWidth={1.75} />
    }
  ];

  const selectedModeInfo = modes.find(m => m.mode === selectedMode);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-medium text-neutral-300">Chunking mode</span>
        </div>
        
        {/* Info Icon */}
        <div className="relative">
          <button
            onMouseEnter={() => setShowInfo(true)}
            onMouseLeave={() => setShowInfo(false)}
            className="w-5 h-5 rounded-sm bg-neutral-700 hover:bg-neutral-600 flex items-center justify-center transition-colors duration-150"
            disabled={disabled}
          >
            <svg className="w-3 h-3 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
          
          {/* Info Tooltip */}
          {showInfo && (
            <div className="absolute right-0 top-8 w-72 bg-neutral-900 border border-neutral-700 rounded-md p-2.5 shadow-subtle z-10">
              <div className="space-y-2">
                {modes.map((mode) => (
                  <div key={mode.mode} className="flex items-start space-x-2">
                    <div className="text-neutral-300 mt-0.5">{mode.iconNode}</div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-0.5">
                        <span className="font-medium text-neutral-200 text-sm">{mode.name}</span>
                        <span className="px-1.5 py-0 text-[11px] bg-neutral-800 text-neutral-300 rounded-sm border border-neutral-700">
                          ~{mode.chunkSize} lines
                        </span>
                      </div>
                      <p className="text-[11px] leading-5 text-neutral-400">{mode.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Toggle Style Mode Selector */}
      <div className="relative bg-neutral-900 rounded-sm p-0.5 border border-neutral-700">
        <div 
          className="absolute inset-0.5 bg-neutral-800 border border-neutral-700 rounded-[3px] transition-all duration-200 ease-out"
          style={{
            left: selectedMode === 'gist' ? '2px' : 'calc(50% + 1px)',
            width: 'calc(50% - 3px)'
          }}
        />
        <div className="relative flex">
          {modes.map((mode) => (
            <button
              key={mode.mode}
              onClick={() => onModeChange(mode.mode)}
              disabled={disabled}
              className={`
                relative flex-1 flex items-center justify-center space-x-2 py-1.5 px-2 rounded-[3px] transition-all duration-150 ease-out
                ${selectedMode === mode.mode ? 'text-brand-gold-300 border border-brand-gold-500/40' : 'text-neutral-400 hover:text-neutral-200'}
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <span className="text-neutral-300">{mode.iconNode}</span>
              <span className="text-[12px] font-medium">{mode.name}</span>
            </button>
          ))}
        </div>
      </div>
      
      {/* Current Mode Info */}
      {selectedModeInfo && (
        <div className="text-[11px] text-neutral-500 text-center leading-5">
          {selectedModeInfo.description}
        </div>
      )}
    </div>
  );
};

export default ChunkingModeSelector;
