import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import { Shell } from '../Shell.js';
import type { TreeNode } from '../types.js';

function FooPage() { return <div>Foo Page Content</div>; }
function BarPage() { return <div>Bar Page Content</div>; }

const fakeTree: TreeNode[] = [
  { id: 'foo', label: 'Foo Page', page: FooPage },
  { id: 'bar', label: 'Bar Page', page: BarPage },
];

// Mock the registry so this suite doesn't depend on the real per-system trees
// (which pull in widget-heavy pages needing a populated tag map) and stays a
// hermetic test of Shell's own resolution logic: registry lookup → dynamic
// import → validIds/initial-id derivation.
vi.mock('../../hmi-definitions/registry.js', () => ({
  hmiDefinitionsRegistry: {
    'known-root': () => Promise.resolve({ tree: fakeTree }),
  },
}));

describe('Shell', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('renders the resolved tree for a registered projectRoot', async () => {
    render(
      <MockHmiProvider projectRoot="known-root">
        <Shell />
      </MockHmiProvider>,
    );

    await waitFor(() => expect(screen.getByText('Foo Page')).toBeTruthy());
    expect(screen.getByText('Bar Page')).toBeTruthy();
    // First node auto-selected → its page renders in ContentArea.
    expect(screen.getByText('Foo Page Content')).toBeTruthy();
  });

  it('renders the NavTree empty state for a projectRoot not in the registry', async () => {
    render(
      <MockHmiProvider projectRoot="unregistered-root">
        <Shell />
      </MockHmiProvider>,
    );

    await waitFor(() => expect(screen.getByText('No machine config loaded')).toBeTruthy());
  });

  it('renders the NavTree empty state when projectRoot is null — no fallback to demo', async () => {
    render(
      <MockHmiProvider projectRoot={null}>
        <Shell />
      </MockHmiProvider>,
    );

    await waitFor(() => expect(screen.getByText('No machine config loaded')).toBeTruthy());
    // Guard against a silent fallback: demo's own nav labels must never appear.
    expect(screen.queryByText('System Overview')).toBeNull();
  });

  it('selects the tree node matching the URL hash on load, when valid', async () => {
    window.location.hash = 'bar';
    render(
      <MockHmiProvider projectRoot="known-root">
        <Shell />
      </MockHmiProvider>,
    );

    await waitFor(() => expect(screen.getByText('Bar Page Content')).toBeTruthy());
  });
});
