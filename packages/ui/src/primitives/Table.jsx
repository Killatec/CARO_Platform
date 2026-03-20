import React from 'react';

/**
 * Table primitive - stateless, zero domain knowledge
 */
export function Table({ children, ...props }) {
  // TODO: Implement with Tailwind classes
  return <table {...props}>{children}</table>;
}

export function TableHeader({ children, ...props }) {
  return <thead {...props}>{children}</thead>;
}

export function TableBody({ children, ...props }) {
  return <tbody {...props}>{children}</tbody>;
}

export function TableRow({ children, ...props }) {
  return <tr {...props}>{children}</tr>;
}

export function TableCell({ children, ...props }) {
  return <td {...props}>{children}</td>;
}

export function TableHeaderCell({ children, onClick, sortable = false, ...props }) {
  // TODO: Add sort indicator
  return <th onClick={onClick} {...props}>{children}</th>;
}
