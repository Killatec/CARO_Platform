import { useLiveValue, useTagWriter } from '@caro/hmi-context';
import { Button, Modal, Tooltip } from '@caro/ui';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveLabel } from './shared/utils.js';
import { ROW_CONTAINER, LABEL_CLASS, COL } from './shared/widgetStyles.js';
import { useWriteGuard } from './shared/useWriteGuard.js';
import { useState } from 'react';

export interface BooleanSetProps {
  assetPath: string;
  label?: string;
  trueLabel?: string;
  falseLabel?: string;
  trueColor?: string;
  falseColor?: string;
  requireConfirm?: boolean;
  confirmMessage?: string;
}

const TRACK_COLOR_MAP: Record<string, string> = {
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
  gray: '#d1d5db',
};

export function BooleanSet({
  assetPath,
  label,
  trueLabel = 'ON',
  falseLabel = 'OFF',
  trueColor = 'green',
  falseColor = 'gray',
  requireConfirm = false,
  confirmMessage,
}: BooleanSetProps) {
  const tag = useSingleTag(assetPath, 'BooleanSet');
  const lv = useLiveValue(tag.tag_id);
  const { write, error } = useTagWriter();
  const displayLabel = resolveLabel(assetPath, label);

  const badQuality = lv.value === null;
  const writeError = error(tag.tag_id);

  const { setAwaitedValue, isWriting } = useWriteGuard(tag.tag_id, lv.value, writeError);

  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingNewValue, setPendingNewValue] = useState<boolean | null>(null);

  function handleToggle() {
    if (badQuality || isWriting) return;
    const newValue = !(lv.value as boolean);
    if (requireConfirm) {
      setPendingNewValue(newValue);
      setShowConfirm(true);
    } else {
      setAwaitedValue(newValue);
      void write(tag.tag_id, newValue);
    }
  }

  function handleModalConfirm() {
    if (pendingNewValue === null) return;
    const value = pendingNewValue;
    setPendingNewValue(null);
    setShowConfirm(false);
    setAwaitedValue(value);
    void write(tag.tag_id, value);
  }

  const isTrue = lv.value === true;
  const nextLabel = isTrue ? falseLabel : trueLabel;
  const resolvedConfirmMessage =
    confirmMessage ?? `Set ${displayLabel} to ${pendingNewValue ? trueLabel : falseLabel}?`;

  // Switch track and thumb styles
  const trackColor = badQuality
    ? '#e5e7eb'
    : isTrue
      ? (TRACK_COLOR_MAP[trueColor] ?? '#22c55e')
      : (TRACK_COLOR_MAP[falseColor] ?? '#d1d5db');

  const trackStyle: React.CSSProperties = {
    width: 28,
    height: 14,
    borderRadius: 7,
    backgroundColor: trackColor,
    position: 'relative',
    transition: 'background-color 0.2s ease',
    cursor: badQuality ? 'not-allowed' : 'pointer',
    opacity: badQuality ? 0.5 : 1,
    border: badQuality ? '1px dashed #f87171' : 'none',
    flexShrink: 0,
  };

  const thumbStyle: React.CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: '50%',
    backgroundColor: '#fff',
    position: 'absolute',
    top: 2,
    left: (!badQuality && isTrue) ? 16 : 2,
    transition: 'left 0.2s ease',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
  };

  return (
    <div className="flex flex-col self-start">
      <div className={ROW_CONTAINER}>
        <span className={LABEL_CLASS}>{displayLabel}</span>
        <div className={`${COL.value} flex justify-end`}>
        <Tooltip content={badQuality ? 'Cannot write — device not connected' : undefined}>
          <button
            type="button"
            onClick={handleToggle}
            disabled={badQuality || isWriting}
            className="flex items-center bg-transparent border-none p-0"
            data-testid="toggle-button"
            aria-label={`Toggle ${displayLabel}. Current: ${isTrue ? trueLabel : falseLabel}. Click to set ${nextLabel}`}
            role="switch"
            aria-checked={!badQuality && isTrue}
          >
            <div style={trackStyle}>
              <div style={thumbStyle} />
            </div>
          </button>
        </Tooltip>
        </div>
      </div>

      {writeError && (
        <span className="text-xs text-red-600 mt-1 ml-[138px]" data-testid="write-error">{writeError}</span>
      )}

      <Modal
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingNewValue(null); }}
        title="Confirm"
      >
        <p className="mb-4 text-gray-700">{resolvedConfirmMessage}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setShowConfirm(false); setPendingNewValue(null); }}>Cancel</Button>
          <Button variant="primary" onClick={handleModalConfirm}>Confirm</Button>
        </div>
      </Modal>
    </div>
  );
}
