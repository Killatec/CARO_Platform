import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useProjectRoot } from '@caro/hmi-context';
import { Header } from './Header.js';
import { StatsBar } from './StatsBar.js';
import { NavTree } from './NavTree.js';
import { ContentArea } from './ContentArea.js';
import { hmiDefinitionsRegistry } from '../hmi-definitions/registry.js';
import type { TreeNode } from './types.js';

function allIds(nodes: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      ids.add(n.id);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return ids;
}

function idFromHash(): string | null {
  const raw = window.location.hash.slice(1); // strip leading '#'
  return raw || null;
}

export function Shell() {
  const projectRoot = useProjectRoot();

  // Tree is loaded async (dynamic import) once projectRoot is known. An
  // unregistered root — including null, before/without a resolved config —
  // resolves to [], which NavTree already renders as its empty state. No
  // silent fallback to demo.
  const [tree, setTree] = useState<TreeNode[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loader = projectRoot !== null ? hmiDefinitionsRegistry[projectRoot] : undefined;
    if (!loader) {
      setTree([]);
      return;
    }
    loader().then(mod => {
      if (!cancelled) setTree(mod.tree);
    });
    return () => { cancelled = true; };
  }, [projectRoot]);

  const validIds = useMemo(() => allIds(tree), [tree]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(true);

  // Resolve the initial id (from hash, falling back to the first node) once
  // the tree for this projectRoot has loaded.
  useEffect(() => {
    if (tree.length === 0) {
      setSelectedId(null);
      return;
    }
    const fromHash = idFromHash();
    setSelectedId(fromHash && validIds.has(fromHash) ? fromHash : (tree[0]?.id ?? null));
  }, [tree, validIds]);

  // Keep hash in sync when the user navigates via the NavTree.
  const handleSelect = useCallback((id: string) => {
    window.location.hash = id;
    setSelectedId(id);
  }, []);

  // Sync state when the user navigates with browser back/forward. validIds
  // changes as the tree loads/switches, so the listener reads it from a ref
  // rather than closing over a stale set.
  const validIdsRef = useRef(validIds);
  validIdsRef.current = validIds;

  useEffect(() => {
    function onHashChange() {
      const id = idFromHash();
      if (id && validIdsRef.current.has(id)) setSelectedId(id);
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <NavTree tree={tree} selectedId={selectedId} onSelect={handleSelect} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <StatsBar visible={showStats} />
          <ContentArea tree={tree} selectedId={selectedId} />
        </div>
      </div>
    </div>
  );
}
