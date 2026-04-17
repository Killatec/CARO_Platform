import { useState, useEffect, useCallback } from 'react';
import { Header } from './Header.js';
import { StatsBar } from './StatsBar.js';
import { NavTree } from './NavTree.js';
import { ContentArea } from './ContentArea.js';
import { tree } from '../hmi-definitions/demo/tree.js';

function allIds(nodes: typeof tree): Set<string> {
  const ids = new Set<string>();
  const walk = (ns: typeof tree) => {
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

const validIds = allIds(tree);

function resolveInitialId(): string | null {
  const fromHash = idFromHash();
  if (fromHash && validIds.has(fromHash)) return fromHash;
  return tree[0]?.id ?? null;
}

export function Shell() {
  const [selectedId, setSelectedId] = useState<string | null>(resolveInitialId);
  const [showStats, setShowStats] = useState(true);

  // Keep hash in sync when the user navigates via the NavTree.
  const handleSelect = useCallback((id: string) => {
    window.location.hash = id;
    setSelectedId(id);
  }, []);

  // Sync state when the user navigates with browser back/forward.
  useEffect(() => {
    function onHashChange() {
      const id = idFromHash();
      if (id && validIds.has(id)) setSelectedId(id);
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
