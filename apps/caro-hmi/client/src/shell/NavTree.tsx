import type { CSSProperties } from 'react';
import type { TreeNode } from './types.js';

interface NavTreeProps {
  tree: TreeNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SIDEBAR_STYLE: CSSProperties = {
  width: 240,
  flexShrink: 0,
  background: '#f0f0f0',
  borderRight: '1px solid #ddd',
  overflowY: 'auto',
  padding: '8px 0',
};

const EMPTY_STYLE: CSSProperties = {
  padding: 16,
  fontSize: 13,
  color: '#888',
  fontStyle: 'italic',
};

interface NavItemProps {
  node: TreeNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth: number;
}

function NavItem({ node, selectedId, onSelect, depth }: NavItemProps) {
  const isSelected = node.id === selectedId;

  const itemStyle: CSSProperties = {
    display: 'block',
    width: '100%',
    padding: `6px 12px 6px ${12 + depth * 16}px`,
    textAlign: 'left',
    background: isSelected ? '#dce8f8' : 'transparent',
    borderTop: 'none',
    borderRight: 'none',
    borderBottom: 'none',
    borderLeft: isSelected ? '3px solid #3b82f6' : '3px solid transparent',
    color: isSelected ? '#1d4ed8' : '#333',
    fontWeight: isSelected ? 600 : 400,
    fontSize: 13,
    cursor: 'pointer',
    boxSizing: 'border-box',
  };

  return (
    <>
      <button style={itemStyle} onClick={() => onSelect(node.id)}>
        {node.label}
      </button>
      {node.children?.map(child => (
        <NavItem
          key={child.id}
          node={child}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ))}
    </>
  );
}

export function NavTree({ tree, selectedId, onSelect }: NavTreeProps) {
  return (
    <nav style={SIDEBAR_STYLE}>
      {tree.length === 0 ? (
        <p style={EMPTY_STYLE}>No machine config loaded</p>
      ) : (
        tree.map(node => (
          <NavItem
            key={node.id}
            node={node}
            selectedId={selectedId}
            onSelect={onSelect}
            depth={0}
          />
        ))
      )}
    </nav>
  );
}
