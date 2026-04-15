import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import { AnalogIn } from '../AnalogIn.js';
import { prfTagDefs, prfTagValues } from './fixtures.js';

function renderWidget(
  props: React.ComponentProps<typeof AnalogIn>,
  tagValues: Record<number, import('@caro/hmi-context').LiveValue> = prfTagValues,
) {
  return render(
    <MockHmiProvider tagDefs={prfTagDefs} tagValues={tagValues}>
      <AnalogIn {...props} />
    </MockHmiProvider>
  );
}

describe('AnalogIn', () => {
  it('renders all 9 cells with correct values when all tags have good quality', () => {
    renderWidget({ assetPath: 'RF1.PRF', label: 'PRF' });

    // NumericSetCells are inputs with aria-label matching child name (Set, Tol, RSS, Per, In_A, In_B).
    // In idle state they display the formatted live value (format: 2 → 2 decimal places).
    const setInput = screen.getByRole('textbox', { name: 'Set' }) as HTMLInputElement;
    expect(setInput.value).toBe('20.50');

    const tolInput = screen.getByRole('textbox', { name: 'Tol' }) as HTMLInputElement;
    expect(tolInput.value).toBe('1.00');

    const rssInput = screen.getByRole('textbox', { name: 'RSS' }) as HTMLInputElement;
    expect(rssInput.value).toBe('18.70');

    const perInput = screen.getByRole('textbox', { name: 'Per' }) as HTMLInputElement;
    expect(perInput.value).toBe('100.00');

    const inAInput = screen.getByRole('textbox', { name: 'In_A' }) as HTMLInputElement;
    expect(inAInput.value).toBe('21.20');

    const inBInput = screen.getByRole('textbox', { name: 'In_B' }) as HTMLInputElement;
    expect(inBInput.value).toBe('19.80');

    // NumericMonCell (Mon) renders formatted text, not an input.
    expect(screen.getByText('15.30')).toBeDefined();

    // BooleanSetCell (By) renders a toggle button.
    expect(screen.getByRole('switch', { name: /Toggle By/ })).toBeDefined();

    // BooleanMonCell (Intk) renders a state dot.
    expect(screen.getByTestId('state-dot')).toBeDefined();
  });

  it('shows "---" for an individual cell with a null value (partial bad quality)', () => {
    // Omit Mon (tag_id 2002) — all other tags have values.
    const valuesWithoutMon: Record<number, import('@caro/hmi-context').LiveValue> = {
      ...prfTagValues,
      2002: { value: null },
    };
    renderWidget({ assetPath: 'RF1.PRF', label: 'PRF' }, valuesWithoutMon);

    // NumericMonCell for Mon should show '---'.
    expect(screen.getByText('---')).toBeDefined();

    // Other numeric cells remain good — Set should still show its value.
    const setInput = screen.getByRole('textbox', { name: 'Set' }) as HTMLInputElement;
    expect(setInput.value).toBe('20.50');
  });

  it('renders header row when showHeader=true and omits it when false', () => {
    const { rerender } = renderWidget({ assetPath: 'RF1.PRF', label: 'PRF', showHeader: true });

    // 'In_A' only appears as visible text in the header (inputs use aria-label, not text content).
    expect(screen.getByText('In_A')).toBeDefined();

    rerender(
      <MockHmiProvider tagDefs={prfTagDefs} tagValues={prfTagValues}>
        <AnalogIn assetPath="RF1.PRF" label="PRF" showHeader={false} />
      </MockHmiProvider>
    );

    expect(screen.queryByText('In_A')).toBeNull();
  });

  it('defaults label to last segment of assetPath when label prop is omitted', () => {
    renderWidget({ assetPath: 'RF1.PRF' });
    // Last segment of "RF1.PRF" is "PRF".
    expect(screen.getByText('PRF')).toBeDefined();
  });
});
