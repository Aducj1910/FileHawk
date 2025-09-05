import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as path from 'path';
import * as isDev from 'electron-is-dev';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let pythonProcess: ChildProcess | null = null;
let hasCreatedWindow = false;

const API_PORT = 5001;
const API_URL = `http://127.0.0.1:${API_PORT}`;

function createWindow(): void {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    titleBarStyle: 'default',
    show: false,
    icon: path.join(__dirname, '../assets/icon.png')
  });

  // Load the app
  if (isDev && false) { // Temporarily disable dev mode
    mainWindow?.loadURL('http://localhost:3000');
    mainWindow?.webContents.openDevTools();
  } else {
    mainWindow?.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  hasCreatedWindow = true;
}

function startPythonServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Get the path to the Python API server
    const apiPath = path.join(__dirname, '../../../api.py');
    
    console.log('Starting Python API server...');
    console.log('API path:', apiPath);
    
    // Start the Python process using the virtual environment
    // Cross-platform Python path detection with fallbacks
    let pythonPath: string;
    if (process.platform === 'win32') {
      // Windows: use Scripts\python.exe
      pythonPath = path.join(__dirname, '../../../venv/Scripts/python.exe');
    } else {
      // macOS/Linux: use bin/python3
      pythonPath = path.join(__dirname, '../../../venv/bin/python3');
    }
    
    console.log('Preferred Python path:', pythonPath);
    console.log('Python path exists:', require('fs').existsSync(pythonPath));
    console.log('API path exists:', require('fs').existsSync(apiPath));
    console.log('Working directory:', path.join(__dirname, '../../../'));
    
    // Fallback to system Python if venv not found
    if (!require('fs').existsSync(pythonPath)) {
      console.warn('Virtual environment Python not found, trying system Python...');
      if (process.platform === 'win32') {
        pythonPath = 'python';
      } else {
        pythonPath = 'python3';
      }
      console.log('Using system Python:', pythonPath);
    }
    
    pythonProcess = spawn(pythonPath, [apiPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: path.join(__dirname, '../../../') // Set working directory to project root
    });

    pythonProcess.stdout?.on('data', (data) => {
      console.log('Python stdout:', data.toString());
    });

    pythonProcess.stderr?.on('data', (data) => {
      console.log('Python stderr:', data.toString());
    });

    pythonProcess.on('error', (error) => {
      console.error('Failed to start Python process:', error);
      reject(error);
    });

    pythonProcess.on('exit', (code, signal) => {
      console.log('Python process exited with code:', code, 'signal:', signal);
      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}, signal: ${signal}`));
      }
    });

    // Wait for server to start (give it enough time for model loading)
    setTimeout(() => {
      resolve();
    }, 5000); // 5 seconds should be enough for most cases
  });
}

function stopPythonServer(): void {
  if (pythonProcess) {
    console.log('Stopping Python API server...');
    pythonProcess.kill();
    pythonProcess = null;
  }
}

// IPC handlers for renderer process
ipcMain.handle('select-folders', async () => {
  if (!mainWindow) return [];
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'multiSelections'],
    title: 'Select folders to index'
  });
  
  return result.filePaths;
});

ipcMain.handle('select-file', async () => {
  if (!mainWindow) return null;
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select file to reindex'
  });
  
  return result.filePaths[0] || null;
});

ipcMain.handle('select-search-folder', async () => {
  if (!mainWindow) return null;
  console.log('[IPC] select-search-folder invoked');
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select folder to search within'
  });
  
  const chosen = result.filePaths[0] || null;
  console.log('[IPC] select-search-folder result:', chosen);
  return chosen;
});

ipcMain.handle('open-file', async (event, filePath: string) => {
  try {
    // Use shell.openPath for opening files with default application
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    console.error('Failed to open file:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('open-external', async (event, url: string) => {
  try {
    await shell.openExternal(url);
  } catch (error) {
    console.error('Failed to open external URL:', error);
    throw error;
  }
});

ipcMain.handle('api-request', async (event, options: {
  endpoint: string;
  method: 'GET' | 'POST';
  data?: any;
}) => {
  try {
    const url = `${API_URL}/api${options.endpoint}`;
    const response = await fetch(url, {
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: options.data ? JSON.stringify(options.data) : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
});

ipcMain.handle('quit-app', async () => {
  console.log('Quit app requested via IPC');
  app.quit();
});

// Ensure single instance
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });

  // App event handlers
  app.whenReady().then(async () => {
    try {
      // Create window immediately to avoid duplicate from activate + slow server start
      createWindow();
      // Start server in background
      startPythonServer().catch((error) => {
        console.error('Failed to start Python server:', error);
        console.error('Error details:', error.message, error.stack);
        // Show error dialog to user
        if (mainWindow) {
          dialog.showErrorBox('Python Server Error', 
            `Failed to start Python backend server:\n\n${error.message}\n\nPlease check the console for more details.`);
        }
      });
    } catch (error) {
      console.error('Failed to start application:', error);
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  stopPythonServer();
});

// Handle app quit
app.on('quit', () => {
  stopPythonServer();
}); 