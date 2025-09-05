import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Folder selection
  selectFolders: () => ipcRenderer.invoke('select-folders'),
  selectFile: () => ipcRenderer.invoke('select-file'),
  selectSearchFolder: () => ipcRenderer.invoke('select-search-folder'),
  
  // API requests
  apiRequest: (options: {
    endpoint: string;
    method: 'GET' | 'POST';
    data?: any;
  }) => ipcRenderer.invoke('api-request', options),
  
  // File operations
  openFile: (filePath: string) => ipcRenderer.invoke('open-file', filePath),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  
  // App operations
  quitApp: () => ipcRenderer.invoke('quit-app'),
  
  // Status polling
  onStatusUpdate: (callback: (status: any) => void) => {
    // Set up polling for status updates
    const interval = setInterval(async () => {
      try {
        const status = await ipcRenderer.invoke('api-request', {
          endpoint: '/status',
          method: 'GET'
        });
        callback(status);
      } catch (error) {
        console.error('Status polling error:', error);
      }
    }, 1000);
    
    // Return cleanup function
    return () => clearInterval(interval);
  },

  // Model status polling
  onModelStatusUpdate: (callback: (status: any) => void) => {
    const interval = setInterval(async () => {
      try {
        const status = await ipcRenderer.invoke('api-request', {
          endpoint: '/model-status',
          method: 'GET'
        });
        callback(status);
      } catch (error) {
        console.error('Model status polling error:', error);
      }
    }, 1000);

    return () => clearInterval(interval);
  }
});

// Type definitions for TypeScript
declare global {
  interface Window {
    electronAPI: {
      selectFolders: () => Promise<string[]>;
      selectFile: () => Promise<string | null>;
      selectSearchFolder: () => Promise<string | null>;
      apiRequest: (options: {
        endpoint: string;
        method: 'GET' | 'POST';
        data?: any;
      }) => Promise<any>;
      openFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      openExternal: (url: string) => Promise<void>;
      quitApp: () => Promise<void>;
      onStatusUpdate: (callback: (status: any) => void) => () => void;
      onModelStatusUpdate: (callback: (status: any) => void) => () => void;
    };
  }
} 