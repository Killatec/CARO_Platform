import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import { NumericMon } from '../NumericMon.js';
import { mockNumericTag, mockNumericTagRev } from './fixtures.js';

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

describe('NumericMon', () => {
  it('displays formatted value with correct decimal places (format: 3 at root level → 3 decimals)', () => {
    const { container } = render(
      wrapper(
        { 1001: mockNumericTag },
        { 1001: { value: 1234.5 } },
        <NumericMon assetPath="RF_Fwd.monitor" />
      )
    );
    expect(container.textContent).toContain('1234.500');
  });

  it('displays unit after value', () => {
    render(
      wrapper(
        { 1001: mockNumericTag },
        { 1001: { value: 42.123 } },
        <NumericMon assetPath="RF_Fwd.monitor" />
      )
    );
    expect(screen.getAllByText('W').length).toBeGreaterThanOrEqual(1);
  });

  it('shows --- when value is null', () => {
    render(
      wrapper(
        { 1001: mockNumericTag },
        {},
        <NumericMon assetPath="RF_Fwd.monitor" />
      )
    );
    expect(screen.getByText('---')).toBeDefined();
  });

  it('applies red tint container when value is null', () => {
    render(
      wrapper(
        { 1001: mockNumericTag },
        {},
        <NumericMon assetPath="RF_Fwd.monitor" />
      )
    );
    const el = screen.getByText('---');
    expect(el.className).toContain('border-red-400');
  });

  it('derives label from assetPath when no label prop (last segment)', () => {
    render(
      wrapper(
        { 1001: mockNumericTag },
        { 1001: { value: 1 } },
        <NumericMon assetPath="RF_Fwd.monitor" />
      )
    );
    // Last segment of "RF_Fwd.monitor" is "monitor"
    expect(screen.getByText(/monitor/i)).toBeDefined();
  });

  it('uses label prop when provided', () => {
    render(
      wrapper(
        { 1001: mockNumericTag },
        { 1001: { value: 1 } },
        <NumericMon assetPath="RF_Fwd.monitor" label="Forward Power" />
      )
    );
    expect(screen.getByText(/Forward Power/i)).toBeDefined();
  });

  it('works with abbreviated assetPath (RF_Fwd.monitor instead of full path)', () => {
    render(
      wrapper(
        { 1001: mockNumericTag },
        { 1001: { value: 999.0 } },
        <NumericMon assetPath="RF_Fwd.monitor" />
      )
    );
    expect(screen.getByText('999.000')).toBeDefined();
  });

  it('throws when assetPath matches zero tags', () => {
    expect(() =>
      render(
        <MockHmiProvider>
          <NumericMon assetPath="DoesNotExist" />
        </MockHmiProvider>
      )
    ).toThrow('NumericMon: no tags found matching assetPath "DoesNotExist"');
  });

  it('throws when assetPath is ambiguous (two tags with same leaf name under different parents)', () => {
    expect(() =>
      render(
        <MockHmiProvider tagDefs={{ 1001: mockNumericTag, 1002: mockNumericTagRev }}>
          <NumericMon assetPath="monitor" />
        </MockHmiProvider>
      )
    ).toThrow(/NumericMon: ambiguous assetPath "monitor" matched 2 tags/);
  });
});
