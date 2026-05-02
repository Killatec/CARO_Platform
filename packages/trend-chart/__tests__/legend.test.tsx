import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MockHmiProvider } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { Legend } from '../src/Legend.js';
import type { AggregateSeriesData } from '../src/types.js';

const TAG_DEFS: Record<number, TagDef> = {
  1: { tag_id: 1, tag_path: 'A.B.Temp', data_type: 'float', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: 0, eng_max: 100, unit: '°C', meta: [] },
};

function makeData(): AggregateSeriesData {
  return {
    type: 'aggregate',
    source: '1min_cagg',
    startTime: 0n,
    endTime: 5_000n,
    n: 5,
    bucketSMs: 1000,
    series: new Map([[1, [1, 2, 3, 4, 5]]]),
  };
}

function renderLegend(cursorTsMs?: number | null, siteTimezone?: string) {
  return render(
    <MockHmiProvider tagDefs={TAG_DEFS}>
      <Legend
        tagIds={[1]}
        data={makeData()}
        tagMap={new Map([[1, TAG_DEFS[1]!]])}
        selectedTagId={1}
        onSelect={vi.fn()}
        onRemove={vi.fn()}
        cursorTsMs={cursorTsMs}
        siteTimezone={siteTimezone}
      />
    </MockHmiProvider>,
  );
}

describe('Legend — cursor time display', () => {
  it('shows "Time: --" when cursorTsMs is undefined', () => {
    renderLegend(undefined, 'UTC');
    expect(screen.getByText(/^Time:/).textContent).toBe('Time: --');
  });

  it('shows "Time: --" when cursorTsMs is null', () => {
    renderLegend(null, 'UTC');
    expect(screen.getByText(/^Time:/).textContent).toBe('Time: --');
  });

  it('renders a formatted timestamp when cursorTsMs is provided', () => {
    // 2024-01-15 12:00:00 UTC → 1705320000000 ms
    renderLegend(1_705_320_000_000, 'UTC');
    const el = screen.getByText(/^Time:/);
    expect(el.textContent).not.toBe('Time: --');
    expect(el.textContent).toContain('2024');
  });

  it('produces different output for America/Chicago vs Asia/Tokyo for the same cursorTsMs', () => {
    const tsMs = 1_705_320_000_000; // 2024-01-15 12:00:00 UTC

    const { unmount } = renderLegend(tsMs, 'America/Chicago');
    const chicagoText = screen.getByText(/^Time:/).textContent;
    unmount();

    renderLegend(tsMs, 'Asia/Tokyo');
    const tokyoText = screen.getByText(/^Time:/).textContent;

    expect(chicagoText).not.toBe(tokyoText);
  });
});
