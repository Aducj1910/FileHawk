# FileFinder Desktop App

A modern Electron desktop application for FileFinder - Local Semantic File Search Tool.

## Features

- **Modern UI**: Clean, responsive interface built with React, TypeScript, and TailwindCSS
- **Folder Selection**: Native file dialogs for selecting folders to index
- **Real-time Indexing**: Live progress updates during file indexing
- **Semantic Search**: Natural language search with configurable granularity
- **File Management**: Reindex individual files and toggle granular tracking
- **Cross-platform**: Works on Windows, macOS, and Linux

## Prerequisites

- Node.js 16+ and npm
- Python 3.8+ with the FileFinder dependencies installed
- The main FileFinder project (main.py, config.py, api.py) in the parent directory

## Installation

1. Install Node.js dependencies:
   ```bash
   npm install
   ```

2. Ensure the Python backend is set up:
   ```bash
   # From the parent directory (filesearcher/)
   pip install -r requirements.txt
   ```

## Development

### Start the development server:
```bash
npm run dev
```

This will:
- Start the webpack dev server for the renderer process
- Watch for TypeScript changes in the main process
- Launch the Electron app

### Build for production:
```bash
npm run build
```

### Create distributable packages:
```bash
# For macOS
npm run dist:mac

# For Windows
npm run dist:win

# For Linux
npm run dist:linux
```

## Project Structure

```
desktop-app/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts     # Main process entry point
│   │   └── preload.ts  # Preload script for secure IPC
│   └── renderer/       # React renderer process
│       ├── components/ # React components
│       ├── types/      # TypeScript type definitions
│       ├── utils/      # Utility functions
│       ├── App.tsx     # Main React component
│       ├── index.tsx   # Renderer entry point
│       └── styles.css  # Global styles
├── public/             # Static assets
├── dist/              # Built files
└── package.json       # Project configuration
```

## Architecture

The desktop app consists of:

1. **Electron Main Process** (`src/main/main.ts`):
   - Manages the application window
   - Starts the Python API server
   - Handles native file dialogs
   - Manages IPC communication

2. **Electron Renderer Process** (`src/renderer/`):
   - React-based UI
   - Communicates with the main process via IPC
   - Makes API calls to the Python backend

3. **Python Backend** (`../api.py`):
   - Flask API server
   - Wraps the existing FileFinder functionality
   - Handles file indexing and search

## API Endpoints

The Python backend provides these endpoints:

- `GET /api/status` - Get indexing status
- `POST /api/index` - Index selected folders
- `POST /api/search` - Perform semantic search
- `POST /api/reindex` - Reindex a specific file/folder
- `POST /api/track-granular` - Toggle granular tracking
- `GET /api/config` - Get current configuration

## Configuration

The app uses the same configuration as the CLI version (`../config.py`). Key settings include:

- `ENABLE_GRANULAR_CHUNKING`: Enable line-level indexing
- `EMBEDDING_MODEL`: The sentence transformer model to use
- `DB_DIR`: ChromaDB database directory
- `FOLDER_TO_INDEX`: Default folder to index

## Troubleshooting

### Python Backend Issues
- Ensure all Python dependencies are installed
- Check that the Python path is correct in `main.ts`
- Verify the API server starts on port 5000

### Build Issues
- Clear the `dist/` directory and rebuild
- Ensure all TypeScript types are properly defined
- Check webpack configuration for any path issues

### Runtime Issues
- Check the Electron console for error messages
- Verify the Python API server is running
- Ensure file permissions allow reading the selected folders

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see the main project LICENSE file for details. 