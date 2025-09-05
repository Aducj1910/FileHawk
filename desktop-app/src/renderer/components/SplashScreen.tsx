import React from 'react';
import { useTheme } from '../ui/ThemeProvider';

interface SplashScreenProps {
  message?: string;
  subMessage?: string;
}

const SplashScreen: React.FC<SplashScreenProps> = ({ message, subMessage }) => {
  const { theme } = useTheme();
  const hawk = theme === 'light' ? './assets/hawkburgundy.png' : './assets/hawk.png';
  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-onyx text-neutral-200">
      <div className="text-center">
        <div className="mx-auto mb-4 w-32 h-32 relative flex items-center justify-center">
          <img
            src={hawk}
            alt="Hawk"
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 w-16 h-16 select-none"
            onError={(e) => {
              if (e.currentTarget.src.indexOf('hawk.png') === -1) {
                e.currentTarget.src = './assets/hawk.png';
              }
            }}
          />
          <div className={`absolute inset-5 rounded-full border-2 animate-spin ${
            theme === 'light'
              ? 'border-red-300/40 border-t-red-600'
              : 'border-brand-gold-700/40 border-t-brand-gold-300'
          }`} />
        </div>
        <h1 className="text-lg font-semibold mb-1">{message || 'FileHawk'}</h1>
        <p className="text-sm text-neutral-500">{subMessage || 'Initializing…'}</p>
      </div>
    </div>
  );
};

export default SplashScreen;


