import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import type { TagDef, LiveValue } from '@caro/hmi-context';
import { BooleanSet } from '../BooleanSet.js';
import { mockBoolSetTag } from './fixtures.js';

function renderWidget(
  tagDefs: Record<number, TagDef>,
  tagValues: Record<number, LiveValue>,
  props: Partial<React.ComponentProps<typeof BooleanSet>> & { assetPath: string },
  onWrite?: (tagId: number, value: number | boolean | string) => Promise<void>
) {
  return render(
    <MockHmiProvider tagDefs={tagDefs} tagValues={tagValues} onWrite={onWrite}>
      <BooleanSet {...props} />
    </MockHmiProvider>
  );
}

describe('BooleanSet', () => {
  const tagDefs = { 1005: mockBoolSetTag };

  it('calls write with toggled value on click (true → false)', async () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    renderWidget(
      tagDefs,
      { 1005: { value: true } },
      { assetPath: 'interlock_enable' },
      onWrite
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-button'));
    });
    expect(onWrite).toHaveBeenCalledWith(1005, false);
  });

  it('calls write with toggled value on click (false → true)', async () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    renderWidget(
      tagDefs,
      { 1005: { value: false } },
      { assetPath: 'interlock_enable' },
      onWrite
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-button'));
    });
    expect(onWrite).toHaveBeenCalledWith(1005, true);
  });

  it('shows pending state during write', async () => {
    let resolveWrite!: () => void;
    const pendingPromise = new Promise<void>(r => { resolveWrite = r; });
    const onWrite = vi.fn().mockReturnValue(pendingPromise);

    renderWidget(
      tagDefs,
      { 1005: { value: false } },
      { assetPath: 'interlock_enable' },
      onWrite
    );

    act(() => {
      fireEvent.click(screen.getByTestId('toggle-button'));
    });

    expect(screen.getByTestId('pending-overlay')).toBeDefined();

    await act(async () => {
      resolveWrite();
      await pendingPromise;
    });
  });

  it('shows error on write rejection', async () => {
    const onWrite = vi.fn().mockRejectedValue(new Error('toggle failed'));
    renderWidget(
      tagDefs,
      { 1005: { value: true } },
      { assetPath: 'interlock_enable' },
      onWrite
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-button'));
    });
    expect(screen.getByTestId('write-error').textContent).toContain('toggle failed');
  });

  it('is disabled when value is null', () => {
    renderWidget(tagDefs, {}, { assetPath: 'interlock_enable' });
    const btn = screen.getByTestId('toggle-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('shows confirmation modal when requireConfirm=true', () => {
    renderWidget(
      tagDefs,
      { 1005: { value: false } },
      { assetPath: 'interlock_enable', requireConfirm: true, confirmMessage: 'Really toggle?' }
    );
    fireEvent.click(screen.getByTestId('toggle-button'));
    expect(screen.getByText('Really toggle?')).toBeDefined();
  });
});
