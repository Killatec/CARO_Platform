import React from 'react';

/**
 * Badge primitive - stateless, zero domain knowledge
 */
export function Badge({ children, variant = 'default', className = '', ...props }) {
  const baseClasses = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';

  const variantClasses = {
    default: 'bg-gray-100 text-gray-800',
    error: 'bg-red-100 text-red-800',
    warning: 'bg-amber-100 text-amber-800',
    success: 'bg-green-100 text-green-800',
    info: 'bg-blue-100 text-blue-800'
  };

  return (
    <span className={`${baseClasses} ${variantClasses[variant]} ${className}`} {...props}>
      {children}
    </span>
  );
}
