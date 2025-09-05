import React from 'react';

// Base skeleton component for common shimmer animation
const SkeletonBase: React.FC<{ className?: string; children?: React.ReactNode }> = ({ 
  className = '', 
  children 
}) => (
  <div className={`animate-pulse ${className}`}>
    {children}
  </div>
);

// Simple line skeleton
export const SkeletonLine: React.FC<{ 
  width?: string; 
  height?: string; 
  className?: string 
}> = ({ 
  width = 'w-full', 
  height = 'h-4', 
  className = '' 
}) => (
  <SkeletonBase className={className}>
    <div className={`bg-neutral-700 rounded ${width} ${height}`} />
  </SkeletonBase>
);

// Circle skeleton (for avatars, icons)
export const SkeletonCircle: React.FC<{ 
  size?: string; 
  className?: string 
}> = ({ 
  size = 'w-8 h-8', 
  className = '' 
}) => (
  <SkeletonBase className={className}>
    <div className={`bg-neutral-700 rounded-full ${size}`} />
  </SkeletonBase>
);

// Search result skeleton
export const SearchResultSkeleton: React.FC = () => (
  <div className="soft-card p-4 space-y-3">
    <div className="flex items-center space-x-3">
      <SkeletonCircle size="w-5 h-5" />
      <SkeletonLine width="w-1/3" height="h-5" />
      <SkeletonLine width="w-16" height="h-4" />
    </div>
    <div className="pl-8 space-y-2">
      <SkeletonLine width="w-full" height="h-4" />
      <SkeletonLine width="w-3/4" height="h-4" />
      <SkeletonLine width="w-1/2" height="h-4" />
    </div>
    <div className="pl-8 flex items-center space-x-4">
      <SkeletonLine width="w-20" height="h-3" />
      <SkeletonLine width="w-24" height="h-3" />
      <SkeletonLine width="w-16" height="h-3" />
    </div>
  </div>
);

// Search results list skeleton
export const SearchResultsListSkeleton: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center space-x-2">
        <SkeletonLine width="w-16" height="h-6" />
        <SkeletonLine width="w-12" height="h-5" />
      </div>
      <SkeletonLine width="w-20" height="h-5" />
    </div>
    {Array.from({ length: count }, (_, i) => (
      <SearchResultSkeleton key={i} />
    ))}
  </div>
);

// GitHub repository skeleton
export const RepositorySkeleton: React.FC = () => (
  <div className="soft-card p-4">
    <div className="flex items-start justify-between mb-3">
      <div className="flex items-center space-x-3 flex-1">
        <SkeletonCircle size="w-8 h-8" />
        <div className="space-y-2 flex-1">
          <SkeletonLine width="w-48" height="h-5" />
          <SkeletonLine width="w-32" height="h-4" />
        </div>
      </div>
      <SkeletonLine width="w-20" height="h-8" />
    </div>
    <div className="pl-11">
      <SkeletonLine width="w-full" height="h-4" className="mb-3" />
      <div className="flex items-center space-x-4">
        <SkeletonLine width="w-16" height="h-4" />
        <SkeletonLine width="w-20" height="h-4" />
        <SkeletonLine width="w-12" height="h-4" />
      </div>
    </div>
  </div>
);

// Repository list skeleton
export const RepositoryListSkeleton: React.FC<{ count?: number }> = ({ count = 6 }) => (
  <div className="space-y-3">
    {Array.from({ length: count }, (_, i) => (
      <RepositorySkeleton key={i} />
    ))}
  </div>
);

// File tracking skeleton
export const FileTrackingSkeleton: React.FC = () => (
  <div className="soft-card">
    <div className="p-4 border-b border-neutral-700">
      <div className="flex items-center justify-between">
        <SkeletonLine width="w-32" height="h-6" />
        <SkeletonLine width="w-24" height="h-8" />
      </div>
    </div>
    <div className="divide-y divide-neutral-700">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="p-3 flex items-center justify-between">
          <div className="flex items-center space-x-3 flex-1">
            <SkeletonCircle size="w-4 h-4" />
            <div className="space-y-1 flex-1">
              <SkeletonLine width="w-64" height="h-4" />
              <SkeletonLine width="w-32" height="h-3" />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <SkeletonLine width="w-16" height="h-6" />
            <SkeletonLine width="w-8" height="h-6" />
          </div>
        </div>
      ))}
    </div>
  </div>
);

// Settings skeleton
export const SettingsSkeleton: React.FC = () => (
  <div className="space-y-6">
    {Array.from({ length: 4 }, (_, sectionIndex) => (
      <div key={sectionIndex} className="soft-card">
        <div className="p-4 border-b border-neutral-700">
          <div className="flex items-center justify-between">
            <SkeletonLine width="w-40" height="h-6" />
            <SkeletonCircle size="w-5 h-5" />
          </div>
        </div>
        <div className="p-4 space-y-4">
          {Array.from({ length: 3 }, (_, itemIndex) => (
            <div key={itemIndex} className="flex items-center justify-between">
              <div className="space-y-2">
                <SkeletonLine width="w-32" height="h-4" />
                <SkeletonLine width="w-48" height="h-3" />
              </div>
              <SkeletonLine width="w-20" height="h-8" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

// Dashboard stats skeleton
export const DashboardStatsSkeleton: React.FC = () => (
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
    {Array.from({ length: 4 }, (_, i) => (
      <div key={i} className="soft-card p-4">
        <div className="flex items-center space-x-3">
          <SkeletonCircle size="w-10 h-10" />
          <div className="space-y-2">
            <SkeletonLine width="w-8" height="h-6" />
            <SkeletonLine width="w-20" height="h-4" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

// Command palette skeleton
export const CommandPaletteSkeleton: React.FC = () => (
  <div className="space-y-1">
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className="flex items-center space-x-3 px-3 py-2.5">
        <SkeletonCircle size="w-4 h-4" />
        <div className="flex-1 space-y-1">
          <SkeletonLine width="w-32" height="h-4" />
          <SkeletonLine width="w-24" height="h-3" />
        </div>
      </div>
    ))}
  </div>
);

// Generic card skeleton
export const CardSkeleton: React.FC<{ 
  showHeader?: boolean; 
  lines?: number; 
  className?: string 
}> = ({ 
  showHeader = true, 
  lines = 3, 
  className = '' 
}) => (
  <div className={`soft-card ${className}`}>
    {showHeader && (
      <div className="p-4 border-b border-neutral-700">
        <div className="flex items-center justify-between">
          <SkeletonLine width="w-32" height="h-6" />
          <SkeletonLine width="w-16" height="h-5" />
        </div>
      </div>
    )}
    <div className="p-4 space-y-3">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine 
          key={i} 
          width={i === lines - 1 ? 'w-3/4' : 'w-full'} 
          height="h-4" 
        />
      ))}
    </div>
  </div>
);

export default {
  SkeletonLine,
  SkeletonCircle,
  SearchResultSkeleton,
  SearchResultsListSkeleton,
  RepositorySkeleton,
  RepositoryListSkeleton,
  FileTrackingSkeleton,
  SettingsSkeleton,
  DashboardStatsSkeleton,
  CommandPaletteSkeleton,
  CardSkeleton
};