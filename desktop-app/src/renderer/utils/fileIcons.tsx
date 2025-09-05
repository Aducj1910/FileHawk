import React from 'react';
import { FileIcon, defaultStyles } from 'react-file-icon';
import { FileText, Code, Image as ImageIcon, Music, Video, Archive, FileJson, FileType, FileSpreadsheet, FileSpreadsheet as Spreadsheet, File } from 'lucide-react';

interface FileGlyphProps {
  fileName?: string;
  extension?: string; // with or without leading dot
  size?: number; // px
  className?: string;
}

function getExtensionFromName(fileName?: string, extension?: string): string {
  if (extension && extension.length > 0) {
    return extension.startsWith('.') ? extension.slice(1).toLowerCase() : extension.toLowerCase();
  }
  if (!fileName) return '';
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) return '';
  return fileName.slice(lastDot + 1).toLowerCase();
}

// Minimal color overrides for a clean, neutral look
const neutralOverrides: Record<string, Partial<typeof defaultStyles[keyof typeof defaultStyles]>> = {
  pdf: { color: '#ef4444', labelColor: '#0b0e12', foldColor: '#1f2937' },
  docx: { color: '#3b82f6', labelColor: '#0b0e12', foldColor: '#1f2937' },
  doc: { color: '#3b82f6', labelColor: '#0b0e12', foldColor: '#1f2937' },
  xlsx: { color: '#10b981', labelColor: '#0b0e12', foldColor: '#1f2937' },
  xls: { color: '#10b981', labelColor: '#0b0e12', foldColor: '#1f2937' },
  csv: { color: '#10b981', labelColor: '#0b0e12', foldColor: '#1f2937' },
  pptx: { color: '#f97316', labelColor: '#0b0e12', foldColor: '#1f2937' },
  ppt: { color: '#f97316', labelColor: '#0b0e12', foldColor: '#1f2937' },
  png: { color: '#64748b', labelColor: '#0b0e12', foldColor: '#1f2937' },
  jpg: { color: '#64748b', labelColor: '#0b0e12', foldColor: '#1f2937' },
  jpeg: { color: '#64748b', labelColor: '#0b0e12', foldColor: '#1f2937' },
  gif: { color: '#64748b', labelColor: '#0b0e12', foldColor: '#1f2937' },
  svg: { color: '#64748b', labelColor: '#0b0e12', foldColor: '#1f2937' },
  json: { color: '#22d3ee', labelColor: '#0b0e12', foldColor: '#1f2937' },
  md: { color: '#94a3b8', labelColor: '#0b0e12', foldColor: '#1f2937' },
  txt: { color: '#94a3b8', labelColor: '#0b0e12', foldColor: '#1f2937' },
  html: { color: '#f59e0b', labelColor: '#0b0e12', foldColor: '#1f2937' },
  css: { color: '#0ea5e9', labelColor: '#0b0e12', foldColor: '#1f2937' },
  scss: { color: '#ec4899', labelColor: '#0b0e12', foldColor: '#1f2937' },
  js: { color: '#facc15', labelColor: '#0b0e12', foldColor: '#1f2937' },
  ts: { color: '#3b82f6', labelColor: '#0b0e12', foldColor: '#1f2937' },
  jsx: { color: '#22d3ee', labelColor: '#0b0e12', foldColor: '#1f2937' },
  tsx: { color: '#22d3ee', labelColor: '#0b0e12', foldColor: '#1f2937' },
  py: { color: '#f59e0b', labelColor: '#0b0e12', foldColor: '#1f2937' },
  rb: { color: '#ef4444', labelColor: '#0b0e12', foldColor: '#1f2937' },
  go: { color: '#38bdf8', labelColor: '#0b0e12', foldColor: '#1f2937' },
  rs: { color: '#f97316', labelColor: '#0b0e12', foldColor: '#1f2937' },
  sh: { color: '#22c55e', labelColor: '#0b0e12', foldColor: '#1f2937' },
  sql: { color: '#a78bfa', labelColor: '#0b0e12', foldColor: '#1f2937' },
  zip: { color: '#a855f7', labelColor: '#0b0e12', foldColor: '#1f2937' },
  gz: { color: '#a855f7', labelColor: '#0b0e12', foldColor: '#1f2937' },
  tar: { color: '#a855f7', labelColor: '#0b0e12', foldColor: '#1f2937' }
};

export const FileGlyph: React.FC<FileGlyphProps> = ({ fileName, extension, size = 22, className = '' }) => {
  const ext = getExtensionFromName(fileName, extension);

  if (!ext) {
    return <File className={className} size={size} strokeWidth={1.75} />;
  }

  // For code-like files, fallback to clean line icons for visual consistency in compact lists
  const codeLike = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'cs'];
  const mediaLike = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
  const audioLike = ['mp3', 'wav', 'flac'];
  const videoLike = ['mp4', 'mov', 'avi'];
  const archiveLike = ['zip', 'gz', 'tar', 'rar', '7z'];

  if (codeLike.includes(ext)) return <Code className={className} size={size} strokeWidth={1.75} />;
  if (mediaLike.includes(ext)) return <ImageIcon className={className} size={size} strokeWidth={1.75} />;
  if (audioLike.includes(ext)) return <Music className={className} size={size} strokeWidth={1.75} />;
  if (videoLike.includes(ext)) return <Video className={className} size={size} strokeWidth={1.75} />;
  if (archiveLike.includes(ext)) return <Archive className={className} size={size} strokeWidth={1.75} />;
  if (ext === 'json') return <FileJson className={className} size={size} strokeWidth={1.75} />;

  try {
    const style = (defaultStyles as any)[ext] || {};
    const overrides = neutralOverrides[ext] || {};
    return (
      <div style={{ width: size, height: size }} className={className}>
        <FileIcon extension={ext} {...style} {...overrides} radius={2} />
      </div>
    );
  } catch (e) {
    return <FileText className={className} size={size} strokeWidth={1.75} />;
  }
};

export default FileGlyph;


