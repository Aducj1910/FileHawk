import { SavedFolder, SavedItem } from '../types';

const SAVED_KEY = 'filehawk-saved-items-v1';

interface SavedState {
  folders: SavedFolder[];
  items: SavedItem[];
}

function load(): SavedState {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return { folders: [], items: [] };
    return JSON.parse(raw);
  } catch {
    return { folders: [], items: [] };
  }
}

function persist(state: SavedState) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(state));
}

export const savedStore = {
  getState(): SavedState {
    return load();
  },

  getFolders() {
    return load().folders;
  },

  addFolder(name: string): SavedFolder {
    const state = load();
    const folder: SavedFolder = { id: crypto.randomUUID(), name, createdAt: Date.now() };
    state.folders.push(folder);
    persist(state);
    return folder;
  },

  renameFolder(id: string, name: string) {
    const state = load();
    const f = state.folders.find(x => x.id === id);
    if (f) f.name = name;
    persist(state);
  },

  deleteFolder(id: string) {
    const state = load();
    state.items = state.items.map(i => (i.folderId === id ? { ...i, folderId: undefined } : i));
    state.folders = state.folders.filter(f => f.id !== id);
    persist(state);
  },

  addItem(item: Omit<SavedItem, 'id' | 'addedAt'>): SavedItem {
    const state = load();
    const newItem: SavedItem = { id: crypto.randomUUID(), addedAt: Date.now(), ...item };
    state.items.push(newItem);
    persist(state);
    return newItem;
  },

  findItemByPath(file_path: string): SavedItem | undefined {
    const state = load();
    return state.items.find(i => i.file_path === file_path);
  },

  upsertItemForPath(item: Omit<SavedItem, 'id' | 'addedAt'>): SavedItem {
    const state = load();
    const existing = state.items.find(i => i.file_path === item.file_path);
    if (existing) {
      // update fields if provided
      Object.assign(existing, item);
      persist(state);
      return existing;
    }
    const newItem: SavedItem = { id: crypto.randomUUID(), addedAt: Date.now(), ...item };
    state.items.push(newItem);
    persist(state);
    return newItem;
  },

  removeItem(id: string) {
    const state = load();
    state.items = state.items.filter(i => i.id !== id);
    persist(state);
  },

  moveItem(id: string, folderId?: string) {
    const state = load();
    const item = state.items.find(i => i.id === id);
    if (item) item.folderId = folderId;
    persist(state);
  },

  toggleFavorite(id: string, fav?: boolean) {
    const state = load();
    const item = state.items.find(i => i.id === id);
    if (item) item.favorite = fav ?? !item.favorite;
    persist(state);
  },

  setFavoriteByPath(file_path: string, fav: boolean, ensureItem?: Omit<SavedItem, 'id' | 'addedAt'>) {
    const state = load();
    let item = state.items.find(i => i.file_path === file_path);
    if (!item && ensureItem) {
      item = { id: crypto.randomUUID(), addedAt: Date.now(), ...ensureItem } as SavedItem;
      state.items.push(item);
    }
    if (item) {
      item.favorite = fav;
      persist(state);
      return item;
    }
    return undefined;
  }
};


