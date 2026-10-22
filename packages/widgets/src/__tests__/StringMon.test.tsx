import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import { StringMon } from '../StringMon.js';
import { mockStringTag, mockNumericTag } from './fixtures.js';

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

describe('StringMon', () => {
  it('displays the string value as received', () => {
    render(
      wrapper(
        { 1010: mockStringTag },
        { 1010: { value: 'Running' } },
        <StringMon assetPath="Module_Info.Status" />
      )
    );
    expect(screen.getByText('Running')).toBeDefined();
  });

  it('puts the full text in the title, so a truncated value can still be read', () => {
    const long = 'sha256:6695583f88f149126f6569cbb393dbd41591073ffd584346c4dc72fece8eb18a';
    render(
      wrapper(
        { 1010: mockStringTag },
        { 1010: { value: long } },
        <StringMon assetPath="Module_Info.Status" />
      )
    );
    expect(screen.getByText(long).getAttribute('title')).toBe(long);
  });

  it('shows a non-string value as text instead of failing', () => {
    render(
      wrapper(
        { 1001: mockNumericTag },
        { 1001: { value: 42 } },
        <StringMon assetPath="RF_Fwd.monitor" />
      )
    );
    expect(screen.getByText('42')).toBeDefined();
  });

  it('shows --- in red when value is null', () => {
    render(
      wrapper(
        { 1010: mockStringTag },
        {},
        <StringMon assetPath="Module_Info.Status" />
      )
    );
    expect(screen.getByText('---').className).toContain('text-red-600');
  });

  it('derives label from assetPath when no label prop (last segment)', () => {
    render(
      wrapper(
        { 1010: mockStringTag },
        { 1010: { value: 'x' } },
        <StringMon assetPath="Module_Info.Status" />
      )
    );
    expect(screen.getByText(/Status/)).toBeDefined();
  });

  it('uses label prop when provided', () => {
    render(
      wrapper(
        { 1010: mockStringTag },
        { 1010: { value: 'x' } },
        <StringMon assetPath="Module_Info.Status" label="Module Status" />
      )
    );
    expect(screen.getByText('Module Status')).toBeDefined();
  });

  it('renders error boundary when assetPath matches zero tags', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <MockHmiProvider>
          <StringMon assetPath="DoesNotExist" />
        </MockHmiProvider>
      );
      expect(screen.getByText('Widget error')).toBeDefined();
    } finally {
      spy.mockRestore();
    }
  });
});
