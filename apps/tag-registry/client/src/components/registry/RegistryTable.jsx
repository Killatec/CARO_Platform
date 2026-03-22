import React, { useState } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHeaderCell, TableCell, Modal } from '@caro/ui/primitives';
import { TagPathLabel } from '../shared/TagPathLabel.jsx';
import { useRegistryStore } from '../../stores/useRegistryStore.js';

const DIFF_ROW_CLASS = {
  added:     'bg-green-500/15',
  unchanged: '',
  retired:   'bg-red-500/15',
};

const MODIFIED_CELL_CLASS = 'bg-amber-500/25';

// Shared cell borders
const COL_BORDER = 'border-r border-black/30';       // vertical divider (all cols except last)
const ROW_BORDER = 'border-b border-black/30';       // horizontal divider (all cells)
const HDR_BORDER = 'border-t border-b border-black/30'; // header: top + bottom

/**
 * Renders the meta array in the modal: one entry per level, leaf (index 0) to root (last).
 */
function MetaModalBody({ meta }) {
  if (!Array.isArray(meta) || meta.length === 0) {
    return <p className="text-sm text-gray-500">No meta data.</p>;
  }
  return (
    <ol className="space-y-4 list-none p-0">
      {meta.map((entry, i) => (
        <li key={i} className="border border-gray-200 rounded p-3">
          <div className="text-sm font-semibold text-gray-700 mb-2">
            Level {i} ({entry.type ?? '?'}): {entry.name ?? '—'}
          </div>
          {entry.fields && Object.keys(entry.fields).length > 0 ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {Object.entries(entry.fields).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-gray-500 font-mono">{k}</dt>
                  <dd className="text-gray-900 font-mono">{String(v)}</dd>
                </React.Fragment>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-gray-400 italic">No fields</p>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * RegistryTable - displays resolved tag registry.
 *
 * @param {Array|null} rows - Optional diff rows (each with a `diffStatus` field).
 *   When null/undefined, falls back to the store's `tags` without diff coloring.
 */
export function RegistryTable({ rows }) {
  const tags = useRegistryStore(state => state.tags);
  const sortField = useRegistryStore(state => state.sortField);
  const sortDirection = useRegistryStore(state => state.sortDirection);
  const setSort = useRegistryStore(state => state.setSort);

  const [metaModal, setMetaModal] = useState(null); // { tag_path, meta }

  const displayRows = rows ?? tags.map(t => ({ ...t, diffStatus: 'unchanged' }));

  if (displayRows.length === 0) {
    return (
      <div className="p-6 text-center text-gray-500">
        <p>No tags in registry.</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="border border-black/30 rounded-sm w-fit">
      <Table className="w-auto table-auto">
        <TableHeader>
          <TableRow>
            <TableHeaderCell className={`px-4 w-px whitespace-nowrap text-right ${HDR_BORDER} ${COL_BORDER}`}>
              tag_id
            </TableHeaderCell>
            <TableHeaderCell
              sortable
              onClick={() => setSort('tag_path')}
              className={`px-4 w-0 whitespace-nowrap cursor-pointer hover:bg-gray-100 ${HDR_BORDER} ${COL_BORDER}`}
            >
              tag_path {sortField === 'tag_path' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHeaderCell>
            <TableHeaderCell
              sortable
              onClick={() => setSort('data_type')}
              className={`px-4 w-px whitespace-nowrap text-center cursor-pointer hover:bg-gray-100 ${HDR_BORDER} ${COL_BORDER}`}
            >
              data_type {sortField === 'data_type' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHeaderCell>
            <TableHeaderCell
              sortable
              onClick={() => setSort('is_setpoint')}
              className={`px-4 w-px whitespace-nowrap text-center cursor-pointer hover:bg-gray-100 ${HDR_BORDER} ${COL_BORDER}`}
            >
              is_setpoint {sortField === 'is_setpoint' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHeaderCell>
            <TableHeaderCell className={`px-4 w-px whitespace-nowrap text-center ${HDR_BORDER}`}>
              meta
            </TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayRows.map((tag, idx) => {
            const isModified = tag.diffStatus === 'modified';
            const changed = isModified ? new Set(tag.changedFields ?? []) : null;
            const cellClass = (field) =>
              isModified && changed.has(field) ? MODIFIED_CELL_CLASS : '';

            return (
              <TableRow key={idx} className={DIFF_ROW_CLASS[tag.diffStatus] ?? ''}>
                <TableCell className={`px-4 w-px whitespace-nowrap text-right text-sm text-gray-500 ${ROW_BORDER} ${COL_BORDER}`}>
                  {tag.diffStatus === 'added'
                    ? <span className="text-gray-400 italic">new</span>
                    : (tag.tag_id ?? '—')}
                </TableCell>
                <TableCell className={`px-4 w-0 whitespace-nowrap ${ROW_BORDER} ${COL_BORDER} ${cellClass('tag_path')}`}>
                  <TagPathLabel tagPath={tag.tag_path} />
                </TableCell>
                <TableCell className={`px-4 w-px whitespace-nowrap text-center ${ROW_BORDER} ${COL_BORDER} ${cellClass('data_type')}`}>
                  {tag.data_type}
                </TableCell>
                <TableCell className={`px-4 w-px whitespace-nowrap text-center ${ROW_BORDER} ${COL_BORDER} ${cellClass('is_setpoint')}`}>
                  {tag.is_setpoint ? 'true' : 'false'}
                </TableCell>
                <TableCell className={`px-4 w-px whitespace-nowrap text-center ${ROW_BORDER} ${cellClass('meta')}`}>
                  <button
                    onClick={() => setMetaModal({ tag_path: tag.tag_path, meta: tag.meta })}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    View
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>

      <Modal
        isOpen={metaModal !== null}
        onClose={() => setMetaModal(null)}
        title={metaModal?.tag_path}
      >
        <MetaModalBody meta={metaModal?.meta} />
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => setMetaModal(null)}
            className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            Close
          </button>
        </div>
      </Modal>
    </div>
  );
}
