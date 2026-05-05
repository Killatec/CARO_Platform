import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MockHmiProvider } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { Legend } from '../src/Legend.js';
import type { AggregateSeriesData } from '../src/types.js';

const TAG_DEFS: Record<number, TagDef> = {
  1: { tag_id: 1, tag_path: 'A.B.Temp', data_type: 'float', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: 0, eng_max: 100, unit: '°C', meta: [] },
  2: { tag_id: 2, tag_path: 'A.B.Power', data_type: 'float', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: 'kW', meta: [] },
};

function makeData(): AggregateSeriesData {
  return {
    type: 'aggregate',
    source: '1min_cagg',
    startTime: 0n,
    endTime: 5_000n,
    n: 5,
    bucketSMs: 1000,
    series: new Map([[1, [10, 20, 30, 40, 50]], [2, [1, 2, 3, 4, 5]]]),
  };
}

function renderLegend(
  tagIds: number[] = [1],
  onRemove = vi.fn(),
  opts: { cursorIdx?: number; showLastWhenIdle?: boolean } = {},
) {
  return render(
    <MockHmiProvider tagDefs={TAG_DEFS}>
      <Legend
        tagIds={tagIds}
        data={makeData()}
        tagMap={new Map([[1, TAG_DEFS[1]!], [2, TAG_DEFS[2]!]])}
        selectedTagId={tagIds[0] ?? 1}
        cursorIdx={opts.cursorIdx}
        showLastWhenIdle={opts.showLastWhenIdle ?? true}
        onSelect={vi.fn()}
        onRemove={onRemove}
      />
    </MockHmiProvider>,
  );
}

describe('Legend — entry rows', () => {
  it('renders the tag short name for each tagId', () => {
    renderLegend([1, 2]);
    expect(screen.getByText('Temp')).toBeTruthy();
    expect(screen.getByText('Power')).toBeTruthy();
  });

  it('renders a remove button for each tag', () => {
    renderLegend([1, 2]);
    expect(screen.getAllByTitle('Remove trace')).toHaveLength(2);
  });

  it('calls onRemove with the correct tagId when remove is clicked', () => {
    const onRemove = vi.fn();
    renderLegend([1, 2], onRemove);
    const btns = screen.getAllByTitle('Remove trace');
    fireEvent.click(btns[0]!);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('selected tag name is bold; unselected is not', () => {
    renderLegend([1, 2]);
    expect(screen.getByText('Temp').style.fontWeight).toBe('700');
    expect(screen.getByText('Power').style.fontWeight).not.toBe('700');
  });

  it('cursorIdx undefined + showLastWhenIdle=true → shows last-bucket value', () => {
    renderLegend([1], vi.fn(), { showLastWhenIdle: true });
    // Last value in series [10,20,30,40,50] = 50 °C
    expect(screen.getByText('50 °C')).toBeTruthy();
  });

  it('cursorIdx undefined + showLastWhenIdle=false → shows em-dash placeholder', () => {
    renderLegend([1], vi.fn(), { showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('cursorIdx defined → shows that bucket value regardless of showLastWhenIdle', () => {
    // series for tag 1 = [10,20,30,40,50]; index 1 → 20 °C
    renderLegend([1], vi.fn(), { cursorIdx: 1, showLastWhenIdle: false });
    expect(screen.getByText('20 °C')).toBeTruthy();
  });
});
