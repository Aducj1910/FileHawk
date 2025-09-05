import { useState, useCallback, useEffect } from 'react';

export type HawkMood = 'idle' | 'loading' | 'search' | 'success' | 'error';

interface UseHawkReturn {
  mood: HawkMood;
  setHawkMood: (mood: HawkMood) => void;
  setHawkMoodWithTimeout: (mood: HawkMood, timeoutMs?: number) => void;
}

export const useHawk = (): UseHawkReturn => {
  const [mood, setMood] = useState<HawkMood>('idle');

  const setHawkMood = useCallback((newMood: HawkMood) => {
    setMood(newMood);
  }, []);

  const setHawkMoodWithTimeout = useCallback((newMood: HawkMood, timeoutMs: number = 1200) => {
    setMood(newMood);
    
    // Auto-return to idle after timeout
    const timer = setTimeout(() => {
      setMood('idle');
    }, timeoutMs);

    return () => clearTimeout(timer);
  }, []);

  // Auto-clear error mood after 1.2s
  useEffect(() => {
    if (mood === 'error') {
      const timer = setTimeout(() => {
        setMood('idle');
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [mood]);

  return {
    mood,
    setHawkMood,
    setHawkMoodWithTimeout
  };
};
