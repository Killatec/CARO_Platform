import React, { useState } from 'react';

/**
 * JsonViewer - displays JSON data with expand/collapse
 */
export function JsonViewer({ data, compact = true, className = '', ...props }) {
  const [isExpanded, setIsExpanded] = useState(!compact);

  const compactView = JSON.stringify(data);
  const expandedView = JSON.stringify(data, null, 2);

  return (
    <div className={className} {...props}>
      <pre
        className="text-xs font-mono bg-gray-50 p-2 rounded cursor-pointer hover:bg-gray-100 overflow-x-auto"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? expandedView : compactView}
      </pre>
      {compact && (
        <button
          className="text-xs text-blue-600 hover:text-blue-800 mt-1"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? 'Collapse' : 'Expand'}
        </button>
      )}
    </div>
  );
}
