import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MockHmiProvider } from '@caro/hmi-context/testing';
import type { TagDef, LiveValue } from '@caro/hmi-context';
import { BooleanMon } from '../BooleanMon.js';
import { mockBoolTag } from './fixtures.js';

function renderWidget(
  tagDefs: Record<number, TagDef>,
  tagValues: Record<number, LiveValue>,
  props: Partial<React.ComponentProps<typeof BooleanMon>> & { assetPath: string }
) {
  return render(
    <MockHmiProvider tagDefs={tagDefs} tagValues={tagValues}>
      <BooleanMon {...props} />
    </MockHmiProvider>
  );
}

describe('BooleanMon', () => {
  const tagDefs = { 1004: mockBoolTag };

  it('shows trueLabel when value is true', () => {
    renderWidget(tagDefs, { 1004: { value: true } }, { assetPath: 'interlock_status' });
    expect(screen.getByTestId('state-label').textContent).toBe('ON');
  });

  it('shows falseLabel when value is false', () => {
    renderWidget(tagDefs, { 1004: { value: false } }, { assetPath: 'interlock_status' });
    expect(screen.getByTestId('state-label').textContent).toBe('OFF');
  });

  it('uses custom trueLabel/falseLabel', () => {
    renderWidget(
      tagDefs,
      { 1004: { value: true } },
      { assetPath: 'interlock_status', trueLabel: 'ACTIVE', falseLabel: 'INACTIVE' }
    );
    expect(screen.getByTestId('state-label').textContent).toBe('ACTIVE');
  });

  it('shows colored dot matching trueColor when true', () => {
    renderWidget(
      tagDefs,
      { 1004: { value: true } },
      { assetPath: 'interlock_status', trueColor: 'green' }
    );
    const dot = screen.getByTestId('state-dot');
    expect(dot.className).toContain('bg-green-500');
  });

  it('shows colored dot matching falseColor when false', () => {
    renderWidget(
      tagDefs,
      { 1004: { value: false } },
      { assetPath: 'interlock_status', falseColor: 'red' }
    );
    const dot = screen.getByTestId('state-dot');
    expect(dot.className).toContain('bg-red-500');
  });

  it('shows --- when value is null', () => {
    renderWidget(tagDefs, {}, { assetPath: 'interlock_status' });
    expect(screen.getByTestId('state-label').textContent).toBe('---');
  });

  it('shows dashed circle indicator when value is null', () => {
    renderWidget(tagDefs, {}, { assetPath: 'interlock_status' });
    const dot = screen.getByTestId('state-dot');
    expect(dot.className).toContain('border-dashed');
    expect(dot.className).toContain('border-red-400');
  });
});
