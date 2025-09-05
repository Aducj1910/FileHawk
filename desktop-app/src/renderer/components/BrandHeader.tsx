import React from 'react';
import { ChunkingMode } from '../types';
import CompactModeSelector from './CompactModeSelector';
import { useTheme } from '../ui/ThemeProvider';

interface BrandHeaderProps {
  selectedMode: ChunkingMode;
  onModeChange: (mode: ChunkingMode) => void;
  disabled?: boolean;
}

const BrandHeader: React.FC<BrandHeaderProps> = ({ selectedMode, onModeChange, disabled = false }) => {
  const { theme } = useTheme();
  
  return (
    <div className="flex items-center space-x-6">
      <div className="flex flex-col items-center space-y-1">
        <div className="flex items-center space-x-2">
          <img 
            src={require(theme === 'dark' ? '../../../public/hawk.png' : '../../../public/hawkburgundy.png')} 
            alt="FileHawk Logo" 
            className="w-8 h-8 object-contain"
          />
          <h1 className="font-display text-3xl tracking-[-0.01em] text-brand-gold-300">
            FileHawk
          </h1>
        </div>
        <span className="uppercase tracking-[.35em] text-brand-gold-600 text-sm font-medium">
          Local Semantic Search
        </span>
      </div>
      <CompactModeSelector
        selectedMode={selectedMode}
        onModeChange={onModeChange}
        disabled={disabled}
      />
    </div>
  );
};

export default BrandHeader;
