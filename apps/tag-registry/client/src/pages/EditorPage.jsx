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
 *
 * Right panel is split vertically:
 *   Top    — TemplatesTree (all templates on disk, grouped by type)
 *   Bottom — FieldsPanel (fields for the currently selected item)
 *
 * Save / Cancel / See what's changed live in the top bar (AppShell).
 */
export function EditorPage() {
  const templateMap      = useTemplateGraphStore(state => state.templateMap);
  const rootTemplateName = useTemplateGraphStore(state => state.rootTemplateName);

  const setSelectedTemplateTree = useUIStore(state => state.setSelectedTemplateTree);

  const { messages } = useValidation(templateMap, rootTemplateName);

  return (
    <div className="w-fit flex flex-col overflow-auto">
      {/* Main content row */}
      <div className="flex flex-shrink-0">
        {/* Col 1: Asset Tree */}
        <div className="flex-shrink-0 min-w-[25rem] border-r border-gray-200 bg-white">
          <AssetTree />
        </div>

        {/* Col 2: Templates + Properties */}
        <div className="flex-shrink-0 min-w-[20rem] flex flex-col bg-white">
          <div className="flex-shrink-0 border-b border-gray-200">
            <TemplatesTree onTemplateSelect={setSelectedTemplateTree} />
          </div>
          <div className="flex-shrink-0">
            <FieldsPanel />
          </div>
        </div>
      </div>

      {/* Validation — sits immediately below the content row */}
      <ValidationPanel messages={messages} />

      {/* Modals */}
      <CascadeModal />
      <CascadePreviewModal />
    </div>
  );
}
