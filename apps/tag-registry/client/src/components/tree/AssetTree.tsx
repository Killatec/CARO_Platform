import React from 'react';
import { TreeNode } from './TreeNode.jsx';
import { resolveTree } from '../../utils/resolveTree.js';
import { exportTree } from '../../utils/exportTree.js';
import { useTemplateGraphStore } from '../../stores/useTemplateGraphStore.js';

/**
 * AssetTree - displays template hierarchy as collapsible tree
 */
export function AssetTree(): React.ReactElement {
  const templateMap = useTemplateGraphStore(state => state.templateMap);
  const rootTemplateName = useTemplateGraphStore(state => state.rootTemplateName);
  const isLoading = useTemplateGraphStore(state => state.isLoading);


  function handleExport() {
    if (!rootTemplateName) return;
    const result = exportTree(templateMap, rootTemplateName);
    const json = JSON.stringify(result, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rootTemplateName}_tree.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const header = (
    <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100 flex items-center justify-between">
      <span>System Tree</span>
      {rootTemplateName && (
        <button
          onClick={handleExport}
          title="Export tree as JSON"
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          ↓
        </button>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div data-testid="system-tree">
        {header}
        <div className="p-4 text-center text-gray-500">
          <div className="animate-spin inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
          <p className="mt-2">Loading template graph...</p>
        </div>
      </div>
    );
  }

  if (!rootTemplateName) {
    return (
      <div data-testid="system-tree">
        {header}
        <div className="p-4 text-center text-gray-500">
          <p>Select a root template from the dropdown above to begin.</p>
        </div>
      </div>
    );
  }

  const tree = resolveTree(templateMap, rootTemplateName);

  if (!tree) {
    return (
      <div data-testid="system-tree">
        {header}
        <div className="p-4 text-center text-gray-500">
          <p>No template hierarchy found.</p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="system-tree">
      {header}
      <div className="p-4">
        <TreeNode
          key={rootTemplateName}
          node={tree}
          ownPath={tree.template_name}
        />
      </div>
    </div>
  );
}
