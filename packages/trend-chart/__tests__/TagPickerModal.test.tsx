import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TagDef } from '@caro/hmi-context';
import { TagPickerModal } from '../src/TagPickerModal.js';

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

// Alphabetical by tag_name: Pressure < Temperature. Status is non-trendable.
const TAG_1 = makeTag(1, 'Plant.Mod1.Temp',    true,  'Temperature');
const TAG_2 = makeTag(2, 'Plant.Mod1.Pressure', true,  'Pressure');
const TAG_3 = makeTag(3, 'Plant.Mod2.Status',   false, 'Status');

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

afterEach(() => vi.restoreAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TagPickerModal', () => {
  it('non-trendable tags do not appear in the left pane', () => {
    renderPicker();
    expect(screen.queryByTitle('Plant.Mod2.Status')).toBeNull();
    expect(screen.getByTitle('Plant.Mod1.Temp')).toBeTruthy();
    expect(screen.getByTitle('Plant.Mod1.Pressure')).toBeTruthy();
  });

  it('trendable tags are listed in alphabetical order by tag_name', () => {
    renderPicker();
    const rows = screen.getAllByRole('listitem');
    // Alphabetical: Pressure (2) before Temperature (1)
    expect(rows[0]!.textContent).toBe('Pressure');
    expect(rows[1]!.textContent).toBe('Temperature');
  });

  it('clicking an available tag stages it', () => {
    const onCommit = vi.fn();
    renderPicker({ onCommit });
    fireEvent.click(screen.getByTitle('Plant.Mod1.Temp'));
    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith([1]);
  });

  it('already-staged tag in the left pane renders bold and click is a no-op', () => {
    const onCommit = vi.fn();
    renderPicker({ currentTagIds: [1], onCommit });
    const tempRow = screen.getByTitle('Plant.Mod1.Temp');
    expect(tempRow.style.fontWeight).toBe('700');
    fireEvent.click(tempRow);
    fireEvent.click(tempRow);
    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith([1]);
  });

  it('× button in right pane unstages a tag', () => {
    const onCommit = vi.fn();
    renderPicker({ currentTagIds: [1, 2], onCommit });
    fireEvent.click(screen.getByLabelText('Remove Temperature'));
    fireEvent.click(screen.getByText('OK'));
    expect(onCommit).toHaveBeenCalledWith([2]);
  });

  it('cap: 17th add attempt sets error message; removing one clears error', () => {
    const bigMap = new Map<number, TagDef>();
    for (let i = 1; i <= 17; i++) {
      bigMap.set(i, makeTag(i, `Root.Mod.Tag${i}`, true, `Tag${String(i).padStart(2, '0')}`));
    }
    const onCommit = vi.fn();
    const currentTagIds = Array.from({ length: 16 }, (_, i) => i + 1);
    renderPicker({ tagMap: bigMap, currentTagIds, onCommit });

    expect(screen.queryByText(/Max 16 signals/)).toBeNull();
    fireEvent.click(screen.getByTitle('Root.Mod.Tag17'));
    expect(screen.getByText(/Max 16 signals. Remove one to add another./)).toBeTruthy();

    // Remove one — error clears
    fireEvent.click(screen.getAllByTitle(/Remove/)[0]!);
    expect(screen.queryByText(/Max 16 signals/)).toBeNull();
  });

  it('search filters the left list by case-insensitive substring match on tag_name', () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText('Search tags…'), { target: { value: 'pres' } });
    expect(screen.getByTitle('Plant.Mod1.Pressure')).toBeTruthy();
    expect(screen.queryByTitle('Plant.Mod1.Temp')).toBeNull();
  });

  it('search is case-insensitive', () => {
    renderPicker();
    fireEvent.change(screen.getByPlaceholderText('Search tags…'), { target: { value: 'TEMP' } });
    expect(screen.getByTitle('Plant.Mod1.Temp')).toBeTruthy();
    expect(screen.queryByTitle('Plant.Mod1.Pressure')).toBeNull();
  });

  it('hovering a row shows the full tag_path via the title attribute', () => {
    renderPicker();
    expect(screen.getByTitle('Plant.Mod1.Temp').getAttribute('title')).toBe('Plant.Mod1.Temp');
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

  it('Cancel and OK buttons remain visible even with a large tag map', () => {
    const bigMap = new Map<number, TagDef>();
    for (let i = 1; i <= 40; i++) {
      bigMap.set(i, makeTag(i, `Root.Branch${Math.ceil(i / 5)}.Tag${i}`, true));
    }
    renderPicker({ tagMap: bigMap, currentTagIds: [] });
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /ok/i })).not.toBeNull();
  });

  it('Trending list renders full tag_name without truncation', () => {
    const repMap = new Map<number, TagDef>([
      [10, makeTag(10, 'PS1.HV_Switch.Current.Mon', true, 'HV_Switch.Current.Mon')],
      [11, makeTag(11, 'PS1.HV_Switch.Voltage.Mon', true, 'HV_Switch.Voltage.Mon')],
    ]);
    renderPicker({ tagMap: repMap, currentTagIds: [10, 11] });

    // Appears in both left pane (list item) and right pane (staged) — no DOM-level truncation.
    expect(screen.getAllByText('HV_Switch.Current.Mon').length).toBeGreaterThan(0);
    expect(screen.getAllByText('HV_Switch.Voltage.Mon').length).toBeGreaterThan(0);

    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /ok/i })).not.toBeNull();
  });

  it('both panes use the same content-driven width from the longest tag_name', () => {
    const longMap = new Map<number, TagDef>([
      [1, makeTag(1, 'A.B.Short', true, 'ShortName')],
      [2, makeTag(2, 'A.B.Long',  true, 'AVeryLongTagName')],  // 16 chars
    ]);
    renderPicker({ tagMap: longMap, currentTagIds: [1] });
    const FONT_WIDTH_PX = 7.2;
    const PANE_PADDING_PX = 100;
    const MIN_PANE_PX = 200;
    const expectedWidth = Math.max(
      MIN_PANE_PX,
      Math.ceil(16 * FONT_WIDTH_PX) + PANE_PADDING_PX,
    );
    const leftPane = screen.getByRole('list', { name: 'Available tags' });
    // Modal renders via createPortal — query document.body, not container.
    const rightPane = document.body.querySelector('[aria-label="Staged signals"]') as HTMLElement;
    expect(leftPane.style.width).toBe(`${expectedWidth}px`);
    expect(rightPane.style.width).toBe(`${expectedWidth}px`);
  });

  it('pane widths do not change when search narrows the list', () => {
    renderPicker();
    const leftPane = screen.getByRole('list', { name: 'Available tags' });
    const rightPane = document.body.querySelector('[aria-label="Staged signals"]') as HTMLElement;
    const widthBefore = leftPane.style.width;
    expect(widthBefore).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search tags…'), { target: { value: 'temp' } });

    expect(leftPane.style.width).toBe(widthBefore);
    expect(rightPane.style.width).toBe(widthBefore);
  });

  it('outer wrapper width equals paneWidth * 2 + PANE_GAP_PX', () => {
    const longMap = new Map<number, TagDef>([
      [1, makeTag(1, 'A.B.Short', true, 'ShortName')],
      [2, makeTag(2, 'A.B.Long',  true, 'AVeryLongTagName')],  // 16 chars
    ]);
    renderPicker({ tagMap: longMap });
    const FONT_WIDTH_PX = 7.2;
    const PANE_PADDING_PX = 100;
    const MIN_PANE_PX = 200;
    const PANE_GAP_PX = 12;
    const paneWidth = Math.max(
      MIN_PANE_PX,
      Math.ceil(16 * FONT_WIDTH_PX) + PANE_PADDING_PX,
    );
    const wrapper = screen.getByPlaceholderText('Search tags…').parentElement!;
    expect(wrapper.style.width).toBe(`${paneWidth * 2 + PANE_GAP_PX}px`);
  });
});
