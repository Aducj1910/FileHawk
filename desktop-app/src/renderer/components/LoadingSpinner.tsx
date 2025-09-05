import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'accent' | 'white';
  className?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  variant = 'primary',
  className = ''
}) => {
  const sizeClasses = {
    sm: 'w-3 h-3',
    md: 'w-4 h-4', 
    lg: 'w-6 h-6'
  };

  const getSpinnerStyle = () => {
    const baseStyle = {
      borderWidth: '2px',
      borderStyle: 'solid',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite'
    };

    switch (variant) {
      case 'primary':
        return {
          ...baseStyle,
          borderColor: 'var(--border-subtle)',
          borderTopColor: 'var(--fg-primary)'
        };
      case 'secondary':
        return {
          ...baseStyle,
          borderColor: 'var(--border-subtle)',
          borderTopColor: 'var(--fg-secondary)'
        };
      case 'accent':
        return {
          ...baseStyle,
          borderColor: 'rgba(231, 182, 80, 0.3)',
          borderTopColor: 'var(--accent-solid)'
        };
      case 'white':
        return {
          ...baseStyle,
          borderColor: 'rgba(255, 255, 255, 0.3)',
          borderTopColor: '#ffffff'
        };
      default:
        return baseStyle;
    }
  };

  return (
    <div
      className={`${sizeClasses[size]} ${className}`}
      style={getSpinnerStyle()}
      aria-label="Loading"
      role="status"
    />
  );
};

export default LoadingSpinner;