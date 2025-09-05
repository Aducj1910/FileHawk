import React, { createContext, useContext, ReactNode } from 'react';
import { useHawk, HawkMood } from './useHawk';

interface HawkContextType {
  mood: HawkMood;
  setHawkMood: (mood: HawkMood) => void;
  setHawkMoodWithTimeout: (mood: HawkMood, timeoutMs?: number) => void;
}

const HawkContext = createContext<HawkContextType | undefined>(undefined);

interface HawkProviderProps {
  children: ReactNode;
}

export const HawkProvider: React.FC<HawkProviderProps> = ({ children }) => {
  const hawkState = useHawk();

  return (
    <HawkContext.Provider value={hawkState}>
      {children}
    </HawkContext.Provider>
  );
};

export const useHawkContext = (): HawkContextType => {
  const context = useContext(HawkContext);
  if (context === undefined) {
    throw new Error('useHawkContext must be used within a HawkProvider');
  }
  return context;
};
