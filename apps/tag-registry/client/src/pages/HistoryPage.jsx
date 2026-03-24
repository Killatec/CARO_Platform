import React, { useEffect, useState } from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHeaderCell, TableCell } from '@caro/ui/primitives';
import { fetchRevisions } from '../api/registry.js';
import { formatDateTime } from '../utils/formatDate.js';

const COL_BORDER = 'border-r border-black/30';
const ROW_BORDER = 'border-b border-black/30';
const HDR_BORDER = 'border-t border-b border-black/30';

export function HistoryPage() {
  const [revisions, setRevisions]               = useState([]);
  const [revisionsLoading, setRevisionsLoading] = useState(true);
  const [revisionsError, setRevisionsError]     = useState(null);

  useEffect(() => {
    fetchRevisions()
      .then(data => { setRevisions(data); setRevisionsLoading(false); })
      .catch(err => { setRevisionsError(err.message || 'Failed to load revisions'); setRevisionsLoading(false); });
  }, []);

  return (
    <div className="p-4">
      {revisionsError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-3">
          {revisionsError}
        </div>
      )}

      {revisionsLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {!revisionsLoading && !revisionsError && revisions.length === 0 && (
        <p className="text-sm text-gray-400">No revisions found.</p>
      )}

      {!revisionsLoading && revisions.length > 0 && (
        <div className="border border-black/30 rounded-sm w-fit">
          <Table className="w-auto table-auto">
            <TableHeader>
              <TableRow>
                <TableHeaderCell className={`px-4 w-px whitespace-nowrap text-right ${HDR_BORDER} ${COL_BORDER}`}>
                  rev
                </TableHeaderCell>
                <TableHeaderCell className={`px-4 w-px whitespace-nowrap ${HDR_BORDER} ${COL_BORDER}`}>
                  applied_by
                </TableHeaderCell>
                <TableHeaderCell className={`px-4 w-px whitespace-nowrap ${HDR_BORDER} ${COL_BORDER}`}>
                  applied_at
                </TableHeaderCell>
                <TableHeaderCell className={`px-4 ${HDR_BORDER}`}>
                  comment
                </TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revisions.map(r => (
                <TableRow key={r.registry_rev}>
                  <TableCell className={`px-4 w-px whitespace-nowrap text-right text-sm text-gray-500 ${ROW_BORDER} ${COL_BORDER}`}>
                    {r.registry_rev}
                  </TableCell>
                  <TableCell className={`px-4 w-px whitespace-nowrap text-sm ${ROW_BORDER} ${COL_BORDER}`}>
                    {r.applied_by}
                  </TableCell>
                  <TableCell className={`px-4 w-px whitespace-nowrap text-sm text-gray-500 ${ROW_BORDER} ${COL_BORDER}`}>
                    {formatDateTime(r.applied_at)}
                  </TableCell>
                  <TableCell className={`px-4 text-sm ${ROW_BORDER}`}>
                    {r.comment}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
