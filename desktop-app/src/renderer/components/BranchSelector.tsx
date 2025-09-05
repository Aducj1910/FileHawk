import React, { useState, useRef, useEffect } from 'react';

interface Branch {
  name: string;
  is_default?: boolean;
}

interface BranchSelectorProps {
  currentBranch: string;
  branches: Branch[];
  onBranchChange: (branchName: string) => void;
  disabled?: boolean;
  className?: string;
}

const BranchSelector: React.FC<BranchSelectorProps> = ({
  currentBranch,
  branches,
  onBranchChange,
  disabled = false,
  className = ''
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [width, setWidth] = useState(() => {
    const savedWidth = localStorage.getItem('branchSelectorWidth');
    return savedWidth ? parseInt(savedWidth, 10) : 128;
  });
  const [isResizing, setIsResizing] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const MIN_WIDTH = 80;
  const MAX_WIDTH = 300;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    localStorage.setItem('branchSelectorWidth', width.toString());
  }, [width]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      
      const deltaX = startX - e.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + deltaX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    };

    if (isResizing) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, startX, startWidth]);

  const handleBranchSelect = async (branchName: string) => {
    if (branchName === currentBranch || isLoading) return;
    
    setIsLoading(true);
    setIsOpen(false);
    
    try {
      await onBranchChange(branchName);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    setStartX(e.clientX);
    setStartWidth(width);
  };

  const GitBranchIcon = () => (
    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 16 16">
      <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.5 2.5 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z"/>
    </svg>
  );

  const ChevronDownIcon = () => (
    <svg className="w-3 h-3 transition-transform duration-150" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );

  const LoadingSpinner = () => (
    <div className="w-3 h-3 border border-neutral-400 border-t-transparent rounded-full animate-spin" />
  );

  return (
    <div className={`relative ${className}`} ref={dropdownRef} style={{ width: `${width}px` }}>
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize group z-10"
        onMouseDown={handleResizeStart}
      >
        <div className="w-full h-full group-hover:bg-neutral-600 transition-colors duration-150 flex items-center justify-center">
          <div className="w-0.5 h-4 bg-neutral-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
        </div>
      </div>

      <button
        ref={buttonRef}
        onClick={() => !disabled && !isLoading && setIsOpen(!isOpen)}
        disabled={disabled || isLoading}
        className={`
          flex items-center justify-between w-full px-2.5 py-1.5 ml-1
          bg-neutral-800 border border-neutral-700 text-neutral-200 
          hover:bg-neutral-750 hover:border-neutral-600 
          focus:outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-600
          transition-all duration-150 text-[12px] font-medium
          disabled:opacity-50 disabled:cursor-not-allowed
          ${isOpen ? 'border-neutral-600 bg-neutral-750' : ''}
        `}
        style={{ borderRadius: '0.25rem' }}
      >
        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
          <GitBranchIcon />
          <span className="truncate font-mono text-[11px]">
            {currentBranch}
          </span>
        </div>
        <div className="flex items-center ml-2">
          {isLoading ? <LoadingSpinner /> : <ChevronDownIcon />}
        </div>
      </button>

      {isOpen && !disabled && (
        <div 
          className="absolute z-50 mt-1 ml-1 bg-neutral-900 border border-neutral-700 shadow-lg max-h-60 overflow-y-auto"
          style={{ borderRadius: '0.25rem', width: `${width - 4}px` }}
        >
          <div className="py-1">
            {branches.map((branch) => {
              const isCurrentBranch = branch.name === currentBranch;
              const isDefault = branch.is_default;
              
              return (
                <button
                  key={branch.name}
                  onClick={() => handleBranchSelect(branch.name)}
                  disabled={isCurrentBranch}
                  className={`
                    w-full px-3 py-2 text-left text-[12px] flex items-center justify-between
                    transition-colors duration-150
                    ${isCurrentBranch 
                      ? 'bg-neutral-800 text-neutral-100 cursor-default' 
                      : 'text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100 cursor-pointer'
                    }
                  `}
                >
                  <div className="flex items-center space-x-2 min-w-0 flex-1">
                    <GitBranchIcon />
                    <span className="truncate font-mono text-[11px]">
                      {branch.name}
                    </span>
                    {isDefault && (
                      <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-medium bg-brand-gold-600/20 text-brand-gold-400 border border-brand-gold-600/30"
                            style={{ borderRadius: '0.25rem' }}>
                        default
                      </span>
                    )}
                  </div>
                  {isCurrentBranch && (
                    <svg className="w-3 h-3 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              );
            })}
            
            {branches.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-neutral-500">
                No branches available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BranchSelector;