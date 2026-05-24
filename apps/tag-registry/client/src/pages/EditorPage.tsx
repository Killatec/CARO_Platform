import React, { useMemo } from 'react';
import { AssetTree } from '../components/tree/AssetTree.jsx';
import { TemplatesTree } from '../components/panel/TemplatesTree.jsx';
import { FieldsPanel } from '../components/panel/FieldsPanel.jsx';
import { ValidationPanel } from '../components/shared/ValidationPanel.jsx';
import { CascadeModal } from '../components/shared/CascadeModal.jsx';
import { CascadePreviewModal } from '../components/shared/CascadePreviewModal.jsx';
import { useTemplateGraphStore } from '../stores/useTemplateGraphStore.js';
import { useUIStore } from '../stores/useUIStore.js';
import { useValidation } from '../hooks/useValidation.js';

/**
 * EditorPage - main template editing interface.
 */
export function EditorPage(): React.ReactElement {
  const templateMap      = useTemplateGraphStore(state => state.templateMap);
  const rootTemplateName = useTemplateGraphStore(state => state.rootTemplateName);

  const setSelectedTemplateTree = useUIStore(state => state.setSelectedTemplateTree);

  const { messages } = useValidation(templateMap, rootTemplateName);

  const pathSeverityMap = useMemo(() => {
    const map = new Map<string, 'error' | 'warning'>();
    for (const msg of messages) {
      const tagPath = msg.ref?.tag_path;
      if (!tagPath) continue;
      const parts = tagPath.split('.');
      for (let i = 1; i <= parts.length; i++) {
        const prefix = parts.slice(0, i).join('.');
        if (msg.severity === 'error' || !map.has(prefix)) {
          map.set(prefix, msg.severity);
        }
      }
    }
    return map;
  }, [messages]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        <div className="min-w-[25rem] border-r border-gray-200 bg-white overflow-y-auto">
          <AssetTree pathSeverityMap={pathSeverityMap} />
        </div>

        <div className="min-w-[20rem] border-r border-gray-200 bg-white overflow-y-auto">
          <FieldsPanel />
        </div>

        <div className="min-w-[20rem] bg-white overflow-y-auto">
          <TemplatesTree onTemplateSelect={setSelectedTemplateTree} />
        </div>
      </div>

      <div className="flex-shrink-0">
        <ValidationPanel messages={messages} />
      </div>

      <CascadeModal />
      <CascadePreviewModal />
    </div>
  );
}
