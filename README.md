# FileHawk - Local Semantic File Search Tool

A powerful desktop application that uses semantic search to find files based on their content, not just filenames. Built with modern web technologies and powered by advanced AI models.

## Features

- **Semantic Search**: Find files using natural language queries instead of exact keywords
- **Multiple File Types**: Supports PDF, DOCX, TXT, MD, XLSX, CSV, Python, JavaScript, and many more
- **Advanced AI Models**: Uses sentence transformers for deep content understanding
- **Modern Desktop UI**: Clean, responsive interface built with React and TailwindCSS
- **Native Integration**: System file dialogs and cross-platform compatibility
- **Real-time Progress**: Live indexing progress with detailed file tracking
- **Smart Chunking**: Intelligent content splitting for optimal search results
- **Background Processing**: Index large folders without blocking the interface

## Installation

**For detailed setup instructions, see [Setup_Instructions.md](./Setup_Instructions.md)**
Settings are automatically saved and persist between sessions.

## Supported File Types


### Text Files
- `.txt`, `.md`, `.rst`, `.tex`
- `.py`, `.js`, `.ts`, `.java`, `.cpp`, `.c`, `.h`
- `.html`, `.css`, `.xml`, `.json`, `.yaml`, `.yml`
- `.sh`, `.bash`, `.zsh`, `.fish`

### Documents
- `.pdf` (using pdfplumber)
- `.docx` (using python-docx)
- `.pptx` (using python-pptx)
- `.rtf` (using striprtf)
- `.odt`, `.ods`, `.odp` (using odfpy)

### Data Files
- `.csv` (using pandas)
- `.xlsx` (using openpyxl/pandas)
- `.json` (built-in)

### Other Formats
- `.html` (using BeautifulSoup)
- `.epub` (using ebooklib)
- `.eml` (using email module)
- `.msg` (using extract-msg)

## Architecture

FileHawk uses a hybrid architecture combining modern web technologies with powerful AI:

- **Electron Frontend**: Cross-platform desktop app built with React and TypeScript
- **Python Backend**: Flask API server handling file processing and AI operations
- **ChromaDB**: High-performance vector database for semantic search
- **SentenceTransformers**: State-of-the-art AI models for content understanding
- **Secure IPC**: Safe communication between frontend and backend processes

## Troubleshooting

### Common Issues

**Installation Problems**
- Verify Python 3.8+ and Node.js 16+ are installed
- Run `pip install -r requirements.txt` to install dependencies
- Make sure `npm install` completed without errors

**Application Won't Start**
- Check if port 5001 is available (backend uses this port)
- Ensure Python backend can access the selected folders
- Try running `npm run dev` from the desktop-app directory

**Search Not Working**
- Make sure folders are indexed first (look for "Index Complete" status)
- Try different search terms or check file permissions
- Verify indexed folders still exist and are accessible

For detailed troubleshooting, see [Setup_Instructions.md](./Setup_Instructions.md)

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- [SentenceTransformers](https://www.sbert.net/) for semantic embeddings
- [ChromaDB](https://www.trychroma.com/) for vector storage
- [Electron](https://www.electronjs.org/) for cross-platform desktop apps
- [React](https://reactjs.org/) and [TailwindCSS](https://tailwindcss.com/) for the UI 
