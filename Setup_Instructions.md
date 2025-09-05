# FileHawk Setup Instructions

FileHawk is a powerful desktop application for semantic file search. Follow these steps to get it running on your system.

## Prerequisites

Before setting up FileHawk, ensure you have the following installed:

### Python 3.8+
- **Download:** https://www.python.org/downloads/
- **Check if installed:** Run `python --version` or `python3 --version` in terminal
- **Note:** On macOS/Linux, you may need to use `python3` instead of `python`

### Node.js 16+ and npm
- **Download:** https://nodejs.org/en/download/
- **Check if installed:** Run `node --version` and `npm --version` in terminal
- **Note:** npm comes bundled with Node.js

### Git
- **Download:** https://git-scm.com/downloads
- **Check if installed:** Run `git --version` in terminal

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/FileHawk.git
cd FileHawk
```

### 2. Set up Python Backend

#### Create a virtual environment (recommended):
```bash
# On Windows
python -m venv venv
venv\Scripts\activate

# On macOS/Linux
python3 -m venv venv
source venv/bin/activate
```

#### Install Python dependencies:
```bash
pip install -r requirements.txt
```

### 3. Set up Desktop App

Navigate to the desktop app directory:
```bash
cd desktop-app
```

Install Node.js dependencies:
```bash
npm install

# Build the application
npm run build
```

## Running FileHawk

### Start the Desktop Application

```bash
# In FileHawk/desktop-app
npm start
```

The application should launch automatically and you'll see the FileHawK interface.

## Troubleshooting

### Python Issues
- **Command not found:** Try `python3` instead of `python`
- **Permission errors:** Use `pip install --user -r requirements.txt`
- **Virtual environment issues:** Make sure to activate it before installing packages

### Node.js Issues  
- **npm command not found:** Reinstall Node.js from the official website
- **Permission errors on Linux/macOS:** Consider using nvm (Node Version Manager)
- **Package installation fails:** Try deleting `node_modules` and `package-lock.json`, then run `npm install` again

### Desktop App Issues
- **App doesn't start:** Ensure the Python API server is running on port 5001
- **Build fails:** Check that all dependencies are installed and TypeScript compiles without errors

### Port Issues
- **Port 5001 already in use:** Stop other applications using this port, or modify the port in `api.py` and `desktop-app/src/renderer/utils/api.ts`

## First Time Usage

1. **Launch the app:** After running `npm run build` whenever you run `npm start`, FileHawk will open automatically
2. **Select folders to index:** Click "Select Folders to Index" and choose directories containing your documents
3. **Wait for indexing:** The app will analyze your files and create searchable embeddings (this may take a few minutes for large folders)
4. **Start searching:** Enter natural language queries like:
   - "machine learning research papers"
   - "budget planning spreadsheets" 
   - "python code for data processing"
5. **Explore results:** Click on files to see relevant content excerpts

## Tips for Better Results

- **Use descriptive queries:** Instead of "code", try "python machine learning algorithms"
- **Index relevant folders:** Focus on folders with documents, code, or text files you actually search
- **Be patient on first run:** AI models download automatically (~100MB) and indexing takes time
- **Try different search terms:** The AI understands context and synonyms

## Configuration

The application handles most settings automatically:
- **AI models:** Downloaded automatically on first run
- **Folder preferences:** Saved automatically when you select folders
- **Search settings:** Optimized defaults for best results

Advanced users can customize settings by editing `config.py` in the root directory.

## Need Help?

Check the main [README.md](./README.md) for additional information and troubleshooting tips.
