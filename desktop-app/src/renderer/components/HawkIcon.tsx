import React from 'react';
import { useTheme } from '../ui/ThemeProvider';

interface HawkIconProps {
  className?: string;
  size?: number;
}

const HawkIcon: React.FC<HawkIconProps> = ({ className = '', size = 24 }) => {
  const { theme } = useTheme();
  const src = theme === 'light' ? './assets/hawkburgundy.png' : './assets/hawk.png';
  return (
    <img
      src={src}
      alt="Hawk"
      width={size}
      height={size}
      className={className}
      onError={(e) => {
        if (e.currentTarget.src.indexOf('hawk.png') === -1) {
          e.currentTarget.src = './assets/hawk.png';
        }
      }}
    />
  );
};

export default HawkIcon;
