import React from 'react';
import LoadingSpinner from './LoadingSpinner';

interface LoadingButtonProps {
  isLoading?: boolean;
  loadingText?: string;
  children: React.ReactNode;
  disabled?: boolean;
  className?: string;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
}

const LoadingButton: React.FC<LoadingButtonProps> = ({
  isLoading = false,
  loadingText,
  children,
  disabled = false,
  className = '',
  variant = 'primary',
  size = 'md',
  onClick,
  type = 'button'
}) => {
  const isDisabled = disabled || isLoading;
  
  // Get spinner variant based on button variant
  const spinnerVariant = variant === 'primary' ? 'white' : 'primary';
  
  // Standardized loading text
  const getLoadingText = () => {
    if (loadingText) return loadingText;
    
    // Infer loading text from button content
    const childText = typeof children === 'string' ? children : '';
    
    if (childText.toLowerCase().includes('search')) return 'Searching...';
    if (childText.toLowerCase().includes('index')) return 'Indexing...';
    if (childText.toLowerCase().includes('clone')) return 'Cloning...';
    if (childText.toLowerCase().includes('sync')) return 'Syncing...';
    if (childText.toLowerCase().includes('connect')) return 'Connecting...';
    
    return 'Loading...';
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`inline-flex items-center justify-center space-x-2 transition-colors ${
        isDisabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
    >
      {isLoading && (
        <LoadingSpinner 
          size="sm" 
          variant={spinnerVariant}
        />
      )}
      <span>
        {isLoading ? getLoadingText() : children}
      </span>
    </button>
  );
};

export default LoadingButton;