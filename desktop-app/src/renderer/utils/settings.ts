/**
 * Settings Management for FileHawk
 * Handles all user preferences with localStorage persistence
 */

export interface AppSettings {
  // Theme settings
  theme: 'dark' | 'light' | 'system';
  
  // Search settings
  resultsPerPage: 10 | 25 | 50 | 100;
  
  // Indexing settings (coming soon)
  autoIndexing: boolean; // Not yet implemented
  
  // Exclusion patterns (for future indexing only)
  exclusionPatterns: string[];
}

const SETTINGS_KEY = 'filehawk-settings-v1';

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  resultsPerPage: 10,
  autoIndexing: true, // Will be disabled in UI until implemented
  exclusionPatterns: [
    'node_modules',
    '.git',
    '.gitignore',
    'build',
    'dist',
    '.next',
    '.nuxt',
    'coverage',
    '.nyc_output',
    'target',
    'bin',
    'obj',
    '*.log',
    '*.tmp',
    '*.temp',
    '.DS_Store',
    'Thumbs.db'
  ]
};

/**
 * Load settings from localStorage with fallback to defaults
 */
export const loadSettings = (): AppSettings => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure all properties exist
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.warn('Failed to load settings from localStorage:', error);
  }
  
  return { ...DEFAULT_SETTINGS };
};

/**
 * Save settings to localStorage
 */
export const saveSettings = (settings: AppSettings): void => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (error) {
    console.error('Failed to save settings to localStorage:', error);
  }
};

/**
 * Update a specific setting and save
 */
export const updateSetting = <K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): AppSettings => {
  const currentSettings = loadSettings();
  const newSettings = { ...currentSettings, [key]: value };
  saveSettings(newSettings);
  return newSettings;
};

/**
 * Reset settings to defaults
 */
export const resetSettings = (): AppSettings => {
  const defaultSettings = { ...DEFAULT_SETTINGS };
  saveSettings(defaultSettings);
  return defaultSettings;
};

/**
 * Add exclusion pattern
 */
export const addExclusionPattern = (pattern: string): AppSettings => {
  const settings = loadSettings();
  const trimmedPattern = pattern.trim();
  
  if (trimmedPattern && !settings.exclusionPatterns.includes(trimmedPattern)) {
    settings.exclusionPatterns.push(trimmedPattern);
    saveSettings(settings);
  }
  
  return settings;
};

/**
 * Remove exclusion pattern
 */
export const removeExclusionPattern = (pattern: string): AppSettings => {
  const settings = loadSettings();
  settings.exclusionPatterns = settings.exclusionPatterns.filter(p => p !== pattern);
  saveSettings(settings);
  return settings;
};

/**
 * Check if a filename or folder name matches exclusion patterns
 * Supports wildcard matching with * and ?
 */
export const isExcluded = (name: string, patterns: string[]): boolean => {
  return patterns.some(pattern => {
    // Convert wildcard pattern to regex
    const regexPattern = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\\?\*/g, '.*') // Convert * to .*
      .replace(/\\?\?/g, '.'); // Convert ? to .
    
    const regex = new RegExp(`^${regexPattern}$`, 'i'); // Case insensitive
    return regex.test(name);
  });
};

/**
 * Get current exclusion patterns for display
 */
export const getExclusionPatterns = (): string[] => {
  return loadSettings().exclusionPatterns;
};

/**
 * Export settings as JSON
 */
export const exportSettings = (): string => {
  const settings = loadSettings();
  return JSON.stringify(settings, null, 2);
};

/**
 * Import settings from JSON
 */
export const importSettings = (jsonString: string): AppSettings => {
  try {
    const imported = JSON.parse(jsonString);
    // Validate the imported settings have the correct structure
    const validatedSettings = { ...DEFAULT_SETTINGS, ...imported };
    saveSettings(validatedSettings);
    return validatedSettings;
  } catch (error) {
    console.error('Failed to import settings:', error);
    throw new Error('Invalid settings file format');
  }
};