import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type uPlot from 'uplot';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import { SpectrumChart } from '../SpectrumChart.js';
import { mockArrayTag } from './fixtures.js';

// ── uPlot mock (canvas not available in jsdom) ────────────────────────────────

const setDataMock = vi.fn();
const destroyMock = vi.fn();
let lastConfig: uPlot.Options | undefined;

vi.mock('uplot', () => {
  const MockUPlot = vi.fn().mockImplementation((config: uPlot.Options) => {
    lastConfig = config;
    return {
      destroy: destroyMock,
      setData: setDataMock,
      setSize: vi.fn(),
    };
  });
  return { default: MockUPlot };
});

vi.mock('uplot/dist/uPlot.min.css', () => ({}));

function wrapper(
  tagDefs: Record<number, import('@caro/hmi-context').TagDef>,
  tagValues: Record<number, import('@caro/hmi-context').LiveValue>,
  children: React.ReactNode
) {
  return (
    <MockHmiProvider tagDefs={tagDefs} tagValues={tagValues}>
      {children}
    </MockHmiProvider>
  );
}

describe('SpectrumChart', () => {
  it('renders the label', () => {
    render(
      wrapper(
        { 1006: mockArrayTag },
        { 1006: { value: [1, 2, 3] } },
        <SpectrumChart assetPath="RF_Fwd.spectrum" />
      )
    );
    expect(screen.getByText('spectrum')).toBeDefined();
  });

  it('uses label prop when provided', () => {
    render(
      wrapper(
        { 1006: mockArrayTag },
        { 1006: { value: [1, 2, 3] } },
        <SpectrumChart assetPath="RF_Fwd.spectrum" label="Spectrum" />
      )
    );
    expect(screen.getByText('Spectrum')).toBeDefined();
  });

  it('pushes bin-indexed data into uPlot when the array value arrives', () => {
    render(
      wrapper(
        { 1006: mockArrayTag },
        { 1006: { value: [10, 20, 30] } },
        <SpectrumChart assetPath="RF_Fwd.spectrum" />
      )
    );
    expect(setDataMock).toHaveBeenCalledWith([[0, 1, 2], [10, 20, 30]]);
  });

  it('shows --- and clears data when value is null', () => {
    render(
      wrapper(
        { 1006: mockArrayTag },
        {},
        <SpectrumChart assetPath="RF_Fwd.spectrum" />
      )
    );
    expect(screen.getByText('---')).toBeDefined();
    expect(setDataMock).toHaveBeenCalledWith([[], []]);
  });

  it('destroys the uPlot instance on unmount', () => {
    const { unmount } = render(
      wrapper(
        { 1006: mockArrayTag },
        { 1006: { value: [1, 2] } },
        <SpectrumChart assetPath="RF_Fwd.spectrum" />
      )
    );
    unmount();
    expect(destroyMock).toHaveBeenCalled();
  });

  it('drag-selects a box and zooms both axes via setScale', () => {
    render(
      wrapper(
        { 1006: mockArrayTag },
        { 1006: { value: [1, 2, 3] } },
        <SpectrumChart assetPath="RF_Fwd.spectrum" />
      )
    );
    const setScaleMock = vi.fn();
    const setSelectMock = vi.fn();
    // posToVal(pos, 'x') => pos * 10; posToVal(pos, 'y') => 1000 - pos * 2 (pixel Y inverted)
    const posToVal = vi.fn((pos: number, key: string) => (key === 'x' ? pos * 10 : 1000 - pos * 2));
    const mockU = {
      select: { left: 5, top: 20, width: 10, height: 30 },
      posToVal,
      setScale: setScaleMock,
      setSelect: setSelectMock,
    } as unknown as uPlot;

    const setSelectHook = lastConfig!.hooks!.setSelect![0]!;
    setSelectHook(mockU);

    // x: posToVal(5,'x')=50, posToVal(15,'x')=150
    expect(setScaleMock).toHaveBeenCalledWith('x', { min: 50, max: 150 });
    // y: top=posToVal(20,'y')=960, bottom=posToVal(50,'y')=900 -> min=900,max=960
    expect(setScaleMock).toHaveBeenCalledWith('y', { min: 900, max: 960 });
    expect(setSelectMock).toHaveBeenCalledWith({ left: 0, top: 0, width: 0, height: 0 }, false);
  });

  it('resets both axes to full range on double-click', () => {
    render(
      wrapper(
        { 1006: mockArrayTag },
        { 1006: { value: [1, 2, 3, 4, 5] } },
        <SpectrumChart assetPath="RF_Fwd.spectrum" yMax={2100} />
      )
    );
    const setScaleMock = vi.fn();
    const mockU = { setScale: setScaleMock } as unknown as uPlot;

    const dblclickFactory = lastConfig!.cursor!.bind!.dblclick!;
    const listener = dblclickFactory(mockU, document.createElement('div'), vi.fn());
    listener!(new MouseEvent('dblclick'));

    expect(setScaleMock).toHaveBeenCalledWith('x', { min: 0, max: 4 });
    expect(setScaleMock).toHaveBeenCalledWith('y', { min: 0, max: 2100 });
  });

  it('renders error boundary when assetPath matches zero tags', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <MockHmiProvider>
          <SpectrumChart assetPath="DoesNotExist" />
        </MockHmiProvider>
      );
      expect(screen.getByText('Widget error')).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
