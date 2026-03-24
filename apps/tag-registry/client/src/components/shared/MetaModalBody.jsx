import React from 'react';

/**
 * Renders a meta array in a modal: one entry per level, leaf (index 0) to root (last).
 * When dbMeta is provided, highlights changed/added/removed fields (diff mode).
 *
 * @param {Array} meta - Proposed (or current) meta array
 * @param {Array} [dbMeta] - DB meta array for diff highlighting (modified rows only)
 */
export function MetaModalBody({ meta, dbMeta }) {
  if (!Array.isArray(meta) || meta.length === 0) {
    return <p className="text-sm text-gray-500">No meta data.</p>;
  }

  const showDiff = Array.isArray(dbMeta);

  return (
    <>
      {showDiff && (
        <p className="mb-3 text-xs text-gray-500 flex gap-3">
          <span><span className="inline-block w-2 h-2 rounded-full bg-amber-500 mr-1" />changed</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />added</span>
          <span><span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1" />removed</span>
        </p>
      )}
      <ol className="space-y-4 list-none p-0">
        {meta.map((entry, i) => {
          const dbEntry = showDiff ? (dbMeta[i] ?? null) : null;
          const dbFields = dbEntry?.fields ?? {};
          const proposedFields = entry.fields ?? {};

          const removedKeys = dbEntry
            ? Object.keys(dbFields).filter(k => !Object.prototype.hasOwnProperty.call(proposedFields, k))
            : [];

          return (
            <li key={i} className="border border-gray-200 rounded p-3">
              <div className="text-sm font-semibold text-gray-700 mb-2">
                Level {i} ({entry.type ?? '?'}): {entry.name ?? '—'}
              </div>
              {(Object.keys(proposedFields).length > 0 || removedKeys.length > 0) ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {Object.entries(proposedFields).map(([k, v]) => {
                    let valueCls = 'text-gray-900 font-mono';
                    if (showDiff) {
                      if (!Object.prototype.hasOwnProperty.call(dbFields, k)) {
                        valueCls = 'font-mono bg-green-500/25 rounded px-1';
                      } else if (String(v) !== String(dbFields[k])) {
                        valueCls = 'font-mono bg-amber-500/25 rounded px-1';
                      }
                    }
                    return (
                      <React.Fragment key={k}>
                        <dt className="text-gray-500 font-mono">{k}</dt>
                        <dd className={valueCls}>{String(v)}</dd>
                      </React.Fragment>
                    );
                  })}
                  {removedKeys.map(k => (
                    <React.Fragment key={`removed-${k}`}>
                      <dt className="text-gray-400 font-mono line-through">{k}</dt>
                      <dd className="font-mono bg-red-500/15 rounded px-1 text-gray-400 line-through">
                        {String(dbFields[k])}
                      </dd>
                    </React.Fragment>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-gray-400 italic">No fields</p>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
}
