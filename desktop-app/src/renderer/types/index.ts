// API Response Types
export interface IndexingStatus {
  is_indexing: boolean;
  progress: number;
  total_files: number;
  current_file: string;
  message: string;
  chunking_mode?: 'gist' | 'pinpoint';
  indexing_type?: 'local' | 'github' | null;
}

export interface ModelStatus {
  is_loading: boolean;
  progress: number;
  message: string;
  error: unknown;
}

export interface SearchResult {
  file_path: string;
  file_name: string;
  file_type: string;
  confidence: number;
  matches: SearchMatch[];
}

export interface SearchMatch {
  type: 'line' | 'chunk';
  line_number?: number;
  chunk_id?: number;
  chunk_size?: number;
  content: string;
  confidence: number;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  total_files: number;
  total_chunks?: number;
  has_more: boolean;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ConfigResponse {
  enable_granular_chunking: boolean;
  file_level_chunk_size: number;
  top_files_count: number;
  chunks_per_file: number;
  max_chunk_display_length: number;
  skip_hidden_files: boolean;
  skip_system_files: boolean;
  max_file_size_mb: number;
  embedding_model: string;
  gist_embedding_model?: string;
  pinpoint_embedding_model?: string;
  gist_chunk_size?: number;
  pinpoint_chunk_size?: number;
}

export interface MetadataStats {
  total_files: number;
  total_chunks: number;
  mode_stats: Record<string, { files: number; chunks: number }>;
  metadata_file: string;
  db_directory: string;
}

export interface TrackedFile {
  file_path: string;
  file_name: string;
  parent_folder: string;
  file_size: number;
  last_indexed: number;
  status: string;
  is_synced: boolean;
  num_chunks: number;
  chunking_mode: string;
}

export interface TrackedFilesResponse {
  files: TrackedFile[];
  pagination: {
    page: number;
    page_size: number;
    total_files: number;
    total_pages: number;
    has_more: boolean;
  };
  chunking_mode: string;
}

// Component Props Types
export interface SearchBarProps {
  onSearch: (query: string, includeGranular: boolean, chunkingMode: 'gist' | 'pinpoint', filters?: FilterOptions) => void;
  isLoading: boolean;
  darkMode: boolean;
  currentChunkingMode: 'gist' | 'pinpoint';
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  onFolderSelect: () => void;
  // optional keyboard signals
  focusSignal?: number;
  submitSignal?: number;
  clearSignal?: number;
}

export interface SearchResultsProps {
  results: SearchResult[];
  isLoading: boolean;
  onReindex: (filePath: string) => void;
  onToggleGranular: (filePath: string, enable: boolean) => void;
  onOpenFile: (filePath: string) => void;
  darkMode: boolean;
  currentChunkingMode: 'gist' | 'pinpoint';
  hasMore: boolean;
  onLoadMore: () => void;
  isLoadingMore: boolean;
  totalResults: number;
  page: number;
  totalPages: number;
  currentQuery?: string;
  // Empty state action handlers
  onSelectFolders?: () => void;
  onChangeFilters?: () => void;
  // optional keyboard signals
  collapseAllSignal?: number;
  onResultSelected?: (result: SearchResult) => void;
}

export interface FileResultProps {
  result: SearchResult;
  isExpanded: boolean;
  onToggleExpansion: () => void;
  onReindex: (filePath: string) => void;
  onToggleGranular: (filePath: string, enable: boolean) => void;
  onOpenFile: (filePath: string) => void;
  onPreview?: (filePath: string, query?: string) => void;
  darkMode: boolean;
  onSelect?: (result: SearchResult) => void;
}

export interface IndexingStatusProps {
  status: IndexingStatus;
  onSelectFolders: (chunkingMode: 'gist' | 'pinpoint') => void;
  darkMode: boolean;
  currentChunkingMode: 'gist' | 'pinpoint';
}

export interface ProgressBarProps {
  progress: number;
  message: string;
  isVisible: boolean;
  darkMode: boolean;
}

export interface ModelLoadingOverlayProps {
  darkMode: boolean;
  onLoadingComplete: () => void;
  onLoadingError: (error: string) => void;
}

export interface ModelLoadingStatusProps {
  darkMode: boolean;
  onLoadingComplete: () => void;
  onLoadingError: (error: string) => void;
}

// State Types
export interface AppState {
  indexingStatus: IndexingStatus;
  searchResults: SearchResult[];
  isLoading: boolean;
  selectedFolders: string[];
  config: ConfigResponse | null;
  currentChunkingMode: 'gist' | 'pinpoint';
  searchPagination: {
    page: number;
    pageSize: number;
    hasMore: boolean;
    totalResults: number;
    totalPages: number;
    lastQuery: string;
    lastIncludeGranular: boolean;
  };
}

// Filter Types
export interface TimeRangeFilter {
  type: 'all' | 'before' | 'after' | 'range';
  before: string | null;
  after: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface FilterOptions {
  // legacy
  fileTypes: string[];
  timeRange: TimeRangeFilter;
  searchFolder: string | null;
  // GitHub-specific filters
  repos?: string[];
  repoBranches?: { [repo: string]: string[] | 'all' };
  source?: 'local' | 'github' | 'all';
}

// API Request Types
export interface IndexRequest {
  folders: string[];
  chunking_mode: 'gist' | 'pinpoint';
}

export interface SearchRequest {
  query: string;
  include_granular: boolean;
  chunking_mode: 'gist' | 'pinpoint';
  page?: number;
  page_size?: number;
  top_files?: number;
  top_chunks_per_file?: number;
  filters?: FilterOptions;
}

export interface ReindexRequest {
  path: string;
  chunking_mode: 'gist' | 'pinpoint';
}

export interface ToggleGranularRequest {
  file_path: string;
  enable: boolean;
}

// Chunking mode types
export type ChunkingMode = 'gist' | 'pinpoint';

export interface ChunkingModeInfo {
  mode: ChunkingMode;
  name: string;
  description: string;
  chunkSize: number;
  icon: string;
} 

// Saved items / collections
export interface SavedFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface SavedItem {
  id: string;
  file_path: string;
  file_name: string;
  file_type: string;
  addedAt: number;
  folderId?: string; // undefined => no folder
  favorite?: boolean;
  snippet?: string;
}

// GitHub Integration Types
export interface GitHubRepo {
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
}

export interface GitHubAuthStatus {
  connected: boolean;
  user?: {
    login: string;
    name: string;
    avatar_url: string;
  };
}

export type RepoStatus = 'cloning' | 'cloned' | 'indexing' | 'indexed' | 'clone_failed' | 'index_failed';

export interface ConnectedRepo {
  full_name: string;
  local_path: string;
  active_branch: string;
  modes: Array<'gist' | 'pinpoint'>;
  excludes: string[];
  max_size_mb: number;
  status: RepoStatus;
  last_fetch_ts?: number;
  pending_changes?: {
    count: number;
    ahead: number;
    behind: number;
  };
  error_message?: string;
}

export interface GitHubBranch {
  name: string;
  commit: {
    sha: string;
    message: string;
  };
  protected: boolean;
  available_locally?: boolean;
}