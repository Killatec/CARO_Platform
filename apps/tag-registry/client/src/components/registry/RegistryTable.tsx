import React, { useState, useMemo } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHeaderCell, TableCell, Modal } from '@caro/ui/primitives';
import { TagPathLabel } from '../shared/TagPathLabel.jsx';
import { MetaModalBody } from '../shared/MetaModalBody.jsx';
import { useRegistryStore } from '../../stores/useRegistryStore.js';
import { useTagTypesStore } from '../../stores/useTagTypesStore.js';
import { useModuleTypesStore } from '../../stores/useModuleTypesStore.js';
import type { DiffRow } from '../../utils/diffRegistry.js';

const DIFF_ROW_CLASS: Record<string, string> = {
  added:     'bg-green-500/15',
  unchanged: '',
  retired:   'bg-red-500/15',
};

const MODIFIED_CELL_CLASS = 'bg-amber-500/25';

const COL_BORDER = 'border-r border-black/30';
const ROW_BORDER = 'border-b border-black/30';
const HDR_BORDER = 'border-t border-b border-black/30';

interface MetaModalState {
  tag_path: string;
  meta: unknown;
  dbMeta?: unknown;
}

interface RegistryTableProps {
  rows?: DiffRow[] | null;
}

/**
 * RegistryTable - displays resolved tag registry.
 */
export function RegistryTable({ rows }: RegistryTableProps): React.ReactElement {
  const tags = useRegistryStore(state => state.tags);
  const sortField = useRegistryStore(state => state.sortField);
  const sortDirection = useRegistryStore(state => state.sortDirection);
  const setSort = useRegistryStore(state => state.setSort);

  const displayNameMap = useTagTypesStore(state => state.displayNameMap);
  const moduleDisplayNameMap = useModuleTypesStore(state => state.displayNameMap);

  const [metaModal, setMetaModal] = useState<MetaModalState | null>(null);

  const unsortedRows: DiffRow[] = rows ?? tags.map(t => ({
    ...t,
    module: t.module ?? null,
    module_type: t.module_type ?? null,
    diffStatus: 'unchanged' as const,
  }));

  const displayRows = useMemo(() => {
    const sorted = [...unsortedRows];
    sorted.sort((a, b) => {
      const aRaw = (a as unknown as Record<string, unknown>)[sortField];
      const bRaw = (b as unknown as Record<string, unknown>)[sortField];

      // Numeric comparison for tag_id
      if (sortField === 'tag_id') {
        const aNum = typeof aRaw === 'number' ? aRaw : Infinity;
        const bNum = typeof bRaw === 'number' ? bRaw : Infinity;
        return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
      }

      const aVal = String(aRaw ?? '');
      const bVal = String(bRaw ?? '');
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [unsortedRows, sortField, sortDirection]);

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
            <TableHeaderCell
              sortable
              onClick={() => setSort('tag_id')}
              className={`px-4 w-px whitespace-nowrap text-center cursor-pointer hover:bg-gray-100 ${HDR_BORDER} ${COL_BORDER}`}
            >
              tag_id {sortField === 'tag_id' && (sortDirection === 'asc' ? '↑' : '↓')}
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
              onClick={() => setSort('module')}
              className={`px-4 w-px whitespace-nowrap cursor-pointer hover:bg-gray-100 ${HDR_BORDER} ${COL_BORDER}`}
            >
              module {sortField === 'module' && (sortDirection === 'asc' ? '↑' : '↓')}
            </TableHeaderCell>
            <TableHeaderCell
              sortable
              onClick={() => setSort('module_type')}
              className={`px-4 w-px whitespace-nowrap text-center cursor-pointer hover:bg-gray-100 ${HDR_BORDER} ${COL_BORDER}`}
            >
              module_type {sortField === 'module_type' && (sortDirection === 'asc' ? '↑' : '↓')}
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
            <TableHeaderCell
              sortable
              onClick={() => setSort('trends')}
              className={`px-4 w-px whitespace-nowrap text-center cursor-pointer hover:bg-gray-100 ${HDR_BORDER} ${COL_BORDER}`}
            >
              trends {sortField === 'trends' && (sortDirection === 'asc' ? '↑' : '↓')}
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
            const cellClass = (field: string) =>
              isModified && changed!.has(field) ? MODIFIED_CELL_CLASS : '';

            return (
              <TableRow key={idx} className={DIFF_ROW_CLASS[tag.diffStatus] ?? ''}>
                <TableCell className={`px-4 w-px whitespace-nowrap text-center text-sm ${ROW_BORDER} ${COL_BORDER}`}>
                  {tag.diffStatus === 'added'
                    ? <span className="text-gray-400 italic">new</span>
                    : (tag.tag_id ?? '—')}
                </TableCell>
                <TableCell className={`px-4 w-0 whitespace-nowrap ${ROW_BORDER} ${COL_BORDER} ${cellClass('tag_path')}`}>
                  <TagPathLabel tagPath={tag.tag_path} />
                </TableCell>
                <TableCell className={`px-4 w-px whitespace-nowrap text-center ${ROW_BORDER} ${COL_BORDER} ${cellClass('module')}`}>
                  {tag.module ?? '—'}
                </TableCell>
                <TableCell className={`px-4 w-px whitespace-nowrap text-center ${ROW_BORDER} ${COL_BORDER} ${cellClass('module_type')}`}>
                  {tag.module_type ? (moduleDisplayNameMap.get(tag.module_type) ?? tag.module_type) : '—'}
                </TableCell>
                <TableCell className={`px-4 w-px whitespace-nowrap text-center ${ROW_BORDER} ${COL_BORDER} ${cellClass('data_type')}`}>
                  {displayNameMap.get(tag.data_type) ?? tag.data_type}
                </TableCell>
                <TableCell className={`px-4 w-px whitespace-nowrap text-center ${ROW_BORDER} ${COL_BORDER} ${cellClass('is_setpoint')}`}>
                  {tag.is_setpoint ? 'true' : 'false'}
                </TableCell>
                <TableCell className={`px-4 w-px whitespace-nowrap text-center ${ROW_BORDER} ${COL_BORDER} ${cellClass('trends')}`}>
                  {tag.trends ? 'true' : 'false'}
                </TableCell>
                <TableCell className={`px-4 w-px whitespace-nowrap text-center ${ROW_BORDER} ${cellClass('meta')}`}>
                  <button
                    onClick={() => setMetaModal({
                      tag_path: tag.tag_path,
                      meta: tag.meta,
                      dbMeta: tag.diffStatus === 'modified' && tag.changedFields?.includes('meta')
                        ? tag.dbMeta
                        : undefined,
                    })}
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
        <MetaModalBody
          meta={metaModal?.meta as Parameters<typeof MetaModalBody>[0]['meta']}
          dbMeta={metaModal?.dbMeta as Parameters<typeof MetaModalBody>[0]['dbMeta']}
        />
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
