import type { CSSProperties } from 'react';
import type { ModeState } from './useTrendMode.js';

const PRESETS: { label: string; sizeMs: bigint }[] = [
  { label: '1m',  sizeMs: 60_000n },
  { label: '5m',  sizeMs: 300_000n },
  { label: '15m', sizeMs: 15n * 60_000n },
  { label: '1h',  sizeMs: 60n * 60_000n },
  { label: '4h',  sizeMs: 4n * 60n * 60_000n },
  { label: '24h', sizeMs: 24n * 60n * 60_000n },
  { label: '7d',  sizeMs: 7n * 24n * 60n * 60_000n },
  { label: '14d', sizeMs: 14n * 24n * 60n * 60_000n },
];

const BASE_BTN: CSSProperties = {
  padding: '4px 10px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: '#d1d5db',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'monospace',
  fontSize: 12,
  background: '#fff',
  color: '#374151',
};

const ACTIVE_BTN: CSSProperties = {
  ...BASE_BTN,
  background: '#2563eb',
  color: '#fff',
  borderColor: '#2563eb',
};

const ROW: CSSProperties = {
  display: 'flex',
  gap: 4,
};

export interface SpanPresetsProps {
  state: ModeState;
  onPreset: (sizeMs: bigint) => void;
}

/**
 * Horizontal strip of span-preset buttons. Highlight rule:
 *   (lastIntent === 'preset' || lastIntent === 'pan') && state.sizeMs === preset.sizeMs
 * Pan preserves sizeMs, so a preset stays lit through a pan gesture.
 */
export function SpanPresets({ state, onPreset }: SpanPresetsProps) {
  return (
    <div style={ROW}>
      {PRESETS.map(p => {
        const active = (state.lastIntent === 'preset' || state.lastIntent === 'pan') && state.sizeMs === p.sizeMs;
        return (
          <button
            key={p.label}
            type="button"
            style={active ? ACTIVE_BTN : BASE_BTN}
            onClick={() => onPreset(p.sizeMs)}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
