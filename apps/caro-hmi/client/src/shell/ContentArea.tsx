import type { CSSProperties } from 'react';
import type { TreeNode } from './types.js';

interface ContentAreaProps {
  tree: TreeNode[];
  selectedId: string | null;
}

const AREA_STYLE: CSSProperties = {
  flex: 1,
  padding: 16,
  overflowY: 'auto',
  background: '#fff',
};

const PLACEHOLDER_STYLE: CSSProperties = {
  color: '#888',
  fontStyle: 'italic',
  fontSize: 14,
  marginTop: 32,
  textAlign: 'center',
};

function findNode(tree: TreeNode[], id: string): TreeNode | null {
  for (const node of tree) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNode(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function ContentArea({ tree, selectedId }: ContentAreaProps) {
  const node = selectedId ? findNode(tree, selectedId) : null;

  return (
    <main style={AREA_STYLE}>
      {node ? (
        <node.page />
      ) : (
        <p style={PLACEHOLDER_STYLE}>Select a page from the navigation panel</p>
      )}
    </main>
  );
}
