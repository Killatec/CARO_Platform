import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import type { TagDef, LiveValue } from '@caro/hmi-context';
import { NumericSet } from '../NumericSet.js';
import { mockSetpointTag } from './fixtures.js';

function renderWidget(
  tagDefs: Record<number, TagDef>,
  tagValues: Record<number, LiveValue>,
  props: Partial<React.ComponentProps<typeof NumericSet>> & { assetPath: string },
  onWrite?: (tagId: number, value: number | boolean | string) => Promise<void>
) {
  return render(
    <MockHmiProvider tagDefs={tagDefs} tagValues={tagValues} onWrite={onWrite}>
      <NumericSet {...props} />
    </MockHmiProvider>
  );
}

describe('NumericSet', () => {
  const tagDefs = { 1003: mockSetpointTag };
  const tagValues = { 1003: { value: 42.5 } };

  it('displays confirmed value in normal state', () => {
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' });
    // format: 1 decimal → 42.5
    expect(screen.getByTestId('display-value').textContent).toContain('42.5');
  });

  it('opens input on click', () => {
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' });
    fireEvent.click(screen.getByTestId('display-value'));
    expect(screen.getByRole('spinbutton')).toBeDefined();
  });

  it('pre-fills input with current value', () => {
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' });
    fireEvent.click(screen.getByTestId('display-value'));
    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    expect(input.value).toBe('42.5');
  });

  it('shows validation error for value below eng_min', () => {
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' });
    fireEvent.click(screen.getByTestId('display-value'));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '-1' } });
    fireEvent.click(screen.getByText('Set'));
    expect(screen.getByTestId('validation-error').textContent).toContain('Min value is 0');
  });

  it('shows validation error for value above eng_max', () => {
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' });
    fireEvent.click(screen.getByTestId('display-value'));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.click(screen.getByText('Set'));
    expect(screen.getByTestId('validation-error').textContent).toContain('Max value is 100');
  });

  it('calls write on confirm with parsed numeric value', async () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    fireEvent.click(screen.getByTestId('display-value'));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '75' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Set'));
    });
    expect(onWrite).toHaveBeenCalledWith(1003, 75);
  });

  it('shows pending state during write (finds the pending indicator)', async () => {
    let resolveWrite!: () => void;
    const pendingPromise = new Promise<void>(r => { resolveWrite = r; });
    const onWrite = vi.fn().mockReturnValue(pendingPromise);

    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    fireEvent.click(screen.getByTestId('display-value'));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '50' } });

    act(() => {
      fireEvent.click(screen.getByText('Set'));
    });

    expect(screen.getByTestId('pending-overlay')).toBeDefined();

    await act(async () => {
      resolveWrite();
      await pendingPromise;
    });
  });

  it('shows error message on write rejection', async () => {
    const onWrite = vi.fn().mockRejectedValue(new Error('write rejected'));
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    fireEvent.click(screen.getByTestId('display-value'));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '50' } });
    await act(async () => {
      fireEvent.click(screen.getByText('Set'));
    });
    expect(screen.queryByTestId('write-error')?.textContent).toContain('write rejected');
  });

  it('disables edit when value is null', () => {
    renderWidget(tagDefs, {}, { assetPath: 'RF_Fwd.setpoint' });
    const displayEl = screen.getByTestId('display-value');
    expect(displayEl.className).toContain('cursor-not-allowed');
    fireEvent.click(displayEl);
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('cancels edit on Escape key', () => {
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' });
    fireEvent.click(screen.getByTestId('display-value'));
    expect(screen.getByRole('spinbutton')).toBeDefined();
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Escape' });
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });

  it('shows confirmation modal when requireConfirm=true', async () => {
    renderWidget(tagDefs, tagValues, {
      assetPath: 'RF_Fwd.setpoint',
      requireConfirm: true,
      confirmMessage: 'Are you sure?',
    });
    fireEvent.click(screen.getByTestId('display-value'));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.click(screen.getByText('Set'));
    expect(screen.getByText('Are you sure?')).toBeDefined();
  });
});
