import { useState } from 'react';
import { Header } from './Header.js';
import { StatsBar } from './StatsBar.js';
import { NavTree } from './NavTree.js';
import { ContentArea } from './ContentArea.js';
import { tree } from '../hmi-definitions/demo/tree.js';

export function Shell() {
  const [selectedId, setSelectedId] = useState<string | null>(
    tree[0]?.id ?? null
  );
  const [showStats, setShowStats] = useState(true);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <NavTree tree={tree} selectedId={selectedId} onSelect={setSelectedId} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
          <StatsBar visible={showStats} />
          <ContentArea tree={tree} selectedId={selectedId} />
        </div>
      </div>
    </div>
  );
}
