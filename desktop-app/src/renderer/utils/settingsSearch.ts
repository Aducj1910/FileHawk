/**
 * Settings search data for global command palette (Cmd/Ctrl + K)
 */

export interface SettingsSearchItem {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  section: string;
  route: string;
  sectionId?: string; // For scrolling to specific section
}

export const settingsSearchData: SettingsSearchItem[] = [
  // Theme & Appearance
  {
    id: 'theme-toggle',
    title: 'Theme',
    description: 'Switch between dark and light mode',
    keywords: ['theme', 'dark mode', 'light mode', 'appearance', 'color scheme', 'dark', 'light'],
    section: 'Appearance',
    route: '/settings',
    sectionId: 'appearance-section'
  },

  // Search Results
  {
    id: 'results-per-page',
    title: 'Results per page',
    description: 'Change how many search results to show per page',
    keywords: ['results per page', 'pagination', '10', '25', '50', '100', 'page size', 'results', 'limit'],
    section: 'Search',
    route: '/settings',
    sectionId: 'search-section'
  },

  // Exclusion Patterns
  {
    id: 'exclusion-patterns',
    title: 'Exclusion patterns',
    description: 'Configure file and folder exclusion patterns',
    keywords: ['exclusions', 'exclude files', 'patterns', 'wildcards', 'ignore', 'filter', 'exclude', 'skip'],
    section: 'Indexing',
    route: '/settings',
    sectionId: 'exclusions-section'
  },

  // Keyboard Shortcuts
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard shortcuts',
    description: 'View available keyboard shortcuts and hotkeys',
    keywords: ['shortcuts', 'hotkeys', 'keybindings', 'ctrl', 'cmd', 'keyboard', 'keys', 'bindings'],
    section: 'Help',
    route: '/settings',
    sectionId: 'shortcuts-section'
  },

  // Auto-indexing
  {
    id: 'auto-indexing',
    title: 'Auto-indexing',
    description: 'Enable automatic file monitoring and indexing',
    keywords: ['auto index', 'automatic', 'realtime', 'monitoring', 'watch', 'auto', 'real-time'],
    section: 'Indexing',
    route: '/settings',
    sectionId: 'auto-indexing-section'
  },

  // Search History
  {
    id: 'search-history',
    title: 'Search history',
    description: 'Clear your search history and recent searches',
    keywords: ['history', 'clear history', 'recent searches', 'search history', 'clear', 'recent'],
    section: 'Privacy',
    route: '/settings',
    sectionId: 'search-history-section'
  },

  // Data Management / Danger Zone
  {
    id: 'delete-all-data',
    title: 'Delete all data',
    description: 'Permanently delete all application data and indexes',
    keywords: ['delete data', 'clear data', 'reset', 'danger zone', 'cleanup', 'remove', 'delete', 'clear all'],
    section: 'Danger Zone',
    route: '/settings',
    sectionId: 'danger-zone-section'
  },

  // General Settings Access
  {
    id: 'settings-general',
    title: 'Settings',
    description: 'Open application settings and preferences',
    keywords: ['settings', 'preferences', 'config', 'configuration', 'options'],
    section: 'General',
    route: '/settings'
  }
];

/**
 * Search through settings based on query
 */
export function searchSettings(query: string): SettingsSearchItem[] {
  if (!query.trim()) return [];
  
  const searchTerm = query.toLowerCase().trim();
  
  return settingsSearchData.filter(item => {
    // Check title match
    if (item.title.toLowerCase().includes(searchTerm)) return true;
    
    // Check description match
    if (item.description.toLowerCase().includes(searchTerm)) return true;
    
    // Check keywords match
    return item.keywords.some(keyword => 
      keyword.toLowerCase().includes(searchTerm) ||
      searchTerm.includes(keyword.toLowerCase())
    );
  }).sort((a, b) => {
    // Prioritize exact title matches
    const aExactTitle = a.title.toLowerCase() === searchTerm;
    const bExactTitle = b.title.toLowerCase() === searchTerm;
    if (aExactTitle && !bExactTitle) return -1;
    if (!aExactTitle && bExactTitle) return 1;
    
    // Then prioritize title starts with
    const aTitleStarts = a.title.toLowerCase().startsWith(searchTerm);
    const bTitleStarts = b.title.toLowerCase().startsWith(searchTerm);
    if (aTitleStarts && !bTitleStarts) return -1;
    if (!aTitleStarts && bTitleStarts) return 1;
    
    // Finally sort alphabetically
    return a.title.localeCompare(b.title);
  });
}

/**
 * Get all available settings for browsing
 */
export function getAllSettings(): SettingsSearchItem[] {
  return settingsSearchData;
}