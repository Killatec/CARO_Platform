import React from 'react';

interface TagPathLabelProps extends React.HTMLAttributes<HTMLSpanElement> {
  tagPath: string;
}

/**
 * TagPathLabel - displays a tag_path with monospace formatting
 */
export function TagPathLabel({ tagPath, className = '', ...props }: TagPathLabelProps): React.ReactElement {
  return (
    <span className={`font-mono text-sm ${className}`} {...props}>
      {tagPath}
    </span>
  );
}
