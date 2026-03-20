import React from 'react';

/**
 * CascadeDiffContent - shared diff display for cascade modals.
 * affectedParents shape: { parent_template_name, asset_name, dropped_instance_values }
 */
export function CascadeDiffContent({ diff = {}, affectedParents = [], newTemplates = [], childrenChanged = [], pendingDeletions = [] }) {
  return (
    <div className="space-y-4">
      {newTemplates.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm text-purple-700">New Templates:</h4>
          <ul className="text-sm list-disc ml-5">
            {newTemplates.map((t, i) => (
              <li key={i}>{t.template_name} <span className="text-gray-500">({t.template_type})</span></li>
            ))}
          </ul>
        </div>
      )}

      {childrenChanged.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm text-indigo-700">Children Added / Removed:</h4>
          <div className="space-y-2 mt-1">
            {childrenChanged.map((entry, i) => (
              <div key={i}>
                <p className="text-sm font-medium text-gray-700 ml-2">{entry.template_name}</p>
                <ul className="text-sm ml-5">
                  {entry.added.map((c, j) => (
                    <li key={`a${j}`} className="text-green-700">+ {c.asset_name} <span className="text-gray-500">({c.template_name})</span></li>
                  ))}
                  {entry.removed.map((c, j) => (
                    <li key={`r${j}`} className="text-red-700">− {c.asset_name} <span className="text-gray-500">({c.template_name})</span></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingDeletions.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm text-red-700">Pending Deletions:</h4>
          <ul className="text-sm list-disc ml-5">
            {pendingDeletions.map((t, i) => (
              <li key={i}>{t.template_name} <span className="text-gray-500">({t.template_type})</span></li>
            ))}
          </ul>
        </div>
      )}

      {diff.fields_added && diff.fields_added.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm text-green-700">Fields Added:</h4>
          <ul className="text-sm list-disc ml-5">
            {diff.fields_added.map((f, i) => (
              <li key={i}>{f.template_name}: {f.field}</li>
            ))}
          </ul>
        </div>
      )}

      {diff.fields_removed && diff.fields_removed.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm text-red-700">Fields Removed:</h4>
          <ul className="text-sm list-disc ml-5">
            {diff.fields_removed.map((f, i) => (
              <li key={i}>{f.template_name}: {f.field}</li>
            ))}
          </ul>
        </div>
      )}

      {diff.fields_changed && diff.fields_changed.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm text-yellow-700">Fields Changed:</h4>
          <ul className="text-sm list-disc ml-5">
            {diff.fields_changed.map((f, i) => (
              <li key={i}>{f.template_name}: {f.field} ({String(f.old_value)} → {String(f.new_value)})</li>
            ))}
          </ul>
        </div>
      )}

      {diff.instance_fields_changed && diff.instance_fields_changed.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm text-blue-700">Instance Overrides Changed:</h4>
          <ul className="text-sm list-disc ml-5">
            {diff.instance_fields_changed.map((f, i) => (
              <li key={i}>{f.template_name} / {f.asset_name}: {f.field} ({String(f.old_value)} → {String(f.new_value)})</li>
            ))}
          </ul>
        </div>
      )}

      {affectedParents.length > 0 && (
        <div>
          <h4 className="font-semibold text-sm text-orange-700">Affected Instances:</h4>
          <ul className="text-sm list-disc ml-5">
            {affectedParents.map((p, i) => {
              const dropCount = p.dropped_instance_values?.length || 0;
              return (
                <li key={i}>
                  {p.parent_template_name} / {p.asset_name}
                  {dropCount > 0 && (
                    <> — {dropCount} override{dropCount !== 1 ? 's' : ''} will be dropped</>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {newTemplates.length === 0 && childrenChanged.length === 0 && pendingDeletions.length === 0 && diff.fields_added?.length === 0 && diff.fields_removed?.length === 0 && diff.fields_changed?.length === 0 && diff.instance_fields_changed?.length === 0 && (
        <p className="text-sm text-gray-500">No changes detected.</p>
      )}
    </div>
  );
}
