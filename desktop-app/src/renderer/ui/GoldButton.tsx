import React from 'react';

interface GoldButtonProps {
  variant?: 'solid' | 'ghost' | 'chip';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
}

const GoldButton: React.FC<GoldButtonProps> = ({
  variant = 'solid',
  size = 'md',
  children,
  onClick,
  disabled = false,
  className = '',
  type = 'button',
  title
}) => {
  const baseClasses = 'gold-button transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 focus-visible:ring-offset-brand-coal';
  
  const variantClasses = {
    solid: 'gold-button--solid',
    ghost: 'gold-button--ghost',
    chip: 'gold-button--chip'
  };

  const sizeClasses = {
    sm: 'px-2.5 py-1.5 text-[12px]',
    md: 'px-3.5 py-2 text-[13px]',
    lg: 'px-5 py-2.5 text-sm'
  };

  const disabledClasses = disabled ? 'opacity-50 cursor-not-allowed' : '';

  const classes = `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${disabledClasses} ${className}`;

  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
};

export default GoldButton;
