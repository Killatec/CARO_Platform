import React from 'react';

/**
 * Input primitive - stateless, zero domain knowledge
 */
export function Input({ type = 'text', value, onChange, placeholder, disabled = false, className = '', ...props }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
      className={`px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500 ${className}`}
      {...props}
    />
  );
}
