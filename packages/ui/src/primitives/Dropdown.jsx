import React from 'react';

/**
 * Dropdown primitive - stateless, zero domain knowledge
 */
export function Dropdown({ options = [], value, onChange, placeholder, className = '', disabled = false, ...props }) {
  return (
    <div className={disabled ? 'opacity-50 cursor-not-allowed' : undefined}>
    <select
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={`px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${className}`}
      {...props}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
    </div>
  );
}
