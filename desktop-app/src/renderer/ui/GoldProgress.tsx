import React from 'react';

interface GoldProgressProps {
  value: number; // 0-100
  max?: number;
  className?: string;
  showLabel?: boolean;
  label?: string;
}

const GoldProgress: React.FC<GoldProgressProps> = ({
  value,
  max = 100,
  className = '',
  showLabel = false,
  label
}) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div className={`gold-progress ${className}`}>
      <div 
        className="gold-progress__bar"
        style={{ width: `${percentage}%` }}
      />
      {showLabel && (
        <div className="flex justify-between text-xs font-medium mt-2">
          <span className="text-neutral-300">{label || 'Progress'}</span>
          <span className="text-brand-gold-500">{Math.round(percentage)}%</span>
        </div>
      )}
    </div>
  );
};

export default GoldProgress;
