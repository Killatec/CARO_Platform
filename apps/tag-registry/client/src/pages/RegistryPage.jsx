import React, { useEffect } from 'react';
import { RegistryTable } from '../components/registry/RegistryTable.jsx';
import { ValidationPanel } from '../components/shared/ValidationPanel.jsx';
import { useTemplateGraphStore } from '../stores/useTemplateGraphStore.js';
import { useRegistryStore } from '../stores/useRegistryStore.js';
import { useValidation } from '../hooks/useValidation.js';
import { resolveRegistry } from '../../../shared/index.js';

/**
 * RegistryPage - displays resolved tag registry
 */
export function RegistryPage() {
  const templateMap = useTemplateGraphStore(state => state.templateMap);
  const rootTemplateName = useTemplateGraphStore(state => state.rootTemplateName);
  const setTags = useRegistryStore(state => state.setTags);

  const { messages, isValid } = useValidation(templateMap, rootTemplateName);

  useEffect(() => {
    if (!rootTemplateName || !templateMap || templateMap.size === 0) {
      setTags([]);
      return;
    }

    if (!isValid) {
      setTags([]);
      return;
    }

    // Resolve registry client-side
    const tags = resolveRegistry(templateMap, rootTemplateName);
    setTags(tags);
  }, [templateMap, rootTemplateName, isValid, setTags]);

  if (!rootTemplateName) {
    return (
      <div className="p-6 text-center text-gray-500">
        <p>Select a root template from the dropdown above to view the registry.</p>
      </div>
    );
  }

  if (!isValid) {
    return (
      <div className="p-6 text-center">
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

  return (
    <div className="h-full flex flex-col">
      <RegistryTable />
      <ValidationPanel messages={messages} />
    </div>
  );
}
