import type { CSSProperties } from 'react';
import { getTrackHex } from './colorMap.js';

export interface ToggleSwitchProps {
  isTrue: boolean;
  badQuality: boolean;
  isWriting: boolean;
  onClick: () => void;
  trueColor?: string;  // default 'green'
  falseColor?: string; // default 'gray'
  ariaLabel?: string;
}

export function ToggleSwitch({
  isTrue,
  badQuality,
  isWriting,
  onClick,
  trueColor = 'green',
  falseColor = 'gray',
  ariaLabel,
}: ToggleSwitchProps) {
  const trackColor = badQuality
    ? '#e5e7eb'
    : isTrue
      ? getTrackHex(trueColor)
      : getTrackHex(falseColor);

  const trackStyle: CSSProperties = {
    width: 28,
    height: 14,
    borderRadius: 7,
    backgroundColor: trackColor,
    position: 'relative',
    transition: 'background-color 0.2s ease',
    cursor: 'pointer',
    opacity: 1,
    border: badQuality ? '2px dashed #f87171' : 'none',
    flexShrink: 0,
  };

  const thumbStyle: CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: '50%',
    backgroundColor: '#fff',
    position: 'absolute',
    top: 2,
    left: isTrue ? 16 : 2,
    transition: 'left 0.2s ease',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isWriting}
      className="flex items-center bg-transparent border-none p-0"
      data-testid="toggle-button"
      role="switch"
      aria-checked={!badQuality && isTrue}
      aria-label={ariaLabel}
    >
      <div style={trackStyle}>
        <div style={thumbStyle} />
      </div>
    </button>
  );
}
