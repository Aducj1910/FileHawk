import { GitHubRepo } from '../types';

const GITHUB_CACHE_KEY = 'filehawk-github-repos-cache-v1';
const CACHE_EXPIRY_HOURS = 2; // Cache expires after 2 hours

interface GitHubCacheState {
  repos: GitHubRepo[];
  timestamp: number;
  totalCount: number;
}

function load(): GitHubCacheState | null {
  try {
    const raw = localStorage.getItem(GITHUB_CACHE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    
    // Check if cache is expired
    const now = Date.now();
    const cacheAge = now - state.timestamp;
    const maxAge = CACHE_EXPIRY_HOURS * 60 * 60 * 1000; // Convert to milliseconds
    
    if (cacheAge > maxAge) {
      // Cache is expired, remove it
      localStorage.removeItem(GITHUB_CACHE_KEY);
      return null;
    }
    
    return state;
  } catch {
    return null;
  }
}

function persist(repos: GitHubRepo[], totalCount: number) {
  const state: GitHubCacheState = {
    repos,
    totalCount,
    timestamp: Date.now()
  };
  localStorage.setItem(GITHUB_CACHE_KEY, JSON.stringify(state));
}

export const githubCache = {
  getCachedRepos(): { repos: GitHubRepo[]; totalCount: number } | null {
    const state = load();
    if (!state) return null;
    
    return {
      repos: state.repos,
      totalCount: state.totalCount
    };
  },

  setCachedRepos(repos: GitHubRepo[], totalCount: number) {
    persist(repos, totalCount);
  },

  clearCache() {
    localStorage.removeItem(GITHUB_CACHE_KEY);
  },

  isCacheValid(): boolean {
    return load() !== null;
  }
};