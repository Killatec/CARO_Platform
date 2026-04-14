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

  it('displays confirmed live value in idle state', () => {
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' });
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;
    // format: 1 decimal → 42.5
    expect(input.value).toContain('42.5');
  });

  it('clears value and sets placeholder to current live value on focus', () => {
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' });
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;
    fireEvent.focus(input);
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('42.5');
  });

  it('accepts typed input after focus', () => {
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' });
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '75' } });
    expect(input.value).toBe('75');
  });

  it('submits on Enter and retains focus with cleared input', async () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '75' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onWrite).toHaveBeenCalledWith(1003, 75);
    // After submit, input value clears — ready for next entry.
    expect(input.value).toBe('');
  });

  it('updates placeholder to submitted value after Enter', async () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '75' } });

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(input.placeholder).toBe('75.0');
  });

  it('ignores Enter when input is empty', async () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;

    fireEvent.focus(input);
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onWrite).not.toHaveBeenCalled();
  });

  it('ignores Enter when input is non-numeric', async () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(onWrite).not.toHaveBeenCalled();
  });

  it('restores live value on blur without submitting', () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.blur(input);

    expect(onWrite).not.toHaveBeenCalled();
    expect(input.value).toBe('42.5');
  });

  it('is disabled and shows --- when quality is bad (null value)', () => {
    renderWidget(tagDefs, {}, { assetPath: 'RF_Fwd.setpoint' });
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe('---');
  });

  it('is readOnly (not disabled) while write is in progress', async () => {
    let resolveWrite!: () => void;
    const pendingPromise = new Promise<void>(r => { resolveWrite = r; });
    const onWrite = vi.fn().mockReturnValue(pendingPromise);

    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '50' } });

    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    // setAwaitedValue(50) fired → isWriting = true → readOnly (not disabled, so focus is retained).
    expect(input.readOnly).toBe(true);
    expect(input.disabled).toBe(false);

    // Properly await cleanup so the pending promise doesn't leak into subsequent tests.
    await act(async () => {
      resolveWrite();
      await pendingPromise;
    });
  });

  it('shows write error below widget after rejection', async () => {
    const onWrite = vi.fn().mockRejectedValue(new Error('Device rejected: TIMEOUT'));
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '50' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });

    expect(screen.getByTestId('write-error').textContent).toContain('Device rejected: TIMEOUT');
  });

  it('prevents ArrowUp and ArrowDown from incrementing value', () => {
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' });
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '50' } });

    const upEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    input.dispatchEvent(upEvent);
    expect(upEvent.defaultPrevented).toBe(true);

    const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    input.dispatchEvent(downEvent);
    expect(downEvent.defaultPrevented).toBe(true);
  });

  it('Escape restores the live value without submitting', () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    renderWidget(tagDefs, tagValues, { assetPath: 'RF_Fwd.setpoint' }, onWrite);
    const input = screen.getByTestId('numeric-set-input') as HTMLInputElement;

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '99' } });
    expect(input.value).toBe('99'); // confirm edit mode

    fireEvent.keyDown(input, { key: 'Escape' });
    // In a real browser, inputRef.current?.blur() fires the blur event.
    // JSDOM doesn't propagate programmatic blur through React's synthetic system,
    // so we fire it explicitly to simulate the same outcome.
    fireEvent.blur(input);
    expect(input.value).toBe('42.5');
    expect(onWrite).not.toHaveBeenCalled();
  });
});
