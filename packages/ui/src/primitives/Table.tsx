import React from 'react';

export type TableProps = React.TableHTMLAttributes<HTMLTableElement>;
export type TableHeaderProps = React.HTMLAttributes<HTMLTableSectionElement>;
export type TableBodyProps = React.HTMLAttributes<HTMLTableSectionElement>;
export type TableRowProps = React.HTMLAttributes<HTMLTableRowElement>;
export type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement>;

export interface TableHeaderCellProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
}

/**
 * Table primitive - stateless, zero domain knowledge
 */
export const Table: React.FC<TableProps> = ({ children, ...props }) => {
  // TODO: Implement with Tailwind classes
  return <table {...props}>{children}</table>;
};

export const TableHeader: React.FC<TableHeaderProps> = ({ children, ...props }) => (
  <thead {...props}>{children}</thead>
);

export const TableBody: React.FC<TableBodyProps> = ({ children, ...props }) => (
  <tbody {...props}>{children}</tbody>
);

export const TableRow: React.FC<TableRowProps> = ({ children, ...props }) => (
  <tr {...props}>{children}</tr>
);

export const TableCell: React.FC<TableCellProps> = ({ children, ...props }) => (
  <td {...props}>{children}</td>
);

export const TableHeaderCell: React.FC<TableHeaderCellProps> = ({
  children,
  onClick,
  sortable = false,
  ...props
}) => {
  // TODO: Add sort indicator
  return <th onClick={onClick} {...props}>{children}</th>;
};
