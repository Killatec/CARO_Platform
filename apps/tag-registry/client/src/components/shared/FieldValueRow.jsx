import React from 'react';
import { Input } from '@caro/ui/primitives';

/**
 * FieldValueRow - displays a field name/value pair with type-aware formatting.
 * Override values show colored left border + bold.
 */
export function FieldValueRow({ fieldName, value, dataType, isOverride = false, onChange, onDelete, readOnly = false, className = '', ...props }) {
  const borderClass = isOverride ? 'border-l-4 border-l-blue-500 pl-3' : '';
  const fontClass = isOverride ? 'font-semibold' : '';

  return (
    <div className={`flex items-center gap-4 py-2 ${borderClass} ${className}`} {...props}>
      <label className="w-32 text-sm font-medium text-gray-700">{fieldName}</label>
      <Input
        type="text"
        value={value ?? ''}
        onChange={onChange}
        disabled={readOnly}
        className={`w-[20ch] ${fontClass}`}
      />
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          title={`Delete field "${fieldName}"`}
          className="ml-1 p-1 text-gray-400 hover:text-red-500 transition-colors rounded"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </button>
      )}
    </div>
  );
}
