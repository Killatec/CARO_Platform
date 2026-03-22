import React, { useEffect, useState } from 'react';
import { RegistryTable } from '../components/registry/RegistryTable.jsx';
import { ValidationPanel } from '../components/shared/ValidationPanel.jsx';
import { useTemplateGraphStore } from '../stores/useTemplateGraphStore.js';
import { useRegistryStore } from '../stores/useRegistryStore.js';
import { useValidation } from '../hooks/useValidation.js';
import { resolveRegistry } from '../../../shared/index.js';
import { fetchRegistry } from '../api/registry.js';
import { diffRegistry } from '../utils/diffRegistry.js';

/**
 * RegistryPage - displays resolved tag registry with optional diff against DB
 */
export function RegistryPage() {
  const templateMap = useTemplateGraphStore(state => state.templateMap);
  const rootTemplateName = useTemplateGraphStore(state => state.rootTemplateName);
  const setTags = useRegistryStore(state => state.setTags);

  const { messages, isValid } = useValidation(templateMap, rootTemplateName);

  // Diff state
  const [diffRows, setDiffRows] = useState(null);
  const [dbError, setDbError] = useState(null);

  useEffect(() => {
    if (!rootTemplateName || !templateMap || templateMap.size === 0) {
      setTags([]);
      setDiffRows(null);
      return;
    }

    if (!isValid) {
      setTags([]);
      setDiffRows(null);
      return;
    }

    const proposed = resolveRegistry(templateMap, rootTemplateName);
    setTags(proposed);

    // Fetch DB registry and compute diff
    setDbError(null);
    fetchRegistry()
      .then(dbTags => {
        setDiffRows(diffRegistry(proposed, dbTags));
      })
      .catch(err => {
        setDbError(err.message || 'Failed to load database registry');
        setDiffRows(null);
      });
  }, [templateMap, rootTemplateName, isValid, setTags]);

  if (!rootTemplateName) {
    return (
      <div className="w-fit flex flex-col overflow-auto p-6 text-center text-gray-500">
        <p>Select a root template from the dropdown above to view the registry.</p>
      </div>
    );
  }

  if (!isValid) {
    return (
      <div className="w-fit flex flex-col overflow-auto p-6 text-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-lg font-semibold text-red-900 mb-2">
            Resolve errors to view registry
          </h3>
          <p className="text-sm text-red-700">
            The template graph has validation errors. Please fix them in the Editor before viewing the registry.
          </p>
        </div>
        <ValidationPanel messages={messages} />
      </div>
    );
  }

  // Diff summary counts
  const diffSummary = diffRows
    ? ['added', 'modified', 'unchanged', 'retired'].reduce((acc, s) => {
        acc[s] = diffRows.filter(r => r.diffStatus === s).length;
        return acc;
      }, {})
    : null;

  return (
    <div className="w-fit flex flex-col overflow-auto">
      {dbError && (
        <div className="mx-4 mt-4 bg-amber-50 border border-amber-300 rounded p-3 text-sm text-amber-800">
          DB registry unavailable — showing proposed registry without diff. ({dbError})
        </div>
      )}
      {diffSummary && (
        <div className="mx-4 mt-4 text-sm text-gray-600 flex gap-4">
          {diffSummary.added > 0 && (
            <span className="text-green-700 font-medium">+{diffSummary.added} added</span>
          )}
          {diffSummary.modified > 0 && (
            <span className="text-amber-700 font-medium">~{diffSummary.modified} modified</span>
          )}
          {diffSummary.unchanged > 0 && (
            <span>{diffSummary.unchanged} unchanged</span>
          )}
          {diffSummary.retired > 0 && (
            <span className="text-red-700 font-medium">-{diffSummary.retired} retired</span>
          )}
        </div>
      )}
      {/* TODO Phase 2: Add "Apply to DB" button here once apply workflow is implemented */}
      <RegistryTable rows={diffRows} />
      <ValidationPanel messages={messages} />
    </div>
  );
}
