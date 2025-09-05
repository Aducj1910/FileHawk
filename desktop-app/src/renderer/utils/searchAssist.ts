export interface SearchHistoryItem {
  query: string;
  ts: number;
}

const HISTORY_KEY = 'filehawk-search-history-v1';
const SUGGESTIONS_ENABLED_KEY = 'filehawk-enable-suggestions';
const HISTORY_MAX = 100;

export function loadHistory(): SearchHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as SearchHistoryItem[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveHistory(list: SearchHistoryItem[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
}

export function addHistory(query: string): void {
  const trimmed = query.trim();
  if (!trimmed) return;
  const list = loadHistory();
  const withoutDup = list.filter((i) => i.query !== trimmed);
  withoutDup.unshift({ query: trimmed, ts: Date.now() });
  saveHistory(withoutDup);
}

export function clearHistory(): void {
  saveHistory([]);
}

export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
}

export function isSuggestionsEnabled(): boolean {
  const raw = localStorage.getItem(SUGGESTIONS_ENABLED_KEY);
  if (raw === null) return true; // default on
  return raw === 'true';
}

export function setSuggestionsEnabled(enabled: boolean): void {
  localStorage.setItem(SUGGESTIONS_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function getSemanticSuggestions(input: string): string[] {
  const q = input.trim();
  const basis: string[] = [];
  if (!q) {
    // generic helpful suggestions
    return [
      'recent changes in project',
      'error stack traces last week',
      'API request examples',
      'database connection settings',
      'README or docs about setup',
    ];
  }
  // Heuristic completions to guide the user
  basis.push(`${q} in code files`);
  basis.push(`${q} in docs (md, pdf, docx)`);
  basis.push(`${q} from last week`);
  basis.push(`${q} examples`);
  basis.push(`${q} configuration`);
  return basis;
}


