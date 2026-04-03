import React, { useState, useEffect, useRef } from 'react';
import { TreeNode } from './TreeNode.jsx';
import { resolveTree } from '../../utils/resolveTree.js';
import { useTemplateGraphStore } from '../../stores/useTemplateGraphStore.js';

const LS_KEY = 'caro_tree_expanded';

function lsGet() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function lsSet(nodes) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify(nodes));
}

function lsClear() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LS_KEY);
}

/**
 * AssetTree - displays template hierarchy as collapsible tree
 */
export function AssetTree() {
  const templateMap = useTemplateGraphStore(state => state.templateMap);
  const rootTemplateName = useTemplateGraphStore(state => state.rootTemplateName);
  const isLoading = useTemplateGraphStore(state => state.isLoading);

  const [expandedNodes, setExpandedNodes] = useState({});
  // Tracks whether we have consumed the stored state for the initial root load.
  const hasRestoredRef = useRef(false);

  // On the first root load, restore expand state from localStorage.
  // On subsequent root changes (manual selection), reset and clear localStorage
  // since paths are root-specific and stale paths are meaningless.
  useEffect(() => {
    if (!rootTemplateName) return;

    if (!hasRestoredRef.current) {
      hasRestoredRef.current = true;
      const stored = lsGet();
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        setExpandedNodes(stored);
        return;
      }
    }

    lsClear();
    setExpandedNodes({});
  }, [rootTemplateName]);

  const header = (
    <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
      System Tree
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
          node={tree}
          ownPath={tree.template_name}
          expandedNodes={expandedNodes}
          onToggleExpand={(path) => setExpandedNodes(prev => {
            const next = { ...prev, [path]: prev[path] === false };
            lsSet(next);
            return next;
          })}
        />
      </div>
    </div>
  );
}
