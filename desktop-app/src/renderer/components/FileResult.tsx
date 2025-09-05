import React from 'react';
import { createPortal } from 'react-dom';
import { FileResultProps } from '../types';
import GoldButton from '../ui/GoldButton';
import FileGlyph from '../utils/fileIcons';
import { 
  FolderOpen, 
  Eye, 
  Copy, 
  Bookmark, 
  BookmarkCheck, 
  FolderPlus, 
  ExternalLink,
  Share,
  RefreshCw,
  Settings,
  ChevronDown
} from 'lucide-react';

const FileResult: React.FC<FileResultProps> = ({
  result,
  isExpanded,
  onToggleExpansion,
  onReindex,
  onToggleGranular,
  onOpenFile,
  onPreview,
  darkMode,
  onSelect
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [menuPos, setMenuPos] = React.useState<{x:number;y:number}|null>(null);
  const menuAnchorRef = React.useRef<HTMLButtonElement | null>(null);
  const [folderModalOpen, setFolderModalOpen] = React.useState(false);
  const [folders, setFolders] = React.useState<Array<{ id: string; name: string }>>([]);
  const [bookmarked, setBookmarked] = React.useState<boolean>(false);
  const [newFolderName, setNewFolderName] = React.useState('');

  const recalcMenuPosition = React.useCallback(() => {
    if (!menuAnchorRef.current) return;
    const rect = (menuAnchorRef.current as unknown as HTMLElement).getBoundingClientRect();
    const menuWidth = 220;
    const leftCandidate = rect.left - menuWidth - 8; // open to the left
    const left = Math.max(8, leftCandidate);
    const top = rect.bottom + 6;
    setMenuPos({ x: left, y: top });
  }, []);
  const getFileExtension = (fileType: string) => {
    return fileType.startsWith('.') ? fileType.slice(1) : fileType;
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 0.6) {
      return {
        text: 'High',
        color: 'text-emerald-700',
        bgColor: 'bg-emerald-100',
        borderColor: 'border-emerald-200'
      };
    }
    if (confidence >= 0.3) {
      return {
        text: 'Medium',
        color: 'text-brand-gold-700',
        bgColor: 'bg-brand-gold-100',
        borderColor: 'border-brand-gold-200'
      };
    }
    return {
      text: 'Low',
      color: 'text-red-700',
      bgColor: 'bg-red-100',
      borderColor: 'border-red-200'
    };
  };

  const fileExt = getFileExtension(result.file_type);
  const confidenceBadge = getConfidenceBadge(result.confidence);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuOpen(true);
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  const closeMenu = () => setMenuOpen(false);

  React.useEffect(() => {
    import('../utils/savedStore').then(({ savedStore }) => {
      const existing = savedStore.findItemByPath(result.file_path);
      setBookmarked(Boolean(existing?.favorite));
    });
  }, [result.file_path]);

  return (
    <div className="soft-card overflow-hidden transition-all duration-150" onContextMenu={handleContextMenu} onClick={() => onSelect && onSelect(result)}>
      {/* File Header */}
      <div className="p-4 border-b border-brand-border transition-colors duration-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3 flex-1">
            <div className="w-7 h-7 flex items-center justify-center text-neutral-300">
              <FileGlyph extension={fileExt} size={24} className="text-neutral-300" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[13px] font-semibold truncate mb-0.5 transition-colors duration-200 text-neutral-200">
                {result.file_name}
              </h3>
              <p 
                className="text-[11px] truncate font-mono transition-colors duration-200 text-neutral-500 hover:text-neutral-300 hover:underline cursor-pointer leading-5"
                onClick={() => onOpenFile(result.file_path)}
                title="Click to open file"
              >
                {result.file_path}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <span className={`px-1.5 py-0.5 rounded-sm text-[11px] font-medium border text-neutral-300 ${
              confidenceBadge.text === 'High' ? 'border-emerald-600/50 bg-emerald-500/10' :
              confidenceBadge.text === 'Medium' ? 'border-amber-600/50 bg-amber-500/10' :
              'border-red-600/50 bg-red-500/10'
            }`}>
              {confidenceBadge.text}
            </span>
            <button
              className="px-2 py-1 h-8 w-8 inline-flex items-center justify-center transition-colors duration-200 rounded border border-transparent hover:border-neutral-600"
              onClick={() => onToggleExpansion()}
              title={isExpanded ? "Collapse" : "Expand"}
              style={{ color: 'var(--fg-primary)' }}
            >
              <ChevronDown 
                size={16}
                className={`transition-transform duration-300 ease-in-out ${
                  isExpanded ? 'rotate-180' : 'rotate-0'
                }`}
              />
            </button>
            {/* Kebab menu */}
            <GoldButton
              variant="ghost"
              size="sm"
              className="px-2 py-1 h-8 w-8 inline-flex items-center justify-center text-neutral-300 hover:text-brand-gold-300"
              onClick={() => {
                recalcMenuPosition();
                setMenuOpen(true);
              }}
            >
              <span ref={menuAnchorRef as any} className="w-4 h-4 inline-flex items-center justify-center">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="5" cy="12" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="19" cy="12" r="1.5" />
                </svg>
              </span>
            </GoldButton>
          </div>
        </div>
      </div>

      {/* File Content */}
      {isExpanded && (
        <div className="p-3 animate-slide-down" style={{ backgroundColor: 'var(--bg-muted)' }}>
          <div className="space-y-4">
            {/* Matched Content */}
            <div>
              <h4 className="text-[12px] font-medium mb-1.5 text-neutral-300">Matched content</h4>
              <div className="bg-brand-onyx border border-brand-border rounded-sm p-2.5">
                <pre className="text-[11px] text-neutral-300 whitespace-pre-wrap font-mono leading-[1.35]">
                  {result.matches.length > 0 ? result.matches[0].content : 'No content available'}
                </pre>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-brand-border">
              <div className="flex items-center space-x-2">
                <GoldButton
                  variant="chip"
                  size="sm"
                  onClick={() => onReindex(result.file_path)}
                >
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reindex
                </GoldButton>
                <GoldButton
                  variant="chip"
                  size="sm"
                  onClick={() => onToggleGranular(result.file_path, true)}
                >
                  <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  Toggle Granular
                </GoldButton>
              </div>
              
              <div className="text-[11px] text-neutral-500">
                Confidence: {Math.round(result.confidence * 100)}%
              </div>
            </div>
          </div>
        </div>
      )}

      {menuOpen && menuPos && (
        <div className="fixed inset-0 z-[1000]" onClick={closeMenu}>
          <div className="fixed z-[1010] bg-neutral-900 border border-neutral-700 rounded-md shadow-lg min-w-[240px] py-1" style={{ left: menuPos.x, top: menuPos.y }} onClick={(e) => e.stopPropagation()}>
            
            {/* Primary Actions */}
            <button 
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" 
              onClick={() => { onOpenFile(result.file_path); closeMenu(); }}
            >
              <div className="flex items-center space-x-2">
                <FolderOpen size={14} />
                <span>Open File</span>
              </div>
              <span className="text-xs text-neutral-500">⌘O</span>
            </button>
            
            {onPreview && (
              <button 
                className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" 
                onClick={() => { onPreview(result.file_path); closeMenu(); }}
              >
                <div className="flex items-center space-x-2">
                  <Eye size={14} />
                  <span>Preview File</span>
                </div>
                <span className="text-xs text-neutral-500">Space</span>
              </button>
            )}
            
            <button 
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" 
              onClick={() => { 
                if (onSelect) onSelect(result);
                closeMenu(); 
              }}
            >
              <div className="flex items-center space-x-2">
                <ExternalLink size={14} />
                <span>Select Result</span>
              </div>
              <span className="text-xs text-neutral-500">↵</span>
            </button>
            
            <div className="h-px bg-neutral-700 my-1" />
            
            {/* Copy Actions */}
            <button 
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" 
              onClick={() => { navigator.clipboard.writeText(result.file_path); closeMenu(); }}
            >
              <div className="flex items-center space-x-2">
                <Copy size={14} />
                <span>Copy File Path</span>
              </div>
              <span className="text-xs text-neutral-500">⌘C</span>
            </button>
            
            <button 
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" 
              onClick={() => { 
                const s = result.matches?.[0]?.content || ''; 
                navigator.clipboard.writeText(s); 
                closeMenu(); 
              }}
            >
              <div className="flex items-center space-x-2">
                <Share size={14} />
                <span>Copy Snippet</span>
              </div>
              <span className="text-xs text-neutral-500">⌘⇧C</span>
            </button>
            
            <div className="h-px bg-neutral-700 my-1" />
            
            {/* Bookmark & Save Actions */}
            <button 
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" 
              onClick={() => {
                import('../utils/savedStore').then(({ savedStore }) => {
                  const updated = savedStore.setFavoriteByPath(result.file_path, !bookmarked, { file_path: result.file_path, file_name: result.file_name, file_type: result.file_type, snippet: result.matches?.[0]?.content || '' });
                  setBookmarked(Boolean(updated?.favorite));
                });
                closeMenu();
              }}
            >
              <div className="flex items-center space-x-2">
                {bookmarked ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                <span>{bookmarked ? 'Remove Bookmark' : 'Add Bookmark'}</span>
              </div>
              <span className="text-xs text-neutral-500">⌘B</span>
            </button>
            
            <button 
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" 
              onClick={() => {
                import('../utils/savedStore').then(({ savedStore }) => {
                  setFolders(savedStore.getFolders());
                  setFolderModalOpen(true);
                });
                closeMenu();
              }}
            >
              <div className="flex items-center space-x-2">
                <FolderPlus size={14} />
                <span>Save to Folder</span>
              </div>
              <span className="text-xs text-neutral-500">⌘S</span>
            </button>
            
            <div className="h-px bg-neutral-700 my-1" />
            
            {/* File Actions */}
            <button 
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" 
              onClick={() => { onReindex(result.file_path); closeMenu(); }}
            >
              <div className="flex items-center space-x-2">
                <RefreshCw size={14} />
                <span>Reindex File</span>
              </div>
              <span className="text-xs text-neutral-500">⌘R</span>
            </button>
            
            <button 
              className="w-full flex items-center justify-between px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800" 
              onClick={() => { onToggleGranular(result.file_path, true); closeMenu(); }}
            >
              <div className="flex items-center space-x-2">
                <Settings size={14} />
                <span>Toggle Granular</span>
              </div>
              <span className="text-xs text-neutral-500">⌘G</span>
            </button>
          </div>
        </div>
      )}

      {menuOpen && (
        <MenuRepositioner onReposition={recalcMenuPosition} />
      )}

      {folderModalOpen && createPortal(
        <div className="fixed inset-0 z-[1100] bg-black/50 flex items-center justify-center" onClick={() => setFolderModalOpen(false)}>
          <div className="bg-neutral-900 border border-neutral-700 rounded-sm shadow-subtle w-[380px] p-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-medium text-neutral-100 mb-2">Add to folder</h3>
            <div className="max-h-60 overflow-auto border border-neutral-800 rounded-sm">
              {folders.length === 0 ? (
                <div className="p-3 text-neutral-400 text-sm">No folders yet.</div>
              ) : (
                folders.map(f => (
                  <button key={f.id} className="block w-full text-left px-3 py-2 text-[13px] text-neutral-200 hover:bg-neutral-800" onClick={() => {
                    import('../utils/savedStore').then(({ savedStore }) => {
                      const item = savedStore.upsertItemForPath({ file_path: result.file_path, file_name: result.file_name, file_type: result.file_type, snippet: result.matches?.[0]?.content || '' });
                      savedStore.moveItem(item.id, f.id);
                    });
                    setFolderModalOpen(false);
                  }}>{f.name}</button>
                ))
              )}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="New folder name" className="flex-1 px-2 py-1 text-xs bg-neutral-900 border border-neutral-700 rounded text-neutral-100" />
              <button className="px-2 py-1 text-xs rounded border border-neutral-700 text-neutral-300" onClick={() => {
                const name = newFolderName.trim();
                if (!name) return;
                import('../utils/savedStore').then(({ savedStore }) => {
                  const folder = savedStore.addFolder(name);
                  const item = savedStore.upsertItemForPath({ file_path: result.file_path, file_name: result.file_name, file_type: result.file_type, snippet: result.matches?.[0]?.content || '' });
                  savedStore.moveItem(item.id, folder.id);
                });
                setNewFolderName('');
                setFolderModalOpen(false);
              }}>Create</button>
              <button className="ml-auto px-2 py-1 text-xs rounded border border-neutral-700 text-neutral-300" onClick={() => setFolderModalOpen(false)}>Close</button>
            </div>
          </div>
        </div>, document.body
      )}
    </div>
  );
};

export default FileResult; 

// Inline components: Bookmark toggle and Save-to-folder selector
const BookmarkToggle: React.FC<{ filePath: string; meta: { file_name: string; file_type: string; snippet?: string } }> = ({ filePath, meta }) => {
  const [bookmarked, setBookmarked] = React.useState<boolean>(false);
  React.useEffect(() => {
    import('../utils/savedStore').then(({ savedStore }) => {
      const existing = savedStore.findItemByPath(filePath);
      setBookmarked(Boolean(existing?.favorite));
    });
  }, [filePath]);

  const toggle = () => {
    import('../utils/savedStore').then(({ savedStore }) => {
      const updated = savedStore.setFavoriteByPath(filePath, !bookmarked, { file_path: filePath, file_name: meta.file_name, file_type: meta.file_type, snippet: meta.snippet });
      setBookmarked(Boolean(updated?.favorite));
    });
  };

  return (
    <button onClick={toggle} title={bookmarked ? 'Remove bookmark' : 'Add bookmark'} className={`px-2 py-1 rounded border ${bookmarked ? 'border-brand-gold-500 text-brand-gold-300' : 'border-neutral-700 text-neutral-300'}`}>
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5v16l7-5 7 5V5a2 2 0 00-2-2H7a2 2 0 00-2 2z" />
      </svg>
    </button>
  );
};

const SaveToFolderButton: React.FC<{ filePath: string; meta: { file_name: string; file_type: string; snippet?: string } }> = ({ filePath, meta }) => {
  const [open, setOpen] = React.useState(false);
  const [folders, setFolders] = React.useState<Array<{ id: string; name: string }>>([]);

  const loadFolders = () => {
    import('../utils/savedStore').then(({ savedStore }) => {
      setFolders(savedStore.getFolders());
    });
  };

  const saveToFolder = (folderId?: string) => {
    import('../utils/savedStore').then(({ savedStore }) => {
      const item = savedStore.upsertItemForPath({ file_path: filePath, file_name: meta.file_name, file_type: meta.file_type, snippet: meta.snippet });
      savedStore.moveItem(item.id, folderId);
    });
    setOpen(false);
  };

  return (
    <div className="relative">
      <GoldButton variant="ghost" size="sm" className="px-2 py-1 h-8 w-8 inline-flex items-center justify-center" onClick={() => { loadFolders(); setOpen(v => !v); }} title="Save to folder">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h3l2 2h9a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
      </GoldButton>
      {open && createPortal(
        <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)}>
          <div className="absolute z-[1010] bg-neutral-900 border border-neutral-700 rounded-sm shadow-subtle min-w-[200px]" style={{ right: '16px', top: 'calc(100px)' }} onClick={(e) => e.stopPropagation()}>
            <button className="block w-full text-left px-3 py-2 text-[13px] text-neutral-200 hover:bg-neutral-800" onClick={() => saveToFolder(undefined)}>No folder</button>
            {folders.map(f => (
              <button key={f.id} className="block w-full text-left px-3 py-2 text-[13px] text-neutral-200 hover:bg-neutral-800" onClick={() => saveToFolder(f.id)}>{f.name}</button>
            ))}
            <button className="block w-full text-left px-3 py-2 text-[13px] text-neutral-200 hover:bg-neutral-800" onClick={() => {
              import('../utils/savedStore').then(({ savedStore }) => {
                const name = prompt('New folder name');
                if (!name) return;
                const folder = savedStore.addFolder(name);
                const item = savedStore.upsertItemForPath({ file_path: filePath, file_name: meta.file_name, file_type: meta.file_type, snippet: meta.snippet });
                savedStore.moveItem(item.id, folder.id);
                setOpen(false);
              });
            }}>+ New folder</button>
          </div>
        </div>, document.body
      )}
    </div>
  );
};

// Helper component to keep menu anchored when scrolling
const MenuRepositioner: React.FC<{ onReposition: () => void }> = ({ onReposition }) => {
  React.useEffect(() => {
    const handler = () => onReposition();
    window.addEventListener('scroll', handler, true);
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('scroll', handler, true);
      window.removeEventListener('resize', handler);
    };
  }, [onReposition]);
  return null;
};