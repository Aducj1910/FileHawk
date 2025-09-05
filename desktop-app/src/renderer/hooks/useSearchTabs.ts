import { useState, useCallback } from 'react';
import { SearchResult, FilterOptions } from '../types';

export interface SearchTab {
  id: string;
  title: string;
  query: string;
  results: SearchResult[];
  isLoading: boolean;
  chunkingMode: 'gist' | 'pinpoint';
  filters: FilterOptions;
  pagination: {
    page: number;
    pageSize: number;
    hasMore: boolean;
    totalResults: number;
    totalPages: number;
    lastQuery: string;
    lastIncludeGranular: boolean;
  };
  createdAt: number;
  lastActiveAt: number;
}

interface UseSearchTabsReturn {
  tabs: SearchTab[];
  activeTabId: string;
  activeTab: SearchTab | undefined;
  createTab: (initialQuery?: string) => string;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<SearchTab>) => void;
  renameTab: (tabId: string, newTitle: string) => void;
  duplicateTab: (tabId: string) => string;
  clearTabResults: (tabId: string) => void;
}

export const useSearchTabs = (): UseSearchTabsReturn => {
  const createInitialTab = (): SearchTab => ({
    id: `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    title: 'Search',
    query: '',
    results: [],
    isLoading: false,
    chunkingMode: 'gist',
    filters: {
      fileTypes: [],
      timeRange: {
        type: 'all',
        before: null,
        after: null,
        startDate: null,
        endDate: null
      },
      searchFolder: null
    },
    pagination: {
      page: 1,
      pageSize: 10,
      hasMore: false,
      totalResults: 0,
      totalPages: 0,
      lastQuery: '',
      lastIncludeGranular: true
    },
    createdAt: Date.now(),
    lastActiveAt: Date.now()
  });

  const [tabs, setTabs] = useState<SearchTab[]>(() => [createInitialTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id || '');

  const activeTab = tabs.find(tab => tab.id === activeTabId);

  const createTab = useCallback((initialQuery?: string): string => {
    const newTab = createInitialTab();
    if (initialQuery) {
      newTab.query = initialQuery;
      newTab.title = initialQuery.length > 20 
        ? `${initialQuery.substring(0, 20)}...` 
        : initialQuery || 'Search';
    }
    
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab.id;
  }, []);

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(tab => tab.id !== tabId);
      
      // Ensure at least one tab exists
      if (newTabs.length === 0) {
        const defaultTab = createInitialTab();
        setActiveTabId(defaultTab.id);
        return [defaultTab];
      }
      
      // If closing active tab, switch to the next available tab
      if (tabId === activeTabId) {
        const closingIndex = prev.findIndex(tab => tab.id === tabId);
        const nextTab = newTabs[Math.min(closingIndex, newTabs.length - 1)];
        setActiveTabId(nextTab.id);
      }
      
      return newTabs;
    });
  }, [activeTabId]);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    setTabs(prev => prev.map(tab => 
      tab.id === tabId 
        ? { ...tab, lastActiveAt: Date.now() }
        : tab
    ));
  }, []);

  const updateTab = useCallback((tabId: string, updates: Partial<SearchTab>) => {
    setTabs(prev => prev.map(tab => 
      tab.id === tabId 
        ? { ...tab, ...updates, lastActiveAt: Date.now() }
        : tab
    ));
  }, []);

  const renameTab = useCallback((tabId: string, newTitle: string) => {
    setTabs(prev => prev.map(tab => 
      tab.id === tabId 
        ? { ...tab, title: newTitle.trim() || 'Search' }
        : tab
    ));
  }, []);

  const duplicateTab = useCallback((tabId: string): string => {
    const tabToDuplicate = tabs.find(tab => tab.id === tabId);
    if (!tabToDuplicate) return '';
    
    const newTab: SearchTab = {
      ...tabToDuplicate,
      id: `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      title: `${tabToDuplicate.title} (Copy)`,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    };
    
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
    return newTab.id;
  }, [tabs]);

  const clearTabResults = useCallback((tabId: string) => {
    setTabs(prev => prev.map(tab => 
      tab.id === tabId 
        ? { 
            ...tab, 
            results: [], 
            query: '',
            isLoading: false,
            pagination: {
              page: 1,
              pageSize: 10,
              hasMore: false,
              totalResults: 0,
              totalPages: 0,
              lastQuery: '',
              lastIncludeGranular: true
            }
          }
        : tab
    ));
  }, []);

  return {
    tabs,
    activeTabId,
    activeTab,
    createTab,
    closeTab,
    switchTab,
    updateTab,
    renameTab,
    duplicateTab,
    clearTabResults
  };
};