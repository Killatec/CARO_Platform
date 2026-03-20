import React from 'react';

/**
 * TagPathLabel - displays a tag_path with monospace formatting
 */
export function TagPathLabel({ tagPath, className = '', ...props }) {
  return (
    <span className={`font-mono text-sm ${className}`} {...props}>
      {tagPath}
    </span>
  );
}
