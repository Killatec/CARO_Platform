import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
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
    expect(el.className).toContain('text-red-600');
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

  it('renders error boundary when assetPath matches zero tags', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <MockHmiProvider>
          <NumericMon assetPath="DoesNotExist" />
        </MockHmiProvider>
      );
      expect(screen.getByText('Widget error')).toBeDefined();
      expect(screen.getByText('DoesNotExist')).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('renders error boundary when assetPath is ambiguous', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <MockHmiProvider tagDefs={{ 1001: mockNumericTag, 1002: mockNumericTagRev }}>
          <NumericMon assetPath="monitor" />
        </MockHmiProvider>
      );
      expect(screen.getByText('Widget error')).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
