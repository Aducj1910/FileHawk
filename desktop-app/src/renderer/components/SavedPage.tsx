import React, { useEffect, useMemo, useState } from 'react';
import { SavedFolder, SavedItem } from '../types';
import { savedStore } from '../utils/savedStore';

const SavedPage: React.FC = () => {
  const [folders, setFolders] = useState<SavedFolder[]>([]);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | 'all' | 'bookmarks'>('all');
  const [query, setQuery] = useState('');

  const reload = () => {
    const state = savedStore.getState();
    setFolders(state.folders);
    setItems(state.items);
  };

  useEffect(() => {
    reload();
  }, []);

  const visibleItems = useMemo(() => {
    let list = items;
    if (selectedFolder === 'bookmarks') {
      list = list.filter(i => i.favorite);
    } else if (selectedFolder !== 'all') {
      list = list.filter(i => i.folderId === selectedFolder);
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(i => i.file_name.toLowerCase().includes(q) || i.file_path.toLowerCase().includes(q));
    }
    return list;
  }, [items, selectedFolder, query]);

  const addFolder = () => {
    const name = prompt('New folder name');
    if (!name) return;
    savedStore.addFolder(name);
    reload();
  };

  const renameFolder = (f: SavedFolder) => {
    const name = prompt('Rename folder', f.name);
    if (!name) return;
    savedStore.renameFolder(f.id, name);
    reload();
  };

  const deleteFolder = (f: SavedFolder) => {
    if (!confirm('Delete folder? Items will be kept without a folder.')) return;
    savedStore.deleteFolder(f.id);
    if (selectedFolder === f.id) setSelectedFolder('all');
    reload();
  };

  const moveItemToFolder = (item: SavedItem, folderId?: string) => {
    savedStore.moveItem(item.id, folderId);
    reload();
  };

  const toggleFavorite = (item: SavedItem) => {
    savedStore.toggleFavorite(item.id);
    reload();
  };

  const removeItem = (item: SavedItem) => {
    savedStore.removeItem(item.id);
    reload();
  };

  return (
    <div className="flex-1 p-4 bg-brand-coal text-neutral-100">
      <div className="max-w-6xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-display text-brand-gold-300 mb-1">Saved</h1>
          <p className="text-sm text-neutral-400">Organize saved results into folders and bookmarks.</p>
        </div>

        <div className="flex gap-4">
          {/* Left column: folders */}
          <div className="w-64 flex-shrink-0 bg-neutral-900 rounded border border-neutral-700 overflow-hidden">
            <div className="p-2 border-b border-neutral-700 flex items-center justify-between">
              <span className="text-sm text-neutral-300">Folders</span>
              <button onClick={addFolder} className="text-brand-gold-400 hover:underline text-xs">New</button>
            </div>
            <div className="p-1">
              {[
                { id: 'all', name: 'All' },
                { id: 'bookmarks', name: 'Bookmarks' },
                ...folders
              ].map((f: any) => (
                <div key={f.id} className={`flex items-center justify-between px-2 py-1.5 rounded cursor-pointer ${selectedFolder === f.id ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-300 hover:bg-neutral-800'}`} onClick={() => setSelectedFolder(f.id)}>
                  <span className="text-[13px] truncate">{f.name}</span>
                  {f.id !== 'all' && f.id !== 'favorites' && (
                    <div className="flex items-center gap-1 opacity-70">
                      <button className="text-xs hover:underline" onClick={(e) => { e.stopPropagation(); renameFolder(f); }}>Rename</button>
                      <button className="text-xs text-red-400 hover:underline" onClick={(e) => { e.stopPropagation(); deleteFolder(f); }}>Delete</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right column: items */}
          <div className="flex-1">
            <div className="mb-3 flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search saved..."
                className="w-72 px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-neutral-100 placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand-gold-500 text-sm"
              />
            </div>

            <div className="bg-neutral-900 rounded border border-neutral-700 overflow-hidden">
              <div className="divide-y divide-neutral-800">
                {visibleItems.length === 0 ? (
                  <div className="p-6 text-center text-neutral-400 text-sm">No saved items</div>
                ) : (
                  visibleItems.map((item) => (
                    <div key={item.id} className="p-3 flex items-center justify-between hover:bg-neutral-800">
                      <div className="min-w-0 mr-3">
                        <div className="text-xs font-medium text-neutral-100 truncate">{item.file_name}</div>
                        <div className="text-[11px] text-neutral-500 truncate font-mono">{item.file_path}</div>
                        {item.snippet && (
                          <div className="mt-1 text-[11px] text-neutral-400 line-clamp-2">{item.snippet}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={item.folderId || ''}
                          onChange={(e) => moveItemToFolder(item, e.target.value || undefined)}
                          className="px-2 py-1 bg-neutral-900 border border-neutral-700 rounded text-neutral-100 text-xs"
                        >
                          <option value="">No folder</option>
                          {folders.map(f => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                        </select>
                        <button onClick={() => toggleFavorite(item)} className={`px-2 py-1 text-xs rounded border ${item.favorite ? 'border-brand-gold-500 text-brand-gold-300' : 'border-neutral-700 text-neutral-300'}`}>{item.favorite ? '★' : '☆'}</button>
                        <button onClick={() => removeItem(item)} className="px-2 py-1 text-xs rounded border border-neutral-700 text-neutral-300">Remove</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SavedPage;


