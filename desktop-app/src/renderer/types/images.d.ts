declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}

declare module '*.gif' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module 'react-file-icon' {
  import * as React from 'react';
  export const defaultStyles: Record<string, any>;
  export interface FileIconProps {
    color?: string;
    labelColor?: string;
    foldColor?: string;
    extension?: string;
    radius?: number;
    [key: string]: any;
  }
  export const FileIcon: React.FC<FileIconProps>;
}
