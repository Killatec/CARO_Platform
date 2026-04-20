import { describe, it, expect, beforeEach } from 'vitest';
import { useTreeExpandStore } from '../src/stores/useTreeExpandStore.ts';

// Reset the store to a clean state before each test.
beforeEach(() => {
  useTreeExpandStore.setState({ expandedPaths: {} });
});

describe('useTreeExpandStore', () => {
  it('starts with no expanded paths', () => {
    const { expandedPaths } = useTreeExpandStore.getState();
    expect(expandedPaths).toEqual({});
  });

  it('setExpanded stores a true entry', () => {
    useTreeExpandStore.getState().setExpanded('ROOT.A', true);
    expect(useTreeExpandStore.getState().expandedPaths['ROOT.A']).toBe(true);
  });

  it('setExpanded stores a false entry', () => {
    useTreeExpandStore.getState().setExpanded('ROOT.A', false);
    expect(useTreeExpandStore.getState().expandedPaths['ROOT.A']).toBe(false);
  });

  it('toggling from true to false works', () => {
    useTreeExpandStore.getState().setExpanded('ROOT.B', true);
    const before = useTreeExpandStore.getState().expandedPaths['ROOT.B'];
    useTreeExpandStore.getState().setExpanded('ROOT.B', !before);
    expect(useTreeExpandStore.getState().expandedPaths['ROOT.B']).toBe(false);
  });

  it('clearExpanded removes the exact path', () => {
    useTreeExpandStore.getState().setExpanded('ROOT.C', true);
    useTreeExpandStore.getState().clearExpanded('ROOT.C');
    expect(useTreeExpandStore.getState().expandedPaths['ROOT.C']).toBeUndefined();
  });

  it('clearExpanded removes all descendant paths', () => {
    useTreeExpandStore.getState().setExpanded('ROOT.C', true);
    useTreeExpandStore.getState().setExpanded('ROOT.C.child1', true);
    useTreeExpandStore.getState().setExpanded('ROOT.C.child1.grandchild', false);
    useTreeExpandStore.getState().setExpanded('ROOT.D', true); // unrelated — must survive

    useTreeExpandStore.getState().clearExpanded('ROOT.C');

    const paths = useTreeExpandStore.getState().expandedPaths;
    expect(paths['ROOT.C']).toBeUndefined();
    expect(paths['ROOT.C.child1']).toBeUndefined();
    expect(paths['ROOT.C.child1.grandchild']).toBeUndefined();
    expect(paths['ROOT.D']).toBe(true); // unrelated path untouched
  });

  it('multiple independent paths coexist', () => {
    useTreeExpandStore.getState().setExpanded('A', true);
    useTreeExpandStore.getState().setExpanded('B', false);
    useTreeExpandStore.getState().setExpanded('C', true);

    const paths = useTreeExpandStore.getState().expandedPaths;
    expect(paths['A']).toBe(true);
    expect(paths['B']).toBe(false);
    expect(paths['C']).toBe(true);
  });

  // ── Default-value semantics (mirrors TreeNode logic) ─────────────────────

  it('undefined entry → isExpanded falls back to parentTemplateName === null', () => {
    const paths = useTreeExpandStore.getState().expandedPaths;

    // No entry for 'ROOT' or 'ROOT.child' — simulate hook fallback
    const rootStored  = paths['ROOT'];
    const childStored = paths['ROOT.child'];

    const rootExpanded  = rootStored  ?? (null === null);   // root: parentTemplateName is null → true
    const childExpanded = childStored ?? ('ROOT' === null);  // non-root: parentTemplateName is 'ROOT' → false

    expect(rootExpanded).toBe(true);
    expect(childExpanded).toBe(false);
  });

  it('explicit false entry overrides root-default-open', () => {
    // If user collapsed the root, the stored false must win over the default.
    useTreeExpandStore.getState().setExpanded('ROOT', false);
    const stored = useTreeExpandStore.getState().expandedPaths['ROOT'];
    const isExpanded = stored ?? (null === null); // stored is false, ?? does not fire
    expect(isExpanded).toBe(false);
  });

  it('explicit true entry overrides non-root-default-closed', () => {
    useTreeExpandStore.getState().setExpanded('ROOT.child', true);
    const stored = useTreeExpandStore.getState().expandedPaths['ROOT.child'];
    const isExpanded = stored ?? ('ROOT' === null); // stored is true, ?? does not fire
    expect(isExpanded).toBe(true);
  });
});
