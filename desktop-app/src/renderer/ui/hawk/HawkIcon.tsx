import React from 'react';

interface HawkIconProps {
  className?: string;
  size?: number;
  fill?: string;
  stroke?: string;
}

const HawkIcon: React.FC<HawkIconProps> = ({ 
  className = '', 
  size = 24, 
  fill = '#e7b650',
  stroke = '#d39a25'
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Hawk body */}
      <path
        d="M12 2C8.5 2 6 4.5 6 8c0 2 1 3.5 2 4.5L8 16l4-2 4 2-1-3.5c1-1 2-2.5 2-4.5 0-3.5-2.5-6-6-6z"
        fill={fill}
        stroke={stroke}
        strokeWidth="0.5"
        filter="drop-shadow(0 0 2px rgba(247, 223, 168, 0.3))"
      />
      
      {/* Hawk wings */}
      <path
        d="M7 9c-1 0-2 1-2 2s1 2 2 2 2-1 2-2-1-2-2-2z"
        fill={fill}
        stroke={stroke}
        strokeWidth="0.3"
      />
      <path
        d="M17 9c1 0 2 1 2 2s-1 2-2 2-2-1-2-2 1-2 2-2z"
        fill={fill}
        stroke={stroke}
        strokeWidth="0.3"
      />
      
      {/* Hawk head */}
      <circle
        cx="12"
        cy="6"
        r="1.5"
        fill={fill}
        stroke={stroke}
        strokeWidth="0.3"
      />
      
      {/* Hawk beak */}
      <path
        d="M12 4.5l1 1.5h-2l1-1.5z"
        fill="#946300"
        stroke="#7a5200"
        strokeWidth="0.2"
      />
      
      {/* Hawk eye */}
      <circle
        cx="12.5"
        cy="5.5"
        r="0.3"
        fill="#0b0e12"
      />
      
      {/* Hawk talons */}
      <path
        d="M10 16l1 1.5M12 16l1 1.5M14 16l1 1.5"
        stroke="#946300"
        strokeWidth="0.5"
        strokeLinecap="round"
      />
    </svg>
  );
};

export default HawkIcon;
