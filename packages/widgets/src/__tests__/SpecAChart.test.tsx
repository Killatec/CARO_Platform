import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type uPlot from 'uplot';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import type { TagDef, LiveValue } from '@caro/hmi-context';
import { SpecAChart } from '../SpecAChart.js';

// ── uPlot mock (canvas not available in jsdom) ────────────────────────────────

const setDataMock = vi.fn();
const destroyMock = vi.fn();
let lastConfig: uPlot.Options | undefined;

vi.mock('uplot', () => {
  const MockUPlot = vi.fn().mockImplementation((config: uPlot.Options) => {
    lastConfig = config;
    return { destroy: destroyMock, setData: setDataMock, setSize: vi.fn() };
  });
  // Only reached with two traces; these tests keep both on one axis.
  (MockUPlot as unknown as { join: unknown }).join = (tables: number[][][]) => [
    tables[0][0],
    tables[0][1],
    tables[1][1],
  ];
  return { default: MockUPlot };
});

vi.mock('uplot/dist/uPlot.min.css', () => ({}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CHILDREN = [
  'Spectrum',
  'Spec_Start',
  'Spec_Bin',
  'Spec_Trace_Ok',
  'Spec_Intk_Level_Mon',
  'Spec_Intk_Band_Mon',
  'Spec_Intk_Freq_Mon',
] as const;

const ID: Record<(typeof CHILDREN)[number], number> = {
  Spectrum: 1,
  Spec_Start: 2,
  Spec_Bin: 3,
  Spec_Trace_Ok: 4,
  Spec_Intk_Level_Mon: 5,
  Spec_Intk_Band_Mon: 6,
  Spec_Intk_Freq_Mon: 7,
};

function tagDef(name: string, id: number): TagDef {
  return {
    tag_id: id,
    tag_path: `Narya1.RF1.SpecA.${name}`,
    tag_name: null,
    data_type: name === 'Spectrum' ? 'i16[]' : 'f32',
    is_setpoint: false,
    trendable: false,
    module_id: 'RF1',
    module_type: 'MQTT',
    eng_min: null,
    eng_max: null,
    unit: null,
    format: null,
    meta: [
      { type: 'system', name: 'Narya1', fields: {} },
      { type: 'module', name: 'RF1', fields: {} },
      { type: 'parameter', name: 'SpecA', fields: {} },
      { type: 'tag', name, fields: {} },
    ],
  };
}

const TAG_DEFS: Record<number, TagDef> = Object.fromEntries(
  CHILDREN.map((c) => [ID[c], tagDef(c, ID[c])]),
);

type Values = Partial<Record<(typeof CHILDREN)[number], unknown>>;

function toLive(values: Values): Record<number, LiveValue> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [ID[k as (typeof CHILDREN)[number]], { value: v } as LiveValue]),
  );
}

const FRAME: Values = {
  Spectrum: [-900, -230],
  Spec_Start: 912.5,
  Spec_Bin: 5000,
  Spec_Trace_Ok: true,
  Spec_Intk_Level_Mon: -45,
  Spec_Intk_Band_Mon: 200,
  Spec_Intk_Freq_Mon: 912.505,
};

function renderChart(values: Values) {
  const ui = (v: Values) => (
    <MockHmiProvider tagDefs={TAG_DEFS} tagValues={toLive(v)}>
      <SpecAChart assetPath="RF1.SpecA" label="Spectrum" />
    </MockHmiProvider>
  );
  const r = render(ui(values));
  return { ...r, update: (v: Values) => r.rerender(ui(v)) };
}

const lastData = () => setDataMock.mock.calls[setDataMock.mock.calls.length - 1][0];

beforeEach(() => {
  setDataMock.mockClear();
  destroyMock.mockClear();
});

describe('SpecAChart', () => {
  it('renders the label, MHz/dBFS axes and a fixed -110..0 Y range', () => {
    renderChart(FRAME);
    expect(screen.getByText('Spectrum')).toBeDefined();
    expect(lastConfig!.axes![0].label).toBe('MHz');
    expect(lastConfig!.axes![1].label).toBe('dBFS');
    const yRange = lastConfig!.scales!.y.range as () => [number, number];
    expect(yRange()).toEqual([-110, 0]);
  });

  it('auto-ranges X from the data on every setData, unless zoomed', () => {
    renderChart(FRAME);
    const x = lastConfig!.scales!.x;
    expect(x.auto).toBe(true);
    const range = x.range as (u: uPlot, min: number, max: number) => [number, number];
    expect(range({} as uPlot, 912.5, 917.5)).toEqual([912.5, 917.5]);
  });

  it('draws a clean frame on the live trace, in MHz and dBFS', () => {
    renderChart(FRAME);
    expect(lastData()).toEqual([[912.5, 912.505], [-90, -23], [null, null]]);
  });

  it('draws a bad frame on the offender trace and clears the live trace', () => {
    renderChart({ ...FRAME, Spec_Trace_Ok: false });
    expect(lastData()).toEqual([[912.5, 912.505], [null, null], [-90, -23]]);
  });

  it('keeps the offender when a later clean frame arrives', () => {
    const { update } = renderChart({ ...FRAME, Spec_Trace_Ok: false });
    update({ ...FRAME, Spectrum: [-800, -700] });
    expect(lastData()).toEqual([[912.5, 912.505], [-80, -70], [-90, -23]]);
  });

  it('treats an empty array as no frame: blanks live, keeps the offender, ignores Spec_Trace_Ok', () => {
    const { update } = renderChart({ ...FRAME, Spec_Trace_Ok: false });
    update({ ...FRAME, Spectrum: [-800, -700] });
    update({ ...FRAME, Spectrum: [], Spec_Start: 0, Spec_Bin: 0, Spec_Trace_Ok: false });
    expect(lastData()).toEqual([[912.5, 912.505], [null, null], [-90, -23]]);
  });

  it('shows --- when the spectrum is null (stalled module)', () => {
    renderChart({ ...FRAME, Spectrum: null });
    expect(screen.getByText('---')).toBeDefined();
    expect(lastData()).toEqual([[], [], []]);
  });

  it('Clear wipes both traces', () => {
    const { update } = renderChart({ ...FRAME, Spec_Trace_Ok: false });
    update({ ...FRAME, Spectrum: [-800, -700] });
    fireEvent.click(screen.getByText('Clear'));
    expect(lastData()).toEqual([[], [], []]);
  });

  it('resets both axes to the data range and -110..0 on double-click', () => {
    renderChart(FRAME);
    const setScaleMock = vi.fn();
    const mockU = { setScale: setScaleMock, data: [[912.5, 913, 917.5]] } as unknown as uPlot;
    const listener = lastConfig!.cursor!.bind!.dblclick!(mockU, document.createElement('div'), vi.fn());
    listener!(new MouseEvent('dblclick'));
    expect(setScaleMock).toHaveBeenCalledWith('x', { min: 912.5, max: 917.5 });
    expect(setScaleMock).toHaveBeenCalledWith('y', { min: -110, max: 0 });
  });

  it('destroys the uPlot instance on unmount', () => {
    const { unmount } = renderChart(FRAME);
    unmount();
    expect(destroyMock).toHaveBeenCalled();
  });

  it('renders the error boundary when a child tag is missing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <MockHmiProvider>
          <SpecAChart assetPath="RF1.SpecA" />
        </MockHmiProvider>,
      );
      expect(screen.getByText('Widget error')).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
