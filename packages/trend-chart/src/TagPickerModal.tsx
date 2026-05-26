import { useState, useEffect, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Modal } from '@caro/ui';
import type { TagDef } from '@caro/hmi-context';
import { buildTagForest } from './buildTagForest.js';
import type { TagForestNode } from './buildTagForest.js';
import { colorAssign } from './colorAssign.js';

export interface TagPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCommit: (tagIds: number[]) => void;
  currentTagIds: number[];
  tagMap: Map<number, TagDef>;
  maxTags?: number;
}

const EXPANDED_STORAGE_KEY = 'caro.hmi.tagPicker.expandedNodes';
const DEFAULT_MAX_TAGS = 16;

function loadExpandedKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return new Set(parsed as string[]);
    }
  } catch {
    // ignore
  }
  return new Set<string>();
}

function saveExpandedKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    // ignore
  }
}

// Fuzzy sequential-substring match (case-insensitive).
function fuzzyMatch(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let hi = 0;
  for (let ni = 0; ni < n.length; ni++) {
    const idx = h.indexOf(n[ni]!, hi);
    if (idx === -1) return false;
    hi = idx + 1;
  }
  return true;
}

function nodeMatchesSearch(node: TagForestNode, search: string): boolean {
  if (node.tag !== null) return fuzzyMatch(node.tag.tag_path, search);
  return node.children.some(c => nodeMatchesSearch(c, search));
}

// ── Styles ────────────────────────────────────────────────────────────────────

const PANE_ROW: CSSProperties = {
  display: 'flex',
  gap: 12,
  minHeight: 400,
  overflow: 'hidden',
};

const LEFT_PANE: CSSProperties = {
  flex: '6 6 0',
  overflowY: 'auto',
  border: '1px solid #e5e7eb',
  borderRadius: 4,
  padding: '4px 0',
};

const RIGHT_PANE: CSSProperties = {
  flex: '4 4 0',
  overflowY: 'auto',
  border: '1px solid #e5e7eb',
  borderRadius: 4,
  padding: '4px 0',
};

const SEARCH_BOX: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 8px',
  marginBottom: 8,
  border: '1px solid #d1d5db',
  borderRadius: 4,
  fontSize: 13,
  fontFamily: 'monospace',
  outline: 'none',
};

const ERROR_ROW: CSSProperties = {
  fontSize: 12,
  fontFamily: 'monospace',
  lineHeight: '16px',
  minHeight: 16,
  color: '#dc2626',
  padding: '4px 0',
};

const FOOTER_ROW: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  paddingTop: 8,
};

const BTN_BASE: CSSProperties = {
  padding: '6px 16px',
  borderRadius: 4,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'monospace',
};

const BTN_CANCEL: CSSProperties = {
  ...BTN_BASE,
  background: '#fff',
  border: '1px solid #d1d5db',
  color: '#374151',
};

const BTN_OK: CSSProperties = {
  ...BTN_BASE,
  background: '#2563eb',
  border: '1px solid #2563eb',
  color: '#fff',
};

const TREE_ROW_BASE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  fontSize: 12,
  fontFamily: 'monospace',
  lineHeight: '18px',
  cursor: 'pointer',
  userSelect: 'none',
};

const RIGHT_ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  fontSize: 12,
  fontFamily: 'monospace',
  lineHeight: '18px',
};

const SWATCH: CSSProperties = {
  display: 'inline-block',
  width: 10,
  height: 10,
  borderRadius: 2,
  flexShrink: 0,
};

const REMOVE_BTN: CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  color: '#9ca3af',
  padding: '0 2px',
  fontSize: 14,
  lineHeight: 1,
  marginLeft: 'auto',
};

// ── Tree node component ───────────────────────────────────────────────────────

interface TreeNodeProps {
  node: TagForestNode;
  depth: number;
  stagedIds: number[];
  expandedKeys: Set<string>;
  forceExpand: boolean;
  onToggle: (pathKey: string) => void;
  onStage: (tag: TagDef) => void;
}

function TreeNode({ node, depth, stagedIds, expandedKeys, forceExpand, onToggle, onStage }: TreeNodeProps) {
  const indent = depth * 16;
  const isLeaf = node.tag !== null;
  const isExpanded = forceExpand || expandedKeys.has(node.pathKey);

  if (isLeaf) {
    const tag = node.tag!;
    const isStaged = stagedIds.includes(tag.tag_id);
    const isNonTrendable = !tag.trendable;
    const label = tag.tag_name ?? `Tag-${tag.tag_id}`;
    const color = colorAssign(tag.tag_id);

    const rowStyle: CSSProperties = {
      ...TREE_ROW_BASE,
      paddingLeft: indent + 8,
      color: isNonTrendable ? '#9ca3af' : '#111827',
      fontWeight: isStaged ? 700 : 400,
      background: isStaged ? '#f3f4f6' : 'transparent',
      cursor: isNonTrendable || isStaged ? 'default' : 'pointer',
    };

    return (
      <div
        style={rowStyle}
        onClick={isNonTrendable || isStaged ? undefined : () => onStage(tag)}
        title={tag.tag_path}
      >
        <span style={{ ...SWATCH, background: color }} />
        <span>{label}</span>
      </div>
    );
  }

  // Branch node
  const isBranchGrayed = !node.hasTrendableDescendant;
  const rowStyle: CSSProperties = {
    ...TREE_ROW_BASE,
    paddingLeft: indent + 8,
    color: isBranchGrayed ? '#9ca3af' : '#374151',
  };

  return (
    <>
      <div style={rowStyle} onClick={() => onToggle(node.pathKey)}>
        <span style={{ fontSize: 10, width: 10, display: 'inline-block', textAlign: 'center' }}>
          {isExpanded ? '▾' : '▸'}
        </span>
        <span>{node.name}</span>
      </div>
      {isExpanded && node.children.map(child => (
        <TreeNode
          key={child.pathKey}
          node={child}
          depth={depth + 1}
          stagedIds={stagedIds}
          expandedKeys={expandedKeys}
          forceExpand={forceExpand}
          onToggle={onToggle}
          onStage={onStage}
        />
      ))}
    </>
  );
}

// ── Main modal component ──────────────────────────────────────────────────────

export function TagPickerModal({
  isOpen,
  onClose,
  onCommit,
  currentTagIds,
  tagMap,
  maxTags = DEFAULT_MAX_TAGS,
}: TagPickerModalProps) {
  const [stagedIds, setStagedIds] = useState<number[]>([]);
  const [search, setSearch]       = useState('');
  const [error, setError]         = useState<string | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => loadExpandedKeys());

  // Reset staged state when modal opens.
  useEffect(() => {
    if (isOpen) {
      setStagedIds([...currentTagIds]);
      setSearch('');
      setError(null);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const forest = useMemo(() => buildTagForest(tagMap), [tagMap]);

  const trimmedSearch = search.trim();
  const isSearching = trimmedSearch !== '';

  // Filter forest for search. Returns filtered nodes; matched branches force-expanded.
  const filteredForest = useMemo(() => {
    if (!isSearching) return forest;
    function filterNode(node: TagForestNode): TagForestNode | null {
      if (node.tag !== null) {
        return nodeMatchesSearch(node, trimmedSearch) ? node : null;
      }
      const filteredChildren = node.children
        .map(filterNode)
        .filter((c): c is TagForestNode => c !== null);
      if (filteredChildren.length === 0) return null;
      return { ...node, children: filteredChildren };
    }
    return forest.map(filterNode).filter((n): n is TagForestNode => n !== null);
  }, [forest, isSearching, trimmedSearch]);

  const handleToggle = useCallback((pathKey: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(pathKey)) next.delete(pathKey);
      else next.add(pathKey);
      saveExpandedKeys(next);
      return next;
    });
  }, []);

  const handleStage = useCallback((tag: TagDef) => {
    setStagedIds(prev => {
      if (prev.length >= maxTags) {
        setError(`Max ${maxTags} signals. Remove one to add another.`);
        return prev;
      }
      setError(null);
      return [...prev, tag.tag_id];
    });
  }, [maxTags]);

  const handleUnstage = useCallback((tagId: number) => {
    setStagedIds(prev => prev.filter(id => id !== tagId));
    setError(null);
  }, []);

  const handleOk = useCallback(() => {
    onCommit(stagedIds);
    onClose();
  }, [onCommit, onClose, stagedIds]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Signals" maxWidthClass="max-w-4xl">
      <input
        type="text"
        placeholder="Search tags…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={SEARCH_BOX}
        aria-label="Search tags"
      />
      <div style={PANE_ROW}>
        {/* Left pane — tag tree */}
        <div style={LEFT_PANE} role="tree" aria-label="Tag tree">
          {filteredForest.map(root => (
            <TreeNode
              key={root.pathKey}
              node={root}
              depth={0}
              stagedIds={stagedIds}
              expandedKeys={expandedKeys}
              forceExpand={isSearching}
              onToggle={handleToggle}
              onStage={handleStage}
            />
          ))}
        </div>
        {/* Right pane — staged list */}
        <div style={RIGHT_PANE} aria-label="Staged signals">
          {stagedIds.map(tagId => {
            const tag = tagMap.get(tagId);
            const label = tag?.tag_name ?? `Tag-${tagId}`;
            const color = colorAssign(tagId);
            return (
              <div key={tagId} style={RIGHT_ROW}>
                <span style={{ ...SWATCH, background: color }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
                <button
                  style={REMOVE_BTN}
                  onClick={() => handleUnstage(tagId)}
                  title={`Remove ${label}`}
                  aria-label={`Remove ${label}`}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#374151'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af'; }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      </div>
      <div style={ERROR_ROW} role="alert">{error ?? ''}</div>
      <div style={FOOTER_ROW}>
        <button style={BTN_CANCEL} onClick={onClose}>Cancel</button>
        <button style={BTN_OK} onClick={handleOk}>OK</button>
      </div>
    </Modal>
  );
}
