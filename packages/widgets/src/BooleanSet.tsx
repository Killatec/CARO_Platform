import { useLiveValue, useTagWriter } from '@caro/hmi-context';
import { Button, Modal, Tooltip } from '@caro/ui';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveLabel } from './shared/utils.js';
import { WidgetLabel } from './shared/WidgetLabel.js';
import { PendingOverlay } from './shared/PendingOverlay.js';
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

const COLOR_MAP: Record<string, string> = {
  green: 'bg-green-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  gray: 'bg-gray-400',
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
  const { write, isPending, error } = useTagWriter();
  const displayLabel = resolveLabel(assetPath, label);

  const badQuality = lv.value === null;
  const pending = isPending(tag.tag_id);
  const writeError = error(tag.tag_id);

  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingNewValue, setPendingNewValue] = useState<boolean | null>(null);

  function handleToggle() {
    if (badQuality || pending) return;
    const newValue = !(lv.value as boolean);
    if (requireConfirm) {
      setPendingNewValue(newValue);
      setShowConfirm(true);
    } else {
      void write(tag.tag_id, newValue);
    }
  }

  function handleModalConfirm() {
    if (pendingNewValue === null) return;
    const value = pendingNewValue;
    setPendingNewValue(null);
    setShowConfirm(false);
    void write(tag.tag_id, value);
  }

  const isTrue = lv.value === true;
  let dotClass: string;
  let stateText: string;

  if (badQuality) {
    dotClass = 'w-3 h-3 rounded-full border-2 border-dashed border-red-400 bg-transparent';
    stateText = '---';
  } else {
    const colorKey = isTrue ? trueColor : falseColor;
    dotClass = `w-3 h-3 rounded-full ${COLOR_MAP[colorKey] ?? 'bg-gray-400'}`;
    stateText = isTrue ? trueLabel : falseLabel;
  }

  const nextLabel = isTrue ? falseLabel : trueLabel;
  const resolvedConfirmMessage =
    confirmMessage ?? `Set ${displayLabel} to ${pendingNewValue ? trueLabel : falseLabel}?`;

  return (
    <div className="inline-flex flex-col p-2 rounded border border-gray-200 bg-white min-w-[100px]">
      <WidgetLabel label={displayLabel} />
      <Tooltip content={badQuality ? 'Cannot write — device not connected' : undefined}>
        <button
          type="button"
          onClick={handleToggle}
          disabled={badQuality || pending}
          className={`flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium transition-colors ${
            badQuality
              ? 'cursor-not-allowed opacity-60'
              : pending
                ? 'opacity-60 cursor-wait'
                : 'hover:bg-gray-100 cursor-pointer'
          }`}
          data-testid="toggle-button"
          aria-label={`Toggle ${displayLabel}. Current: ${stateText}. Click to set ${nextLabel}`}
        >
          <span className={dotClass} data-testid="state-dot" />
          <span data-testid="state-label">{badQuality ? '---' : stateText}</span>
          <PendingOverlay isPending={pending} />
        </button>
      </Tooltip>
      {writeError && (
        <span className="text-xs text-red-600 mt-1" data-testid="write-error">{writeError}</span>
      )}

      <Modal
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); setPendingNewValue(null); }}
        title="Confirm"
      >
        <p className="mb-4 text-gray-700">{resolvedConfirmMessage}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setShowConfirm(false); setPendingNewValue(null); }}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleModalConfirm}>
            Confirm
          </Button>
        </div>
      </Modal>
    </div>
  );
}
