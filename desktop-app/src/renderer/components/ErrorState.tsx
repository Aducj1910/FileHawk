import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import GoldButton from '../ui/GoldButton';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

const ErrorState: React.FC<ErrorStateProps> = ({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  className = ""
}) => {
  return (
    <div className={`soft-card ${className}`}>
      <div className="p-6 text-center">
        <AlertTriangle 
          size={24} 
          className="mx-auto mb-3 opacity-60" 
          style={{ color: 'var(--fg-muted)' }}
        />
        <h3 className="text-base font-medium mb-2" style={{ color: 'var(--fg-primary)' }}>
          {title}
        </h3>
        <p className="text-[12px] mb-4 leading-relaxed" style={{ color: 'var(--fg-muted)' }}>
          {message}
        </p>
        {onRetry && (
          <GoldButton
            variant="ghost"
            size="sm"
            onClick={onRetry}
            className="inline-flex items-center space-x-2"
          >
            <RefreshCw size={14} />
            <span>{retryLabel}</span>
          </GoldButton>
        )}
      </div>
    </div>
  );
};

export default ErrorState;