import React from 'react';
import LoadingSpinner from './LoadingSpinner';

interface LoadingStateProps {
  message?: string;
  variant?: 'inline' | 'centered' | 'minimal';
  size?: 'sm' | 'md' | 'lg';
  spinnerVariant?: 'primary' | 'secondary' | 'accent' | 'white';
  className?: string;
}

const LoadingState: React.FC<LoadingStateProps> = ({
  message,
  variant = 'centered',
  size = 'md',
  spinnerVariant = 'primary',
  className = ''
}) => {
  // Standardized loading messages
  const getDefaultMessage = () => {
    switch (variant) {
      case 'inline':
        return 'Loading...';
      case 'minimal':
        return undefined;
      default:
        return 'Loading content...';
    }
  };

  const displayMessage = message ?? getDefaultMessage();

  if (variant === 'minimal') {
    return (
      <LoadingSpinner 
        size={size} 
        variant={spinnerVariant} 
        className={className}
      />
    );
  }

  if (variant === 'inline') {
    return (
      <div className={`inline-flex items-center space-x-2 ${className}`}>
        <LoadingSpinner size={size} variant={spinnerVariant} />
        {displayMessage && (
          <span className="text-[12px]" style={{ color: 'var(--fg-secondary)' }}>
            {displayMessage}
          </span>
        )}
      </div>
    );
  }

  // Centered variant (default)
  return (
    <div className={`flex flex-col items-center justify-center py-8 ${className}`}>
      <LoadingSpinner size={size} variant={spinnerVariant} className="mb-3" />
      {displayMessage && (
        <p className="text-[12px]" style={{ color: 'var(--fg-muted)' }}>
          {displayMessage}
        </p>
      )}
    </div>
  );
};

export default LoadingState;