import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { TagDef } from '@caro/hmi-context';
import { TagPickerModal } from '../src/TagPickerModal.js';

// ── localStorage mock ─────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTag(id: number, path: string, trendable = true, tag_name: string | null = null): TagDef {
  return {
    tag_id:      id,
    tag_path:    path,
    tag_name,
    data_type:   'f32',
    is_setpoint: false,
    trendable,
    module_id:   path.split('.')[1] ?? 'M',
    module_type: 'MQTT',
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    format:      null,
    meta:        [],
  };
}

const TAG_1 = makeTag(1, 'Plant.Mod1.Temp',    true,  'Temperature');
const TAG_2 = makeTag(2, 'Plant.Mod1.Pressure', true,  'Pressure');
const TAG_3 = makeTag(3, 'Plant.Mod2.Status',   false, 'Status');   // non-trendable

const TAG_MAP = new Map<number, TagDef>([
  [1, TAG_1],
  [2, TAG_2],
  [3, TAG_3],
]);

function renderPicker(props: Partial<React.ComponentProps<typeof TagPickerModal>> = {}) {
  const defaults: React.ComponentProps<typeof TagPickerModal> = {
    isOpen: true,
    onClose: vi.fn(),
    onCommit: vi.fn(),
    currentTagIds: [],
    tagMap: TAG_MAP,
  };
  return render(<TagPickerModal {...defaults} {...props} />);
}

beforeEach(() => localStorageMock.clear());
afterEach(() => vi.restoreAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TagPickerModal', () => {
  it('renders tree from tagMap', () => {
    renderPicker();
    // Root branch visible; children hidden until expanded
    expect(screen.getByText('Plant')).toBeTruthy();
    expect(screen.queryByText('Mod1')).toBeNull();

    // Expand root
    fireEvent.click(screen.getByText('Plant'));
    expect(screen.getByText('Mod1')).toBeTruthy();
    expect(screen.getByText('Mod2')).toBeTruthy();
  });

  it('non-trendable tags are rendered (grayed by style) and clicking is a no-op', () => {
    const onCommit = vi.fn();
    renderPicker({ onCommit });

    // Expand Mod2 to show Status leaf
    fireEvent.click(screen.getByText('Plant'));
    fireEvent.click(screen.getByText('Mod2'));

    const statusEl = screen.getByTitle('Plant.Mod2.Status');
    expect(statusEl).toBeTruthy();
    // Clicking non-trendable leaf should not stage it
    fireEvent.click(statusEl);

    // Click OK — staged list should be empty
    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith([]);
  });

  it('clicking a trendable, not-staged tag stages it', () => {
    const onCommit = vi.fn();
    renderPicker({ onCommit });

    // Expand to reach Tag 1
    fireEvent.click(screen.getByText('Plant'));
    fireEvent.click(screen.getByText('Mod1'));
    fireEvent.click(screen.getByTitle('Plant.Mod1.Temp'));

    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith([1]);
  });

  it('clicking an already-staged tag in the left pane is a no-op (not duplicated)', () => {
    const onCommit = vi.fn();
    renderPicker({ currentTagIds: [1], onCommit });

    fireEvent.click(screen.getByText('Plant'));
    fireEvent.click(screen.getByText('Mod1'));

    // Click the already-staged tag leaf again
    const tempEl = screen.getByTitle('Plant.Mod1.Temp');
    fireEvent.click(tempEl);
    fireEvent.click(tempEl);

    fireEvent.click(screen.getByText('OK'));
    // Should still be [1] only
    expect(onCommit).toHaveBeenCalledWith([1]);
  });

  it('× button in right pane unstages a tag', () => {
    const onCommit = vi.fn();
    renderPicker({ currentTagIds: [1, 2], onCommit });

    // Remove tag 1 via × button
    const removeBtn = screen.getByLabelText('Remove Temperature');
    fireEvent.click(removeBtn);

    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith([2]);
  });

  it('cap: 17th add attempt sets error message; removing one clears error', () => {
    // Build a tagMap with 17 trendable tags
    const bigMap = new Map<number, TagDef>();
    for (let i = 1; i <= 17; i++) {
      bigMap.set(i, makeTag(i, `Root.Mod.Tag${i}`, true));
    }
    const onCommit = vi.fn();
    const currentTagIds = Array.from({ length: 16 }, (_, i) => i + 1);
    renderPicker({ tagMap: bigMap, currentTagIds, onCommit });

    expect(screen.queryByText(/Max 16 signals/)).toBeNull();

    // Expand tree to reach tag 17
    fireEvent.click(screen.getByText('Root'));
    fireEvent.click(screen.getByText('Mod'));
    fireEvent.click(screen.getByTitle('Root.Mod.Tag17'));

    expect(screen.getByText(/Max 16 signals. Remove one to add another./)).toBeTruthy();

    // Remove one via × button — error should clear
    const removeBtn = screen.getAllByTitle(/Remove/)[0]!;
    fireEvent.click(removeBtn);

    expect(screen.queryByText(/Max 16 signals/)).toBeNull();
  });

  it('search filters tree; non-trendable matches still appear', () => {
    renderPicker();

    const searchInput = screen.getByPlaceholderText('Search tags…');
    fireEvent.change(searchInput, { target: { value: 'status' } });

    // Status (non-trendable) should appear
    expect(screen.getByTitle('Plant.Mod2.Status')).toBeTruthy();
    // Temperature and Pressure should not appear
    expect(screen.queryByTitle('Plant.Mod1.Temp')).toBeNull();
  });

  it('expandedKeys persist to localStorage on branch toggle', () => {
    renderPicker();
    fireEvent.click(screen.getByText('Plant'));

    const stored = localStorageMock.getItem('caro.hmi.tagPicker.expandedNodes');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!) as string[];
    expect(parsed).toContain('Plant');
  });

  it('OK calls onCommit(stagedIds) then onClose()', () => {
    const onCommit = vi.fn();
    const onClose  = vi.fn();
    renderPicker({ currentTagIds: [1], onCommit, onClose });

    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith([1]);
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel calls only onClose() (no commit)', () => {
    const onCommit = vi.fn();
    const onClose  = vi.fn();
    renderPicker({ currentTagIds: [1], onCommit, onClose });

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
