import React, { useState, useEffect } from 'react';
import HawkIcon from './HawkIcon';
import { useTheme } from '../ui/ThemeProvider';

interface SidebarProps {
  currentRoute: 'home' | 'settings' | 'track-files' | 'saved' | 'github';
  onRouteChange: (route: 'home' | 'settings' | 'track-files' | 'saved' | 'github') => void;
}

const Sidebar: React.FC<SidebarProps> = ({ currentRoute, onRouteChange }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { theme, setTheme } = useTheme();

  // Load collapsed state from localStorage on mount
  useEffect(() => {
    const savedState = localStorage.getItem('filehawk-sidebar-collapsed');
    if (savedState !== null) {
      setIsCollapsed(JSON.parse(savedState));
    }
  }, []);

  // Save collapsed state to localStorage when it changes
  const handleToggleCollapse = () => {
    const newState = !isCollapsed;
    setIsCollapsed(newState);
    localStorage.setItem('filehawk-sidebar-collapsed', JSON.stringify(newState));
  };

  const navItems = [
    {
      id: 'home',
      label: 'Home',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      )
    },
    {
      id: 'saved',
      label: 'Saved',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5v16l7-5 7 5V5a2 2 0 00-2-2H7a2 2 0 00-2 2z" />
        </svg>
      )
    },
    {
      id: 'track-files',
      label: 'Track Files',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      )
    },
    {
      id: 'github',
      label: 'GitHub',
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      )
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a2 2 0 11-6 0 2 2 0 016 0z" />
        </svg>
      )
    }
  ];

  return (
    <div 
      className={`h-full bg-brand-coal border-brand-border border-r transition-all duration-300 ease-in-out flex-shrink-0 relative flex flex-col ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Header */}
      <div className="p-3 border-b border-brand-border">
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3'}`}>
          <button
            onClick={handleToggleCollapse}
            className="flex-shrink-0 hover:opacity-80 transition-opacity duration-200"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <HawkIcon size={isCollapsed ? 32 : 28} className="flex-shrink-0" />
          </button>
          {!isCollapsed && (
            <div className="flex flex-col">
              <h2 className="text-base font-semibold text-neutral-100">FileHawk</h2>
              <span className="text-[11px] text-neutral-500">Navigation</span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Items */}
      <nav className="p-2 space-y-1 flex-1 overflow-y-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onRouteChange(item.id as any)}
            className={`w-full flex items-center px-2.5 py-2.5 rounded-sm transition-colors duration-150 group ${
              currentRoute === item.id
                ? 'bg-neutral-800 border border-neutral-700 text-neutral-100'
                : 'text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100'
            } ${isCollapsed ? 'justify-center' : 'space-x-3'}`}
            aria-label={isCollapsed ? item.label : undefined}
            title={isCollapsed ? item.label : undefined}
          >
            <div className={`flex-shrink-0 ${currentRoute === item.id ? 'text-neutral-200' : 'text-neutral-400 group-hover:text-neutral-300'}`}>
              {item.icon}
            </div>
            {!isCollapsed && (
              <span className="text-[13px] font-medium">{item.label}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Theme Toggle - Fixed at bottom */}
      <div className="flex-shrink-0 p-2 border-t border-brand-border">
        {isCollapsed ? (
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="w-full flex items-center justify-center px-2.5 py-2 rounded-sm bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-neutral-100 transition-colors duration-150"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title="Appearance"
          >
            {theme === 'dark' ? (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5" />
                <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
              </svg>
            )}
          </button>
        ) : (
          <div>
            <div className="text-[11px] text-neutral-500 mb-1">Appearance</div>
            <div className="relative">
              <div className="relative h-8 bg-neutral-900 border border-neutral-700 rounded-full p-0.5 overflow-hidden">
                <div
                  className={`absolute top-0.5 bottom-0.5 w-1/2 rounded-full bg-neutral-800 border border-neutral-700 transition-transform duration-200 ease-in-out ${
                    theme === 'dark' ? 'translate-x-0' : 'translate-x-full'
                  }`}
                  aria-hidden="true"
                />
                <div className="grid grid-cols-2 h-full relative">
                  <button
                    type="button"
                    onClick={() => setTheme('dark')}
                    className={`flex items-center justify-center space-x-1.5 text-[12px] font-medium rounded-full transition-colors duration-150 ${
                      theme === 'dark' ? 'text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                    aria-pressed={theme === 'dark'}
                    aria-label="Use dark theme"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                    </svg>
                    <span>Dark</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTheme('light')}
                    className={`flex items-center justify-center space-x-1.5 text-[12px] font-medium rounded-full transition-colors duration-150 ${
                      theme === 'light' ? 'text-neutral-100' : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                    aria-pressed={theme === 'light'}
                    aria-label="Use light theme"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="5" />
                      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                    </svg>
                    <span>Light</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Collapse Button - Fixed at very bottom */}
      <div className="flex-shrink-0 p-2">
        <button
          onClick={handleToggleCollapse}
          className={`w-full flex items-center justify-center px-2.5 py-2 rounded-sm bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200 transition-colors duration-150 ${
            isCollapsed ? 'justify-center' : 'space-x-2'
          }`}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg 
            className={`w-4 h-4 transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {!isCollapsed && (
            <span className="text-[12px] font-medium">Collapse</span>
          )}
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
