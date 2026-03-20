import React from 'react';
import { SeverityBadge } from './SeverityBadge.jsx';

/**
 * ValidationPanel - displays validation errors and warnings
 * Hidden when messages array is empty
 */
export function ValidationPanel({ messages = [] }) {
  const sortedMessages = [...messages].sort((a, b) => {
    if (a.severity === 'error' && b.severity !== 'error') return -1;
    if (a.severity !== 'error' && b.severity === 'error') return 1;
    return 0;
  });

  return (
    <div className="bg-white border-t border-gray-200">
      <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
        Validation
      </div>
      {sortedMessages.length > 0 && (
        <div className="p-3 space-y-2">
          {sortedMessages.map((msg, idx) => (
            <div key={idx} className="flex items-start gap-2 text-sm">
              <SeverityBadge severity={msg.severity} />
              <span className="font-mono text-xs text-gray-600">{msg.code}</span>
              <span className="flex-1">{msg.message}</span>
              {msg.ref && (
                <span className="text-xs text-gray-500">
                  {msg.ref.template_name || msg.ref.field || msg.ref.tag_path}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
