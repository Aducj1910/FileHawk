import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  X, 
  MoreHorizontal, 
  Copy, 
  Edit3, 
  Trash2,
  Search,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  BookOpen
} from 'lucide-react';
import { SearchTab } from '../hooks/useSearchTabs';

interface SearchTabsProps {
  tabs: SearchTab[];
  activeTabId: string;
  onTabSwitch: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabCreate: () => void;
  onTabRename: (tabId: string, newTitle: string) => void;
  onTabDuplicate: (tabId: string) => void;
  onTabClear: (tabId: string) => void;
  onTabMove?: (tabId: string, direction: 'left' | 'right') => void;
  onTabRefresh?: (tabId: string) => void;
  maxVisibleTabs?: number;
}

const SearchTabs: React.FC<SearchTabsProps> = ({
  tabs,
  activeTabId,
  onTabSwitch,
  onTabClose,
  onTabCreate,
  onTabRename,
  onTabDuplicate,
  onTabClear,
  onTabMove,
  onTabRefresh,
  maxVisibleTabs = 8
}) => {
  const [contextMenu, setContextMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);
  const [editingTab, setEditingTab] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingTab && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingTab]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      setContextMenu(null);
    };

    if (contextMenu) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [contextMenu]);

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setContextMenu({
      tabId,
      x: e.clientX,
      y: e.clientY
    });
  };

  const getTabIndex = (tabId: string) => {
    return tabs.findIndex(tab => tab.id === tabId);
  };

  const canMoveLeft = (tabId: string) => {
    return getTabIndex(tabId) > 0;
  };

  const canMoveRight = (tabId: string) => {
    return getTabIndex(tabId) < tabs.length - 1;
  };

  const handleStartEdit = (tabId: string, currentTitle: string) => {
    setEditingTab(tabId);
    setEditValue(currentTitle);
    setContextMenu(null);
  };

  const handleFinishEdit = () => {
    if (editingTab && editValue.trim()) {
      onTabRename(editingTab, editValue.trim());
    }
    setEditingTab(null);
    setEditValue('');
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishEdit();
    } else if (e.key === 'Escape') {
      setEditingTab(null);
      setEditValue('');
    }
  };

  const getTabTitle = (tab: SearchTab) => {
    if (tab.query && tab.query !== tab.title) {
      return tab.query.length > 20 ? `${tab.query.substring(0, 20)}...` : tab.query;
    }
    return tab.title;
  };

  const visibleTabs = tabs.slice(0, maxVisibleTabs);
  const hiddenTabsCount = Math.max(0, tabs.length - maxVisibleTabs);

  return (
    <div className="bg-brand-coal border-b border-brand-border">
      <div className="flex items-center">
        {/* Tab list */}
        <div 
          ref={tabsContainerRef}
          className="flex items-center flex-1 overflow-hidden"
        >
          {visibleTabs.map((tab) => (
            <div
              key={tab.id}
              className={`
                group relative flex items-center min-w-0 max-w-[200px] border-r border-brand-border
                ${tab.id === activeTabId 
                  ? 'bg-brand-onyx text-neutral-200' 
                  : 'bg-brand-coal text-neutral-400 hover:bg-neutral-800 hover:text-neutral-300'
                }
                transition-colors duration-150
              `}
            >
              {/* Tab content */}
              <button
                onClick={() => onTabSwitch(tab.id)}
                onContextMenu={(e) => handleContextMenu(e, tab.id)}
                className="flex items-center space-x-2 px-3 py-2.5 min-w-0 flex-1"
              >
                <Search size={14} className="flex-shrink-0 opacity-60" />
                
                {editingTab === tab.id ? (
                  <input
                    ref={editInputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleFinishEdit}
                    onKeyDown={handleEditKeyDown}
                    className="bg-transparent border-none outline-none text-sm min-w-0 flex-1"
                    placeholder="Tab name"
                  />
                ) : (
                  <span className="text-sm font-medium truncate">
                    {getTabTitle(tab)}
                  </span>
                )}
                
                {tab.isLoading && (
                  <div className="w-3 h-3 border border-neutral-500 border-t-neutral-300 rounded-full animate-spin flex-shrink-0" />
                )}
                
                {tab.results.length > 0 && !tab.isLoading && (
                  <span className="text-xs bg-neutral-700 text-neutral-300 px-1.5 py-0.5 rounded flex-shrink-0">
                    {tab.results.length}
                  </span>
                )}
              </button>

              {/* Close button */}
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                  className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-neutral-700 rounded transition-all duration-150 mr-1"
                  title="Close tab"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}

          {/* Hidden tabs indicator */}
          {hiddenTabsCount > 0 && (
            <div className="flex items-center px-2 py-2.5 text-xs text-neutral-500 border-r border-brand-border">
              +{hiddenTabsCount} more
            </div>
          )}
        </div>

        {/* New tab button */}
        <button
          onClick={onTabCreate}
          className="p-2.5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors duration-150"
          title="New search tab (Cmd+T)"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)}>
          <div
            className="absolute bg-neutral-900 border border-neutral-700 rounded-md shadow-lg min-w-[200px] py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                const tab = tabs.find(t => t.id === contextMenu.tabId);
                if (tab) handleStartEdit(contextMenu.tabId, tab.title);
              }}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              <div className="flex items-center space-x-2">
                <Edit3 size={14} />
                <span>Rename Tab</span>
              </div>
              <span className="text-xs text-neutral-500">F2</span>
            </button>
            
            <button
              onClick={() => {
                onTabDuplicate(contextMenu.tabId);
                setContextMenu(null);
              }}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              <div className="flex items-center space-x-2">
                <Copy size={14} />
                <span>Duplicate Tab</span>
              </div>
              <span className="text-xs text-neutral-500">⌘D</span>
            </button>
            
            {onTabRefresh && (
              <button
                onClick={() => {
                  onTabRefresh(contextMenu.tabId);
                  setContextMenu(null);
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                <div className="flex items-center space-x-2">
                  <RotateCcw size={14} />
                  <span>Refresh Search</span>
                </div>
                <span className="text-xs text-neutral-500">⌘R</span>
              </button>
            )}
            
            <button
              onClick={() => {
                onTabClear(contextMenu.tabId);
                setContextMenu(null);
              }}
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
            >
              <div className="flex items-center space-x-2">
                <Search size={14} />
                <span>Clear Search</span>
              </div>
              <span className="text-xs text-neutral-500">⌘K</span>
            </button>
            
            <div className="h-px bg-neutral-700 my-1" />
            
            {/* Tab Movement */}
            {onTabMove && tabs.length > 1 && (
              <>
                <button
                  onClick={() => {
                    onTabMove(contextMenu.tabId, 'left');
                    setContextMenu(null);
                  }}
                  disabled={!canMoveLeft(contextMenu.tabId)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center space-x-2">
                    <ArrowLeft size={14} />
                    <span>Move Left</span>
                  </div>
                  <span className="text-xs text-neutral-500">⌘←</span>
                </button>
                
                <button
                  onClick={() => {
                    onTabMove(contextMenu.tabId, 'right');
                    setContextMenu(null);
                  }}
                  disabled={!canMoveRight(contextMenu.tabId)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center space-x-2">
                    <ArrowRight size={14} />
                    <span>Move Right</span>
                  </div>
                  <span className="text-xs text-neutral-500">⌘→</span>
                </button>
                
                <div className="h-px bg-neutral-700 my-1" />
              </>
            )}
            
            {tabs.length > 1 && (
              <>
                <button
                  onClick={() => {
                    // Close all other tabs except this one
                    tabs.forEach(tab => {
                      if (tab.id !== contextMenu.tabId) {
                        onTabClose(tab.id);
                      }
                    });
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
                >
                  <div className="flex items-center space-x-2">
                    <BookOpen size={14} />
                    <span>Close Others</span>
                  </div>
                  <span className="text-xs text-neutral-500">⌘⌥W</span>
                </button>
                
                <button
                  onClick={() => {
                    onTabClose(contextMenu.tabId);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-red-400 hover:bg-neutral-800"
                >
                  <div className="flex items-center space-x-2">
                    <Trash2 size={14} />
                    <span>Close Tab</span>
                  </div>
                  <span className="text-xs text-neutral-500">⌘W</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchTabs;