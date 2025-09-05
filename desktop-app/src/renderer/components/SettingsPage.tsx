import React, { useState, useEffect } from 'react';
import { Trash2, History, Clock, Sun, Moon, Monitor, Search, Settings, Plus, X, RotateCcw, AlertTriangle, Database } from 'lucide-react';
import { loadHistory, clearHistory, saveHistory, timeAgo, SearchHistoryItem } from '../utils/searchAssist';
import { useTheme } from '../ui/ThemeProvider';
import { 
  AppSettings, 
  loadSettings, 
  updateSetting, 
  addExclusionPattern, 
  removeExclusionPattern,
  resetSettings 
} from '../utils/settings';
import { api } from '../utils/api';

const SettingsPage: React.FC = () => {
  const { theme, setTheme } = useTheme();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  
  // Settings state
  const [settings, setSettings] = useState<AppSettings>(loadSettings());
  const [newExclusionPattern, setNewExclusionPattern] = useState('');
  const [generalOpen, setGeneralOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(true);
  const [indexingOpen, setIndexingOpen] = useState(true);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [confirmationText, setConfirmationText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const shortcuts: Array<{ key: string; action: string }> = [
    { key: 'Cmd/Ctrl + K', action: 'Focus search' },
    { key: 'Enter', action: 'Run search' },
    { key: 'Esc', action: 'Clear search / Close dialogs' },
    { key: 'Cmd/Ctrl + G', action: 'Toggle Gist/Pinpoint' },
    { key: 'Cmd/Ctrl + L', action: 'Load more results' },
    { key: 'Cmd/Ctrl + Shift + C', action: 'Collapse all results' },
    { key: 'Cmd/Ctrl + S', action: 'Save selected result' },
    { key: 'Cmd/Ctrl + ,', action: 'Open Settings' }
  ];

  // Load search history and settings on component mount
  useEffect(() => {
    setSearchHistory(loadHistory());
    setSettings(loadSettings());

    // Listen for settings section expansion from command palette
    const handleSectionExpansion = (event: CustomEvent) => {
      const { sectionId } = event.detail;
      
      // Expand the appropriate section based on sectionId
      switch (sectionId) {
        case 'appearance-section':
          setGeneralOpen(true);
          break;
        case 'search-section':
          setSearchOpen(true);
          break;
        case 'exclusions-section':
        case 'auto-indexing-section':
          setIndexingOpen(true);
          break;
        case 'shortcuts-section':
          setShortcutsOpen(true);
          break;
        case 'search-history-section':
          setHistoryOpen(true);
          break;
        case 'danger-zone-section':
          setDangerOpen(true);
          break;
      }
    };

    window.addEventListener('expandSettingsSection', handleSectionExpansion as EventListener);

    // Listen for localStorage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'filehawk-search-history-v1') {
        setSearchHistory(loadHistory());
      }
      if (e.key === 'filehawk-settings-v1') {
        setSettings(loadSettings());
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('expandSettingsSection', handleSectionExpansion as EventListener);
    };
  }, []);

  // Helper function to refresh history (called after modifications)
  const refreshHistory = () => {
    setSearchHistory(loadHistory());
  };

  // Delete individual history item
  const deleteHistoryItem = (timestamp: number) => {
    const updatedHistory = searchHistory.filter(item => item.ts !== timestamp);
    saveHistory(updatedHistory);
    refreshHistory();
  };

  // Clear all history with confirmation
  const handleClearAllHistory = () => {
    if (showClearConfirm) {
      clearHistory();
      refreshHistory();
      setShowClearConfirm(false);
    } else {
      setShowClearConfirm(true);
      // Auto-hide confirmation after 5 seconds
      setTimeout(() => setShowClearConfirm(false), 5000);
    }
  };

  // Settings handlers
  const handleSettingChange = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    const newSettings = updateSetting(key, value);
    setSettings(newSettings);
  };

  const handleThemeChange = (newTheme: 'dark' | 'light' | 'system') => {
    if (newTheme === 'system') {
      // For now, default to dark when system is selected
      // TODO: Implement actual system theme detection
      setTheme('dark');
    } else {
      setTheme(newTheme);
    }
    handleSettingChange('theme', newTheme);
  };

  const handleAddExclusionPattern = () => {
    const trimmed = newExclusionPattern.trim();
    if (trimmed) {
      const newSettings = addExclusionPattern(trimmed);
      setSettings(newSettings);
      setNewExclusionPattern('');
    }
  };

  const handleRemoveExclusionPattern = (pattern: string) => {
    const newSettings = removeExclusionPattern(pattern);
    setSettings(newSettings);
  };

  const handleResetSettings = () => {
    const defaultSettings = resetSettings();
    setSettings(defaultSettings);
    // Also reset theme
    setTheme('dark');
  };

  const handleDeleteAllData = async () => {
    if (confirmationText !== 'I understand') {
      return;
    }

    setIsDeleting(true);
    try {
      const result = await api.deleteAllData();
      
      if (result.success) {
        // Clear all localStorage data
        localStorage.clear();
        
        // Show success message and inform user the app will close
        alert('All data has been successfully deleted. The application will now close. Please restart the app to continue with a fresh state.');
        
        // Quit the application completely
        window.electronAPI.quitApp();
      } else {
        alert(`Failed to delete data: ${result.error || 'Unknown error'}`);
        setIsDeleting(false);
      }
    } catch (error) {
      alert(`Failed to delete data: ${error}`);
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex-1 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="soft-card p-4">
          <h1 className="text-xl font-semibold text-brand-gold-300 mb-2">Settings</h1>
          <p className="text-sm text-neutral-400">Configure preferences and learn keyboard shortcuts.</p>
        </div>

        {/* General Settings */}
        <div id="appearance-section" className="soft-card p-4">
          <button
            onClick={() => setGeneralOpen(!generalOpen)}
            className="w-full flex items-center justify-between text-left"
            aria-expanded={generalOpen}
          >
            <div className="flex items-center space-x-2">
              <Settings className="w-4 h-4 text-neutral-400" />
              <span className="text-base font-medium text-neutral-200">General</span>
            </div>
            <span className="text-neutral-400">{generalOpen ? '\u2212' : '+'}</span>
          </button>
          {generalOpen && (
            <div className="mt-3 space-y-4">
              {/* Theme Setting */}
              <div>
                <label className="block text-[13px] font-medium text-neutral-300 mb-2">
                  Theme
                </label>
                <div className="flex space-x-2">
                  {[
                    { value: 'dark', icon: Moon, label: 'Dark' },
                    { value: 'light', icon: Sun, label: 'Light' },
                    { value: 'system', icon: Monitor, label: 'System' }
                  ].map(({ value, icon: Icon, label }) => (
                    <button
                      key={value}
                      onClick={() => handleThemeChange(value as any)}
                      className={`flex items-center space-x-2 px-3 py-2 rounded border transition-colors text-[12px] ${
                        settings.theme === value
                          ? 'bg-brand-gold-600 border-brand-gold-500 text-white'
                          : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Search Settings */}
        <div id="search-section" className="soft-card p-4">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="w-full flex items-center justify-between text-left"
            aria-expanded={searchOpen}
          >
            <div className="flex items-center space-x-2">
              <Search className="w-4 h-4 text-neutral-400" />
              <span className="text-base font-medium text-neutral-200">Search</span>
            </div>
            <span className="text-neutral-400">{searchOpen ? '\u2212' : '+'}</span>
          </button>
          {searchOpen && (
            <div className="mt-3 space-y-4">
              {/* Results Per Page */}
              <div>
                <label className="block text-[13px] font-medium text-neutral-300 mb-2">
                  Results Per Page
                </label>
                <div className="flex space-x-2">
                  {[10, 25, 50, 100].map(count => (
                    <button
                      key={count}
                      onClick={() => handleSettingChange('resultsPerPage', count as any)}
                      className={`px-3 py-2 rounded border transition-colors text-[12px] ${
                        settings.resultsPerPage === count
                          ? 'bg-brand-gold-600 border-brand-gold-500 text-white'
                          : 'bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-neutral-700'
                      }`}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Indexing Settings */}
        <div id="exclusions-section" className="soft-card p-4">
          <button
            onClick={() => setIndexingOpen(!indexingOpen)}
            className="w-full flex items-center justify-between text-left"
            aria-expanded={indexingOpen}
          >
            <div className="flex items-center space-x-2">
              <RotateCcw className="w-4 h-4 text-neutral-400" />
              <span className="text-base font-medium text-neutral-200">Indexing</span>
            </div>
            <span className="text-neutral-400">{indexingOpen ? '\u2212' : '+'}</span>
          </button>
          {indexingOpen && (
            <div className="mt-3 space-y-4">
              {/* Auto-indexing Toggle (Coming Soon) */}
              <div id="auto-indexing-section" className="flex items-center justify-between opacity-50">
                <div>
                  <div className="flex items-center space-x-2">
                    <label className="text-[13px] font-medium text-neutral-300">
                      Auto-indexing
                    </label>
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-600/20 text-blue-400 border border-blue-600/30">
                      Coming Soon
                    </span>
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-1">
                    Automatically monitor and index file changes
                  </p>
                </div>
                <button
                  disabled
                  className="relative inline-flex h-6 w-11 items-center rounded-full bg-neutral-700 cursor-not-allowed"
                >
                  <span className="inline-block h-4 w-4 transform rounded-full bg-white/50 translate-x-1" />
                </button>
              </div>

              {/* Exclusion Patterns */}
              <div>
                <label className="block text-[13px] font-medium text-neutral-300 mb-2">
                  Default Exclusion Patterns
                </label>
                <p className="text-[11px] text-neutral-500 mb-3">
                  Files and folders to exclude from future indexing. Supports wildcards (* and ?). Changes only affect new indexing operations.
                </p>
                
                {/* Add new pattern */}
                <div className="flex space-x-2 mb-3">
                  <input
                    type="text"
                    value={newExclusionPattern}
                    onChange={(e) => setNewExclusionPattern(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleAddExclusionPattern()}
                    placeholder="Add pattern (e.g., *.log, temp_*, node_modules)"
                    className="flex-1 px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-neutral-200 placeholder-neutral-500 text-[12px] focus:outline-none focus:border-brand-gold-600"
                  />
                  <button
                    onClick={handleAddExclusionPattern}
                    className="px-3 py-2 bg-brand-gold-600 border border-brand-gold-500 text-white rounded hover:bg-brand-gold-500 transition-colors"
                    title="Add pattern"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                
                {/* Current patterns */}
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {settings.exclusionPatterns.map((pattern, index) => (
                    <div 
                      key={index}
                      className="flex items-center justify-between bg-neutral-800 border border-neutral-700 rounded px-3 py-2 group"
                    >
                      <code className="text-[12px] text-neutral-200 font-mono">{pattern}</code>
                      <button
                        onClick={() => handleRemoveExclusionPattern(pattern)}
                        className="p-1 text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        title="Remove pattern"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Search History Management */}
        <div id="search-history-section" className="soft-card p-4">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="w-full flex items-center justify-between text-left"
            aria-expanded={historyOpen}
          >
            <div className="flex items-center space-x-2">
              <History className="w-4 h-4 text-neutral-400" />
              <span className="text-base font-medium text-neutral-200">Search History</span>
              <span className="text-xs text-neutral-500">({searchHistory.length} items)</span>
            </div>
            <span className="text-neutral-400">{historyOpen ? '\u2212' : '+'}</span>
          </button>
          {historyOpen && (
            <div className="mt-3 space-y-3">
              {/* Header with Clear All button */}
              <div className="flex items-center justify-between">
                <p className="text-[13px] text-neutral-400">
                  Manage your search history. Recent searches appear in the search dropdown.
                </p>
                {searchHistory.length > 0 && (
                  <button
                    onClick={handleClearAllHistory}
                    className={`text-[12px] px-2 py-1 rounded-sm transition-colors ${
                      showClearConfirm 
                        ? 'bg-red-600 text-white hover:bg-red-700' 
                        : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                    }`}
                  >
                    {showClearConfirm ? 'Click to confirm' : 'Clear All'}
                  </button>
                )}
              </div>

              {/* History Items */}
              {searchHistory.length === 0 ? (
                <div className="text-center py-8 text-neutral-500">
                  <Clock className="w-6 h-6 mx-auto mb-2 text-neutral-600" />
                  <p className="text-[13px]">No search history yet</p>
                  <p className="text-[12px] text-neutral-600 mt-1">Your searches will appear here</p>
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {searchHistory.map((item) => (
                    <div 
                      key={item.ts} 
                      className="flex items-center justify-between border border-neutral-700 rounded-sm px-3 py-2 hover:bg-neutral-800/50 transition-colors group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-neutral-200 truncate">{item.query}</p>
                        <p className="text-[11px] text-neutral-500 mt-0.5">{timeAgo(item.ts)}</p>
                      </div>
                      <button
                        onClick={() => deleteHistoryItem(item.ts)}
                        className="ml-3 p-1 text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        title="Delete this search"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div id="shortcuts-section" className="soft-card p-4">
          <button
            onClick={() => setShortcutsOpen(!shortcutsOpen)}
            className="w-full flex items-center justify-between text-left"
            aria-expanded={shortcutsOpen}
          >
            <span className="text-base font-medium text-neutral-200">Keyboard shortcuts</span>
            <span className="text-neutral-400">{shortcutsOpen ? '\u2212' : '+'}</span>
          </button>
          {shortcutsOpen && (
            <div className="mt-3 space-y-2">
              {shortcuts.map((s) => (
                <div key={s.key} className="flex items-center justify-between border border-neutral-700 rounded-sm px-2 py-1.5">
                  <span className="text-[13px] text-neutral-300">{s.action}</span>
                  <span className="text-[12px] text-neutral-100">
                    <kbd className="inline-flex items-center gap-1 px-1.5 py-0.5 border border-neutral-600 rounded-sm bg-neutral-800">{s.key}</kbd>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Reset Settings */}
        <div className="soft-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-[13px] font-medium text-neutral-300">Reset Settings</h3>
              <p className="text-[11px] text-neutral-500 mt-1">
                Restore all settings to their default values
              </p>
            </div>
            <button
              onClick={handleResetSettings}
              className="px-3 py-2 bg-neutral-800 border border-neutral-700 text-neutral-300 rounded hover:bg-neutral-700 hover:border-neutral-600 transition-colors text-[12px]"
            >
              Reset to Defaults
            </button>
          </div>
        </div>

        {/* Danger Zone */}
        <div id="danger-zone-section" className="soft-card p-4 border-red-900/50 bg-red-950/20">
          <button
            onClick={() => setDangerOpen(!dangerOpen)}
            className="w-full flex items-center justify-between text-left"
            aria-expanded={dangerOpen}
          >
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span className="text-base font-medium text-red-300">Danger Zone</span>
            </div>
            <span className="text-red-400">{dangerOpen ? '\u2212' : '+'}</span>
          </button>
          {dangerOpen && (
            <div className="mt-3 space-y-4">
              {/* Delete All Data */}
              <div className="border border-red-800/50 rounded bg-red-950/30 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-[13px] font-medium text-red-300 flex items-center space-x-2">
                      <Database className="w-4 h-4" />
                      <span>Delete All Data</span>
                    </h3>
                    <p className="text-[11px] text-red-400/80 mt-1 leading-relaxed">
                      Permanently delete all indexed files, search history, connected repositories, 
                      ChromaDB collections, and authentication data. This action cannot be undone.
                    </p>
                    <div className="mt-2 text-[10px] text-red-500/70">
                      <p>This will remove:</p>
                      <ul className="list-disc list-inside ml-2 mt-1 space-y-0.5">
                        <li>All indexed files and embeddings</li>
                        <li>Connected GitHub repositories</li>
                        <li>Search history and saved searches</li>
                        <li>Login information and tokens</li>
                        <li>Application settings and cache</li>
                      </ul>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="ml-4 px-3 py-2 bg-red-600 border border-red-500 text-white rounded hover:bg-red-700 transition-colors text-[12px] font-medium"
                  >
                    Delete All Data
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-neutral-900 border border-red-800/50 rounded-lg p-6 max-w-md w-full mx-4">
            <div className="flex items-center space-x-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              <h3 className="text-lg font-semibold text-red-300">Confirm Data Deletion</h3>
            </div>
            
            <div className="space-y-4">
              <p className="text-[13px] text-neutral-300 leading-relaxed">
                This will permanently delete <strong>all</strong> data including:
              </p>
              
              <ul className="text-[12px] text-neutral-400 space-y-1 ml-4">
                <li>• All indexed files and search embeddings</li>
                <li>• Connected GitHub repositories and clones</li>
                <li>• Search history and saved searches</li>
                <li>• GitHub authentication tokens</li>
                <li>• Application settings and cache files</li>
                <li>• ChromaDB collections and metadata</li>
              </ul>
              
              <div className="bg-red-950/50 border border-red-800/50 rounded p-3">
                <p className="text-[12px] text-red-300 font-medium mb-2">
                  ⚠️ This action cannot be undone
                </p>
                <p className="text-[11px] text-red-400/80">
                  The application will close after deletion. When you restart, you'll have a completely fresh installation requiring reconnection to GitHub and re-indexing of all folders.
                </p>
              </div>
              
              <div>
                <label className="block text-[12px] font-medium text-neutral-300 mb-2">
                  Type "I understand" to confirm:
                </label>
                <input
                  type="text"
                  value={confirmationText}
                  onChange={(e) => setConfirmationText(e.target.value)}
                  placeholder="I understand"
                  className="w-full px-3 py-2 bg-neutral-800 border border-neutral-700 rounded text-neutral-200 placeholder-neutral-500 text-[12px] focus:outline-none focus:border-red-600"
                  autoFocus
                />
              </div>
            </div>
            
            <div className="flex space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setConfirmationText('');
                }}
                className="flex-1 px-4 py-2 bg-neutral-800 border border-neutral-700 text-neutral-300 rounded hover:bg-neutral-700 transition-colors text-[12px]"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAllData}
                disabled={confirmationText !== 'I understand' || isDeleting}
                className={`flex-1 px-4 py-2 rounded text-[12px] font-medium transition-colors ${
                  confirmationText === 'I understand' && !isDeleting
                    ? 'bg-red-600 border border-red-500 text-white hover:bg-red-700'
                    : 'bg-red-900/50 border border-red-800/50 text-red-500/50 cursor-not-allowed'
                }`}
              >
                {isDeleting ? 'Deleting...' : 'Delete All Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;