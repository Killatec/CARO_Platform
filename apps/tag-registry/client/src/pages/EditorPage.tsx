import React from 'react';
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

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-1 min-h-0">
        <div className="min-w-[25rem] border-r border-gray-200 bg-white overflow-y-auto">
          <AssetTree />
        </div>

        <div className="min-w-[20rem] flex flex-col bg-white overflow-y-auto">
          <div className="flex-shrink-0 border-b border-gray-200">
            <TemplatesTree onTemplateSelect={setSelectedTemplateTree} />
          </div>
          <div className="flex-shrink-0">
            <FieldsPanel />
          </div>
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
