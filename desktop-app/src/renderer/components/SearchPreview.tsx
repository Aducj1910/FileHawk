import React, { useState, useEffect, useRef } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { 
  FileText, 
  Code, 
  Image, 
  FileVideo, 
  Archive,
  X,
  ChevronRight,
  ChevronDown,
  Search,
  Loader
} from 'lucide-react';

interface SearchPreviewProps {
  filePath?: string;
  query?: string;
  isOpen: boolean;
  onClose: () => void;
  darkMode?: boolean;
}

interface FilePreviewData {
  content: string;
  language: string;
  fileType: 'text' | 'code' | 'image' | 'binary' | 'unknown';
  size: number;
  lastModified: string;
}

const SearchPreview: React.FC<SearchPreviewProps> = ({
  filePath,
  query = '',
  isOpen,
  onClose,
  darkMode = true
}) => {
  const [previewData, setPreviewData] = useState<FilePreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const previewRef = useRef<HTMLDivElement>(null);

  // File type detection based on extension
  const getFileInfo = (path: string) => {
    const extension = path.split('.').pop()?.toLowerCase() || '';
    
    const codeExtensions = [
      'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'php',
      'rb', 'go', 'rs', 'swift', 'kt', 'scala', 'clj', 'hs', 'ml', 'r',
      'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'
    ];
    
    const textExtensions = [
      'txt', 'md', 'markdown', 'rst', 'org', 'tex', 'log', 'csv', 'tsv',
      'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'conf', 'config'
    ];
    
    const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'ico'];
    const videoExtensions = ['mp4', 'avi', 'mov', 'webm', 'mkv'];
    const archiveExtensions = ['zip', 'tar', 'gz', '7z', 'rar'];

    if (codeExtensions.includes(extension)) {
      return { 
        type: 'code' as const, 
        language: getLanguageFromExtension(extension),
        icon: <Code size={16} />
      };
    }
    if (textExtensions.includes(extension)) {
      return { 
        type: 'text' as const, 
        language: extension === 'json' ? 'json' : extension === 'xml' ? 'xml' : 'text',
        icon: <FileText size={16} />
      };
    }
    if (imageExtensions.includes(extension)) {
      return { type: 'image' as const, language: '', icon: <Image size={16} /> };
    }
    if (videoExtensions.includes(extension)) {
      return { type: 'binary' as const, language: '', icon: <FileVideo size={16} /> };
    }
    if (archiveExtensions.includes(extension)) {
      return { type: 'binary' as const, language: '', icon: <Archive size={16} /> };
    }
    
    return { type: 'unknown' as const, language: 'text', icon: <FileText size={16} /> };
  };

  const getLanguageFromExtension = (ext: string): string => {
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'jsx',
      'ts': 'typescript',
      'tsx': 'tsx',
      'py': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c': 'c',
      'h': 'c',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'swift': 'swift',
      'kt': 'kotlin',
      'scala': 'scala',
      'sql': 'sql',
      'sh': 'bash',
      'bash': 'bash',
      'zsh': 'bash',
      'json': 'json',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
    };
    return langMap[ext] || 'text';
  };

  // Mock API call to get file preview data
  const loadPreviewData = async (path: string): Promise<FilePreviewData> => {
    // This would be replaced with actual API call to backend
    // For now, creating mock data based on file extension
    
    const fileInfo = getFileInfo(path);
    
    if (fileInfo.type === 'binary' || fileInfo.type === 'image') {
      throw new Error('Cannot preview binary files');
    }
    
    // Mock content based on file type
    let mockContent = '';
    if (fileInfo.language === 'javascript') {
      mockContent = `// ${path}\nimport React from 'react';\nimport { useState, useEffect } from 'react';\n\nconst MyComponent = () => {\n  const [data, setData] = useState(null);\n  \n  useEffect(() => {\n    fetchData();\n  }, []);\n  \n  const fetchData = async () => {\n    const result = await api.getData();\n    setData(result);\n  };\n  \n  return (\n    <div className="container">\n      {data ? <DataView data={data} /> : <Loading />}\n    </div>\n  );\n};\n\nexport default MyComponent;`;
    } else if (fileInfo.language === 'python') {
      mockContent = `# ${path}\nimport os\nimport sys\nfrom typing import List, Optional\n\nclass DataProcessor:\n    def __init__(self, config: dict):\n        self.config = config\n        self.data = []\n    \n    def process_file(self, filepath: str) -> Optional[dict]:\n        try:\n            with open(filepath, 'r') as f:\n                content = f.read()\n            return self.parse_content(content)\n        except Exception as e:\n            print(f"Error processing {filepath}: {e}")\n            return None\n    \n    def parse_content(self, content: str) -> dict:\n        # Implementation here\n        return {"parsed": True, "content": content}`;
    } else if (fileInfo.language === 'json') {
      mockContent = `{\n  "name": "${path.split('/').pop()}",\n  "version": "1.0.0",\n  "description": "Sample JSON file",\n  "main": "index.js",\n  "scripts": {\n    "start": "node index.js",\n    "test": "jest",\n    "build": "webpack --mode production"\n  },\n  "dependencies": {\n    "react": "^18.0.0",\n    "react-dom": "^18.0.0"\n  },\n  "devDependencies": {\n    "@types/react": "^18.0.0",\n    "webpack": "^5.0.0"\n  }\n}`;
    } else {
      mockContent = `File: ${path}\n\nThis is a sample preview of the file content.\nThe actual implementation would fetch real file content from the backend.\n\nQuery matches would be highlighted here.\nMultiple lines would show context around search results.\n\nSupported file types:\n- Code files (JS, TS, Python, etc.)\n- Text files (MD, TXT, JSON, etc.)\n- Configuration files\n\nFeatures:\n- Syntax highlighting\n- Search term highlighting\n- Line numbers\n- File metadata display`;
    }
    
    return {
      content: mockContent,
      language: fileInfo.language,
      fileType: fileInfo.type,
      size: mockContent.length,
      lastModified: new Date().toISOString()
    };
  };

  const findSearchMatches = (content: string, searchQuery: string): number[] => {
    if (!searchQuery.trim()) return [];
    
    const lines = content.split('\n');
    const matches: number[] = [];
    const query = searchQuery.toLowerCase();
    
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(query)) {
        matches.push(index + 1); // 1-indexed line numbers
      }
    });
    
    return matches;
  };

  useEffect(() => {
    if (!filePath || !isOpen) {
      setPreviewData(null);
      setError(null);
      setSearchMatches([]);
      return;
    }

    const loadData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const data = await loadPreviewData(filePath);
        setPreviewData(data);
        
        // Find search matches
        if (query) {
          const matches = findSearchMatches(data.content, query);
          setSearchMatches(matches);
          if (matches.length > 0) {
            setSelectedLine(matches[0]);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load preview');
      } finally {
        setLoading(false);
      }
    };

    // Debounce the loading
    const timeout = setTimeout(loadData, 300);
    return () => clearTimeout(timeout);
  }, [filePath, isOpen, query]);

  if (!isOpen) return null;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const fileName = filePath?.split('/').pop() || '';
  const fileInfo = filePath ? getFileInfo(filePath) : null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-40 p-4">
      <div className="bg-brand-coal border border-brand-border rounded-lg shadow-2xl w-full max-w-6xl max-h-[80vh] flex flex-col animate-fade-in">
        {/* Header */}
        <div className="px-6 py-4 border-b border-brand-border flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {fileInfo?.icon}
            <div>
              <h3 className="text-lg font-semibold text-neutral-200">{fileName}</h3>
              <div className="flex items-center space-x-4 text-xs text-neutral-400">
                <span>{filePath}</span>
                {previewData && (
                  <>
                    <span>•</span>
                    <span>{formatFileSize(previewData.size)}</span>
                    <span>•</span>
                    <span>{previewData.language}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {query && searchMatches.length > 0 && (
              <div className="flex items-center space-x-2 text-sm text-neutral-300">
                <Search size={14} />
                <span>{searchMatches.length} match{searchMatches.length !== 1 ? 'es' : ''}</span>
              </div>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-neutral-700 rounded-md transition-colors text-neutral-400 hover:text-neutral-200"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="flex items-center space-x-2 text-neutral-400">
                <Loader size={18} className="animate-spin" />
                <span>Loading preview...</span>
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-neutral-400">
                <FileText size={32} className="mx-auto mb-2 opacity-50" />
                <p className="mb-1">Cannot preview this file</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          ) : previewData ? (
            <div ref={previewRef} className="h-full overflow-auto">
              <SyntaxHighlighter
                language={previewData.language}
                style={oneDark}
                showLineNumbers={true}
                customStyle={{
                  margin: 0,
                  padding: '1rem',
                  background: 'transparent',
                  fontSize: '13px',
                  lineHeight: '1.5'
                }}
                lineNumberStyle={{
                  minWidth: '3em',
                  paddingRight: '1em',
                  color: '#6b7280',
                  backgroundColor: 'transparent'
                }}
                wrapLines={true}
                lineProps={(lineNumber) => ({
                  style: {
                    backgroundColor: searchMatches.includes(lineNumber) 
                      ? 'rgba(231, 182, 80, 0.1)' 
                      : selectedLine === lineNumber 
                        ? 'rgba(59, 130, 246, 0.1)' 
                        : 'transparent',
                    borderLeft: selectedLine === lineNumber 
                      ? '3px solid #3b82f6' 
                      : searchMatches.includes(lineNumber)
                        ? '3px solid #e7b650'
                        : '3px solid transparent',
                    paddingLeft: '0.5rem',
                    display: 'block'
                  },
                  onClick: () => setSelectedLine(lineNumber)
                })}
              >
                {previewData.content}
              </SyntaxHighlighter>
            </div>
          ) : null}
        </div>

        {/* Footer with search matches navigation */}
        {searchMatches.length > 0 && (
          <div className="px-6 py-3 border-t border-brand-border">
            <div className="flex items-center justify-between">
              <div className="text-sm text-neutral-400">
                Search matches on lines: {searchMatches.join(', ')}
              </div>
              <div className="flex items-center space-x-2">
                {searchMatches.map((lineNum, index) => (
                  <button
                    key={lineNum}
                    onClick={() => setSelectedLine(lineNum)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      selectedLine === lineNum
                        ? 'bg-brand-gold-600 text-brand-onyx'
                        : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600'
                    }`}
                  >
                    {lineNum}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPreview;