import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Search, 
  Home, 
  Settings, 
  FileText, 
  Bookmark, 
  Github,
  Command,
  ArrowRight,
  Clock,
  Hash,
  Folder,
  ChevronRight,
  Cog
} from 'lucide-react';
import { searchSettings, SettingsSearchItem } from '../utils/settingsSearch';

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  action: () => void;
  category: 'navigation' | 'search' | 'recent' | 'files' | 'settings';
  keywords?: string[];
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (route: 'home' | 'settings' | 'track-files' | 'saved' | 'github') => void;
  onSettingsNavigate?: (settingsItem: SettingsSearchItem) => void;
  onSearch?: (query: string) => void;
  recentSearches?: string[];
  currentRoute: string;
}

const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigate,
  onSettingsNavigate,
  onSearch,
  recentSearches = [],
  currentRoute
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset state when palette opens/closes
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Create command list
  const commands = useMemo<Command[]>(() => {
    const navigationCommands: Command[] = [
      {
        id: 'nav-home',
        title: 'Go to Home',
        subtitle: 'Search local files',
        icon: <Home size={16} />,
        action: () => { onNavigate('home'); onClose(); },
        category: 'navigation',
        keywords: ['home', 'search', 'local']
      },
      {
        id: 'nav-github',
        title: 'Go to GitHub',
        subtitle: 'Search GitHub repositories',
        icon: <Github size={16} />,
        action: () => { onNavigate('github'); onClose(); },
        category: 'navigation',
        keywords: ['github', 'repositories', 'repos']
      },
      {
        id: 'nav-track',
        title: 'Go to Track Files',
        subtitle: 'Manage indexed files',
        icon: <FileText size={16} />,
        action: () => { onNavigate('track-files'); onClose(); },
        category: 'navigation',
        keywords: ['track', 'files', 'indexed', 'manage']
      },
      {
        id: 'nav-saved',
        title: 'Go to Saved',
        subtitle: 'View saved searches',
        icon: <Bookmark size={16} />,
        action: () => { onNavigate('saved'); onClose(); },
        category: 'navigation',
        keywords: ['saved', 'bookmarks']
      },
      {
        id: 'nav-settings',
        title: 'Go to Settings',
        subtitle: 'Configure application',
        icon: <Settings size={16} />,
        action: () => { onNavigate('settings'); onClose(); },
        category: 'navigation',
        keywords: ['settings', 'preferences', 'config']
      }
    ];

    const searchCommands: Command[] = onSearch ? [
      {
        id: 'search-direct',
        title: `Search for "${query}"`,
        subtitle: 'Search files with current query',
        icon: <Search size={16} />,
        action: () => { onSearch(query); onClose(); },
        category: 'search',
        keywords: ['search']
      }
    ] : [];

    const recentCommands: Command[] = recentSearches.slice(0, 5).map((search, index) => ({
      id: `recent-${index}`,
      title: search,
      subtitle: 'Recent search',
      icon: <Clock size={16} />,
      action: () => { onSearch?.(search); onClose(); },
      category: 'recent',
      keywords: [search]
    }));

    // Add settings commands if we have a query (to avoid clutter when empty)
    const settingsCommands: Command[] = query.trim() ? searchSettings(query).map((settingsItem) => ({
      id: `settings-${settingsItem.id}`,
      title: settingsItem.title,
      subtitle: `${settingsItem.section} • ${settingsItem.description}`,
      icon: <Cog size={16} />,
      action: () => { 
        if (onSettingsNavigate) {
          onSettingsNavigate(settingsItem); 
        } else {
          // Fallback to just navigating to settings
          onNavigate('settings');
        }
        onClose(); 
      },
      category: 'settings',
      keywords: settingsItem.keywords
    })) : [];

    return [...navigationCommands, ...searchCommands, ...settingsCommands, ...recentCommands];
  }, [query, onNavigate, onSettingsNavigate, onSearch, onClose, recentSearches]);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) return commands;

    const lowercaseQuery = query.toLowerCase();
    return commands.filter(command => {
      const searchableText = [
        command.title,
        command.subtitle || '',
        ...(command.keywords || [])
      ].join(' ').toLowerCase();
      
      return searchableText.includes(lowercaseQuery);
    });
  }, [commands, query]);

  // Group commands by category
  const groupedCommands = useMemo(() => {
    const groups = filteredCommands.reduce((acc, command) => {
      if (!acc[command.category]) acc[command.category] = [];
      acc[command.category].push(command);
      return acc;
    }, {} as Record<string, Command[]>);

    return groups;
  }, [filteredCommands]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const maxIndex = filteredCommands.length - 1;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => Math.min(prev + 1, maxIndex));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            filteredCommands[selectedIndex].action();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  // Update selected index when filtered commands change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  if (!isOpen) return null;

  const getCategoryTitle = (category: string) => {
    switch (category) {
      case 'navigation': return 'Navigation';
      case 'search': return 'Search';
      case 'settings': return 'Settings';
      case 'recent': return 'Recent Searches';
      case 'files': return 'Files';
      default: return category;
    }
  };

  const categoryOrder = ['navigation', 'search', 'settings', 'recent', 'files'];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start justify-center pt-[15vh] z-50">
      <div className="soft-card w-full max-w-2xl mx-4 animate-fade-in">
        {/* Header with search input */}
        <div className="px-3 py-2.5 border-b border-brand-border">
          <div className="flex items-center space-x-2">
            <Command size={16} style={{ color: 'var(--fg-muted)' }} />
            <input
              type="text"
              placeholder="Type a command or search..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[13px]"
              style={{ color: 'var(--fg-primary)', }}
              autoFocus
            />
            <div className="flex items-center space-x-1">
              <kbd className="px-1.5 py-0.5 border rounded-sm text-[10px]" style={{ 
                backgroundColor: 'var(--bg-muted)', 
                borderColor: 'var(--border-subtle)', 
                color: 'var(--fg-muted)' 
              }}>ESC</kbd>
            </div>
          </div>
        </div>

        {/* Command list */}
        <div className="max-h-96 overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="p-6 text-center" style={{ color: 'var(--fg-muted)' }}>
              <Search size={20} className="mx-auto mb-2 opacity-50" />
              <p className="text-[12px]">No commands found</p>
            </div>
          ) : (
            <div className="p-1">
              {categoryOrder.map(category => {
                const categoryCommands = groupedCommands[category];
                if (!categoryCommands?.length) return null;

                let commandIndex = 0;
                for (const cat of categoryOrder) {
                  if (cat === category) break;
                  commandIndex += groupedCommands[cat]?.length || 0;
                }

                return (
                  <div key={category} className="mb-2 last:mb-0">
                    <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--fg-muted)' }}>
                      {getCategoryTitle(category)}
                    </div>
                    <div className="space-y-0">
                      {categoryCommands.map((command, index) => {
                        const globalIndex = commandIndex + index;
                        const isSelected = globalIndex === selectedIndex;
                        
                        return (
                          <button
                            key={command.id}
                            onClick={command.action}
                            className={`w-full flex items-center space-x-2.5 px-3 py-2 text-left transition-colors ${
                              isSelected 
                                ? 'rounded-sm' 
                                : 'hover:rounded-sm'
                            }`}
                            style={{
                              backgroundColor: isSelected ? 'var(--accent-solid)' : 'transparent',
                              color: isSelected ? 'var(--accent-contrast)' : 'var(--fg-secondary)'
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.backgroundColor = 'var(--bg-muted)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }
                            }}
                          >
                            <div className="flex-shrink-0" style={{
                              color: isSelected ? 'var(--accent-contrast)' : 'var(--fg-muted)'
                            }}>
                              {React.cloneElement(command.icon as React.ReactElement, { size: 14 })}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-[12px]" style={{
                                color: isSelected ? 'var(--accent-contrast)' : 'var(--fg-primary)'
                              }}>
                                {command.title}
                              </div>
                              {command.subtitle && (
                                <div className="text-[11px]" style={{
                                  color: isSelected ? 'var(--accent-contrast)' : 'var(--fg-muted)',
                                  opacity: isSelected ? 0.8 : 1
                                }}>
                                  {command.subtitle}
                                </div>
                              )}
                            </div>
                            {isSelected && (
                              <ArrowRight size={12} style={{ color: 'var(--accent-contrast)', opacity: 0.6 }} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with shortcuts */}
        <div className="px-3 py-2 border-t border-brand-border" style={{ backgroundColor: 'var(--bg-muted)' }}>
          <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--fg-muted)' }}>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-1">
                <kbd className="px-1.5 py-0.5 border rounded-sm" style={{ 
                  backgroundColor: 'var(--bg-elevated)', 
                  borderColor: 'var(--border-subtle)', 
                  color: 'var(--fg-muted)' 
                }}>↑</kbd>
                <kbd className="px-1.5 py-0.5 border rounded-sm" style={{ 
                  backgroundColor: 'var(--bg-elevated)', 
                  borderColor: 'var(--border-subtle)', 
                  color: 'var(--fg-muted)' 
                }}>↓</kbd>
                <span>navigate</span>
              </div>
              <div className="flex items-center space-x-1">
                <kbd className="px-1.5 py-0.5 border rounded-sm" style={{ 
                  backgroundColor: 'var(--bg-elevated)', 
                  borderColor: 'var(--border-subtle)', 
                  color: 'var(--fg-muted)' 
                }}>ENTER</kbd>
                <span>select</span>
              </div>
            </div>
            <div>
              {filteredCommands.length} result{filteredCommands.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;