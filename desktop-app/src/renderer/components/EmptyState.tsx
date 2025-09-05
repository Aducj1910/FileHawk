import React from 'react';
import { Search, FolderOpen, Filter, RefreshCw, Plus, BookOpen } from 'lucide-react';
import GoldButton from '../ui/GoldButton';

interface ActionButton {
  label: string;
  onClick: () => void;
  variant?: 'solid' | 'ghost' | 'chip';
  icon?: React.ReactNode;
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actions?: ActionButton[];
  suggestions?: string[];
  className?: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actions = [],
  suggestions = [],
  className = ''
}) => {
  const defaultIcon = <Search size={32} className="opacity-50" />;

  return (
    <div className={`soft-card ${className}`}>
      <div className="p-8 text-center">
        {/* Icon */}
        <div className="mb-4" style={{ color: 'var(--fg-muted)' }}>
          {icon || defaultIcon}
        </div>

        {/* Title */}
        <h3 className="text-base font-medium mb-2" style={{ color: 'var(--fg-primary)' }}>
          {title}
        </h3>

        {/* Description */}
        <p className="text-[12px] mb-6 leading-relaxed max-w-md mx-auto" style={{ color: 'var(--fg-muted)' }}>
          {description}
        </p>

        {/* Action Buttons */}
        {actions.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
            {actions.map((action, index) => (
              <GoldButton
                key={index}
                variant={action.variant || 'ghost'}
                size="sm"
                onClick={action.onClick}
                className="inline-flex items-center space-x-2"
              >
                {action.icon}
                <span>{action.label}</span>
              </GoldButton>
            ))}
          </div>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <div className="border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <h4 className="text-[11px] font-medium mb-2 uppercase tracking-wide" style={{ color: 'var(--fg-muted)' }}>
              Try this instead
            </h4>
            <ul className="space-y-1">
              {suggestions.map((suggestion, index) => (
                <li key={index} className="text-[11px]" style={{ color: 'var(--fg-secondary)' }}>
                  • {suggestion}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

// Predefined empty state configurations for common scenarios
export const EmptyStates = {
  noSearchResults: (onReindex: () => void, onChangeFilters: () => void, onSelectFolders: () => void, currentQuery?: string) => ({
    icon: <Search size={32} className="opacity-50" />,
    title: "No results found",
    description: currentQuery 
      ? `No files match "${currentQuery}". Try adjusting your search terms or check if the relevant files are indexed.`
      : "No files match your search. Try adjusting your search terms or check if the relevant files are indexed.",
    actions: [
      {
        label: "Change Filters",
        onClick: onChangeFilters,
        variant: 'ghost' as const,
        icon: <Filter size={14} />
      },
      {
        label: "Reindex Files",
        onClick: onReindex,
        variant: 'ghost' as const,
        icon: <RefreshCw size={14} />
      },
      {
        label: "Select Folders",
        onClick: onSelectFolders,
        variant: 'ghost' as const,
        icon: <FolderOpen size={14} />
      }
    ],
    suggestions: [
      "try broader search terms or remove filters",
      "check if files are in indexed folders",
      "make sure file types aren't excluded"
    ]
  }),

  noIndexedFiles: (onSelectFolders: () => void) => ({
    icon: <FolderOpen size={32} className="opacity-50" />,
    title: "No files indexed",
    description: "select folders to index and filefinder will analyze your files to make them searchable.",
    actions: [
      {
        label: "select folders to index",
        onClick: onSelectFolders,
        variant: 'solid' as const,
        icon: <Plus size={14} />
      }
    ],
    suggestions: [
      "choose folders with documents, code, or text files",
      "avoid system folders and temp directories",
      "you can add more folders later"
    ]
  }),

  noConnectedRepos: (onConnectRepo: () => void, onRefreshAuth: () => void) => ({
    icon: <BookOpen size={32} className="opacity-50" />,
    title: "No repositories connected",
    description: "connect your github repos to search across your codebase.",
    actions: [
      {
        label: "connect repository",
        onClick: onConnectRepo,
        variant: 'solid' as const,
        icon: <Plus size={14} />
      },
      {
        label: "refresh connection",
        onClick: onRefreshAuth,
        variant: 'ghost' as const,
        icon: <RefreshCw size={14} />
      }
    ],
    suggestions: [
      "Choose active repositories with code you search frequently",
      "Private repositories require authentication",
      "You can disconnect repositories anytime"
    ]
  }),

  emptySearchHistory: (onTrySampleSearch: (query: string) => void) => ({
    icon: <Search size={32} className="opacity-50" />,
    title: "No search history",
    description: "Your recent searches will appear here. Try searching for files, functions, or concepts to get started.",
    actions: [
      {
        label: "Search for functions",
        onClick: () => onTrySampleSearch("function"),
        variant: 'ghost' as const,
        icon: <Search size={14} />
      },
      {
        label: "Search for components",
        onClick: () => onTrySampleSearch("component"),
        variant: 'ghost' as const,
        icon: <Search size={14} />
      }
    ],
    suggestions: [
      "Try searching for code concepts like 'authentication'",
      "Search for file types like 'configuration files'",
      "Use natural language like 'how to connect database'"
    ]
  })
};

export default EmptyState;