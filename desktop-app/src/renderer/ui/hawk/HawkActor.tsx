import React from 'react';

type HawkMood = 'idle' | 'loading' | 'search' | 'success' | 'error';

interface HawkActorProps {
  mood: HawkMood;
  className?: string;
  size?: number;
}

const HawkActor: React.FC<HawkActorProps> = ({ 
  mood, 
  className = '', 
  size = 24 
}) => {
  const getMoodStyles = (mood: HawkMood) => {
    switch (mood) {
      case 'idle':
        return {
          animation: 'hawk-hover 4s ease-in-out infinite',
          opacity: 0.8
        };
      case 'loading':
        return {
          animation: 'hawk-fly 2s ease-in-out infinite',
          opacity: 1
        };
      case 'search':
        return {
          animation: 'hawk-fly 1s ease-in-out',
          opacity: 1
        };
      case 'success':
        return {
          animation: 'gold-pulse 0.8s ease-in-out',
          opacity: 1
        };
      case 'error':
        return {
          animation: 'hawk-shake 0.6s ease-in-out',
          opacity: 0.6
        };
      default:
        return {
          animation: '',
          opacity: 1
        };
    }
  };

  const moodStyles = getMoodStyles(mood);

  return (
    <div 
      className={`hawk-actor ${className}`}
      style={{
        animation: moodStyles.animation,
        opacity: moodStyles.opacity
      }}
    />
  );
};

export default HawkActor;
