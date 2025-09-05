import { 
  IndexingStatus, 
  SearchResponse, 
  ConfigResponse,
  IndexRequest,
  SearchRequest,
  ReindexRequest,
  ToggleGranularRequest,
  ModelStatus,
  ConnectedRepo
} from '../types';

class API {
  private static instance: API;

  private constructor() {}

  static getInstance(): API {
    if (!API.instance) {
      API.instance = new API();
    }
    return API.instance;
  }

  // Suggestions removed

  async request<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', data?: any): Promise<T> {
    try {
      console.log(`🌐 API Request: ${method} ${endpoint}`, data ? { data } : '');
      
      const response = await window.electronAPI.apiRequest({
        endpoint,
        method,
        data
      });
      
      console.log(`🌐 API Response: ${method} ${endpoint}`, response);
      return response;
    } catch (error) {
      console.error(`❌ API request failed for ${endpoint}:`, error);
      throw error;
    }
  }

  // Status endpoints
  async getStatus(): Promise<IndexingStatus> {
    return this.request<IndexingStatus>('/status');
  }

  async getModelStatus(): Promise<ModelStatus> {
    return this.request<ModelStatus>('/model-status');
  }

  async getConfig(): Promise<ConfigResponse> {
    return this.request<ConfigResponse>('/config');
  }

  // Health check
  async isApiAvailable(): Promise<boolean> {
    try {
      await this.getConfig();
      return true;
    } catch {
      return false;
    }
  }

  // Indexing endpoints
  async indexFolders(folders: string[], chunkingMode: 'gist' | 'pinpoint'): Promise<{ message: string; folders: string[] }> {
    const request: IndexRequest = { folders, chunking_mode: chunkingMode };
    return this.request<{ message: string; folders: string[] }>('/index', 'POST', request);
  }

  async indexFoldersWithExclusions(
    folders: string[], 
    chunkingMode: 'gist' | 'pinpoint', 
    excludes: string[], 
    maxSizeMb: number
  ): Promise<{ message: string; folders: string[] }> {
    const request = { 
      folders, 
      chunking_mode: chunkingMode,
      custom_excludes: excludes,
      max_size_mb: maxSizeMb
    };
    return this.request<{ message: string; folders: string[] }>('/index', 'POST', request);
  }

  async cancelIndexing(): Promise<{ success: boolean; message: string; cleanup_performed?: boolean }> {
    return this.request<{ success: boolean; message: string; cleanup_performed?: boolean }>('/index/cancel', 'POST');
  }

  async scanFolderStructure(folderPath: string): Promise<{ 
    success: boolean; 
    tree?: any[]; 
    error?: string; 
  }> {
    return this.request<{ success: boolean; tree?: any[]; error?: string }>('/scan-folder', 'POST', { 
      folder_path: folderPath 
    });
  }

  async getFolderSettings(folders: string[]): Promise<{
    success: boolean;
    excludes?: string[];
    max_size_mb?: number;
    error?: string;
  }> {
    return this.request<{
      success: boolean;
      excludes?: string[];
      max_size_mb?: number;
      error?: string;
    }>('/folder-settings', 'POST', { folders });
  }

  async reindexPath(path: string, chunkingMode: 'gist' | 'pinpoint'): Promise<{ message: string }> {
    const request: ReindexRequest = { path, chunking_mode: chunkingMode };
    return this.request<{ message: string }>('/reindex', 'POST', request);
  }

  // Search endpoints
  async search(
    query: string, 
    includeGranular: boolean = true, 
    chunkingMode: 'gist' | 'pinpoint',
    page: number = 1,
    pageSize: number = 10,
    filters?: any
  ): Promise<SearchResponse> {
    const request: SearchRequest = {
      query,
      include_granular: includeGranular,
      chunking_mode: chunkingMode,
      page,
      page_size: pageSize,
      filters
    };
    return this.request<SearchResponse>('/search', 'POST', request);
  }

  // Granular tracking endpoints
  async toggleGranularTracking(filePath: string, enable: boolean): Promise<{ message: string; lines_indexed?: number }> {
    const request: ToggleGranularRequest = {
      file_path: filePath,
      enable
    };
    return this.request<{ message: string; lines_indexed?: number }>('/track-granular', 'POST', request);
  }

  // File tracking endpoints
  async getTrackedFiles(
    chunkingMode: 'gist' | 'pinpoint',
    page: number = 1,
    pageSize: number = 25,
    searchQuery: string = '',
    sortBy: string = 'last_indexed',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{
    files: Array<{
      file_path: string;
      file_name: string;
      parent_folder: string;
      file_size: number;
      last_indexed: number;
      status: string;
      is_synced: boolean;
      num_chunks: number;
      chunking_mode: string;
    }>;
    pagination: {
      page: number;
      page_size: number;
      total_files: number;
      total_pages: number;
      has_more: boolean;
    };
    chunking_mode: string;
  }> {
    return this.request('/files/track', 'POST', {
      chunking_mode: chunkingMode,
      page,
      page_size: pageSize,
      search_query: searchQuery,
      sort_by: sortBy,
      sort_order: sortOrder
    });
  }

  // Metadata endpoints
     async getMetadataStats(): Promise<{
     total_files: number;
     total_chunks: number;
     mode_stats: Record<string, { files: number; chunks: number }>;
     metadata_file: string;
     db_directory: string;
   }> {
    return this.request<{
      total_files: number;
      total_chunks: number;
      mode_stats: Record<string, { files: number; chunks: number }>;
      metadata_file: string;
      db_directory: string;
    }>('/metadata');
  }

  // Real-time Sync API methods
  async startRealtimeSync(): Promise<{
    success: boolean;
    message: string;
    status?: any;
    error?: string;
  }> {
    return this.request('/sync/start', 'POST');
  }

  async stopRealtimeSync(): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    return this.request('/sync/stop', 'POST');
  }

  async getSyncStatus(chunkingMode: 'gist' | 'pinpoint'): Promise<{
    success: boolean;
    chunking_mode: string;
    needs_sync: boolean;
    total_changes: number;
    folders_affected: number;
    folder_breakdown: Record<string, {
      path: string;
      change_count: number;
      files: Array<{
        path: string;
        event_type: string;
        timestamp: number;
      }>;
    }>;
    monitored_folders: string[];
    error?: string;
  }> {
    return this.request('/sync/status', 'POST', {
      chunking_mode: chunkingMode
    });
  }

  async executeSync(chunkingMode: 'gist' | 'pinpoint'): Promise<{
    success: boolean;
    message: string;
    files_to_sync?: number;
    files_processed?: number;
    chunking_mode: string;
    error?: string;
  }> {
    return this.request('/sync/execute', 'POST', {
      chunking_mode: chunkingMode
    });
  }

  async getMonitorStatus(): Promise<{
    success: boolean;
    is_running: boolean;
    monitored_paths: string[];
    monitored_count: number;
    sync_tracker_stats: any;
    error?: string;
  }> {
    return this.request('/sync/monitor-status');
  }

  // Debug methods
  async debugSyncSystem(): Promise<any> {
    return this.request('/debug/sync');
  }

  async forceMonitorStart(): Promise<any> {
    return this.request('/debug/force-monitor-start', 'POST');
  }

  // GitHub API methods
  async getGitHubAuthStatus(): Promise<{
    connected: boolean;
    user?: {
      login: string;
      name: string;
      avatar_url: string;
    };
  }> {
    return this.request('/github/auth/status');
  }

  async startGitHubAuth(): Promise<{
    success: boolean;
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    error?: string;
  }> {
    return this.request('/github/auth/start', 'POST');
  }

  async pollGitHubAuth(): Promise<{
    success: boolean;
    pending?: boolean;
    slow_down?: boolean;
    error?: string;
  }> {
    return this.request('/github/auth/poll', 'POST');
  }

  async logoutGitHub(): Promise<{
    success: boolean;
    message: string;
  }> {
    return this.request('/github/auth/logout', 'POST');
  }

  async getGitHubRepos(page: number = 1): Promise<{
    repos: Array<{
      id: number;
      full_name: string;
      name: string;
      owner: {
        login: string;
        avatar_url: string;
      };
      private: boolean;
      archived: boolean;
      default_branch: string;
      html_url: string;
      description: string | null;
      updated_at: string;
    }>;
    has_more: boolean;
    total_count: number;
  }> {
    return this.request('/github/repos', 'POST', { page });
  }

  async cloneGitHubRepo(fullName: string): Promise<{
    success: boolean;
    local_path?: string;
    default_branch?: string;
    error?: string;
  }> {
    return this.request('/github/clone', 'POST', { full_name: fullName });
  }

  async cancelGitHubClone(): Promise<{
    success: boolean;
    message?: string;
    error?: string;
  }> {
    return this.request('/github/clone/cancel', 'POST');
  }

  async getGitHubFileTree(fullName: string, branch?: string): Promise<{
    success: boolean;
    tree?: any;
    error?: string;
  }> {
    const params = new URLSearchParams({ full_name: fullName });
    if (branch) {
      params.append('branch', branch);
    }
    return this.request(`/github/file-tree?${params.toString()}`);
  }

  async checkoutGitHubBranch(fullName: string, branchName: string): Promise<{
    success: boolean;
    message?: string;
    current_branch?: string;
    error?: string;
  }> {
    return this.request('/github/checkout', 'POST', { 
      full_name: fullName, 
      branch_name: branchName 
    });
  }

  async getGitHubBranches(fullName: string): Promise<{
    branches: Array<{
      name: string;
      commit: {
        sha: string;
        message: string;
      };
      protected: boolean;
    }>;
  }> {
    return this.request(`/github/branches?full_name=${encodeURIComponent(fullName)}`);
  }


  async fetchGitHubRepo(fullName: string): Promise<{
    success: boolean;
    message: string;
    ahead?: number;
    behind?: number;
    timestamp?: number;
    error?: string;
  }> {
    return this.request('/github/fetch', 'POST', { full_name: fullName });
  }

  async pullGitHubRepo(fullName: string, branch: string): Promise<{
    success: boolean;
    message: string;
    changed_files?: {
      added: string[];
      modified: string[];
      removed: string[];
    };
    head_commit?: string;
    error?: string;
  }> {
    return this.request('/github/pull', 'POST', { full_name: fullName, branch });
  }

  async indexGitHubRepo(
    fullName: string, 
    branch: string, 
    mode: 'gist' | 'pinpoint' | 'both', 
    excludes: string[] = [], 
    maxSizeMb: number = 10
  ): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    console.log('🔌 API: indexGitHubRepo called with:', {
      fullName, branch, mode, excludes, maxSizeMb
    });
    
    const result = await this.request<{
      success: boolean;
      message: string;
      error?: string;
    }>('/github/index', 'POST', {
      full_name: fullName,
      branch,
      mode,
      excludes,
      max_size_mb: maxSizeMb
    });
    
    console.log('🔌 API: indexGitHubRepo result:', result);
    return result;
  }

  async syncGitHubRepo(fullName: string, branch: string): Promise<{
    success: boolean;
    message: string;
    files_processed?: number;
    error?: string;
  }> {
    return this.request('/github/sync', 'POST', { full_name: fullName, branch });
  }

  async retryGitHubRepo(fullName: string): Promise<{
    success: boolean;
    message?: string;
    needs_indexing?: boolean;
    repo?: ConnectedRepo;
    error?: string;
  }> {
    return this.request('/github/retry-repo', 'POST', { full_name: fullName });
  }

  async getConnectedRepos(): Promise<{
    repos: ConnectedRepo[];
  }> {
    return this.request('/github/connected-repos');
  }

  async checkGitHubChanges(fullName: string, branch: string): Promise<{
    success: boolean;
    changes: {
      added: string[];
      modified: string[];
      removed: string[];
    };
    total_changes: number;
    has_changes: boolean;
    manifest: {
      repo: string;
      branch: string;
      last_updated: number;
      file_count: number;
      has_manifest: boolean;
    };
    error?: string;
  }> {
    return this.request('/github/changes', 'POST', { full_name: fullName, branch });
  }

  // Branch management methods
  async getIndexedBranches(fullName: string): Promise<{
    success: boolean;
    repository: string;
    branches: Array<{
      name: string;
      gist_chunks: number;
      pinpoint_chunks: number;
      total_chunks: number;
      file_count: number;
      last_indexed: number;
    }>;
    total_branches: number;
  }> {
    return this.request(`/github/branches/indexed?full_name=${encodeURIComponent(fullName)}`);
  }

  async deleteBranchIndex(fullName: string, branch: string, mode: 'gist' | 'pinpoint' | 'both' = 'both'): Promise<{
    success: boolean;
    message: string;
    deleted_counts: {
      gist: number;
      pinpoint: number;
    };
    repository: string;
    branch: string;
  }> {
    return this.request('/github/branches/delete-index', 'POST', {
      full_name: fullName,
      branch,
      mode
    });
  }

  async getBranchIndexStatus(fullName: string, branch: string): Promise<{
    success: boolean;
    repository: string;
    branch: string;
    has_index: boolean;
    chunk_counts: {
      gist: number;
      pinpoint: number;
    };
    total_chunks: number;
    manifest_exists: boolean;
    last_indexed_commit: string | null;
  }> {
    return this.request(`/github/branch/status?full_name=${encodeURIComponent(fullName)}&branch=${encodeURIComponent(branch)}`);
  }

  async checkDirtyTree(fullName: string): Promise<{
    is_dirty: boolean;
    modified_files?: string[];
    untracked_files?: string[];
    error?: string;
  }> {
    return this.request('/github/check-dirty', 'POST', { full_name: fullName });
  }

  // Settings management methods
  async deleteAllData(): Promise<{
    success: boolean;
    message: string;
    error?: string;
  }> {
    return this.request('/delete-all-data', 'POST');
  }
}

export const api = API.getInstance();

// Make api available in console for debugging
(window as any).api = api; 