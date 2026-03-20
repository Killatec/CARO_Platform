import React from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHeaderCell, TableCell } from '@caro/ui/primitives';
import { TagPathLabel } from '../shared/TagPathLabel.jsx';
import { JsonViewer } from '../shared/JsonViewer.jsx';
import { useRegistryStore } from '../../stores/useRegistryStore.js';

/**
 * RegistryTable - displays resolved tag registry
 */
export function RegistryTable() {
  const tags = useRegistryStore(state => state.tags);
  const sortField = useRegistryStore(state => state.sortField);
  const sortDirection = useRegistryStore(state => state.sortDirection);
  const setSort = useRegistryStore(state => state.setSort);

  if (tags.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500">
        <p>No tags in registry.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <Table className="w-full">
        <TableHeader>
          <TableRow>
            <TableHeaderCell
              sortable
              onClick={() => setSort('tag_path')}
              className="cursor-pointer hover:bg-gray-100"
            >
              tag_path {sortField === 'tag_path' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHeaderCell>
            <TableHeaderCell
              sortable
              onClick={() => setSort('data_type')}
              className="cursor-pointer hover:bg-gray-100"
            >
              data_type {sortField === 'data_type' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHeaderCell>
            <TableHeaderCell
              sortable
              onClick={() => setSort('is_setpoint')}
              className="cursor-pointer hover:bg-gray-100"
            >
              is_setpoint {sortField === 'is_setpoint' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHeaderCell>
            <TableHeaderCell>meta</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tags.map((tag, idx) => (
            <TableRow key={idx}>
              <TableCell>
                <TagPathLabel tagPath={tag.tag_path} />
              </TableCell>
              <TableCell>{tag.data_type}</TableCell>
              <TableCell>{tag.is_setpoint ? 'true' : 'false'}</TableCell>
              <TableCell>
                <JsonViewer data={tag.meta} compact />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
