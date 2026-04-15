import { useState } from 'react';
import { useLiveValue, useTagWriter } from '@caro/hmi-context';
import { Button, Modal, Tooltip } from '@caro/ui';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveLabel } from './shared/utils.js';
import { ROW_CONTAINER, LABEL_CLASS, COL } from './shared/widgetStyles.js';
import { useWriteGuard } from './shared/useWriteGuard.js';
import { ToggleSwitch } from './shared/ToggleSwitch.js';

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

  return (
    <div className="flex flex-col self-start">
      <div className={ROW_CONTAINER}>
        <span className={LABEL_CLASS}>{displayLabel}</span>
        <div className={`${COL.value} flex justify-end`}>
          <Tooltip content={badQuality ? 'Cannot write — device not connected' : undefined}>
            <ToggleSwitch
              isTrue={isTrue}
              badQuality={badQuality}
              isWriting={isWriting}
              onClick={handleToggle}
              trueColor={trueColor}
              falseColor={falseColor}
              ariaLabel={`Toggle ${displayLabel}. Current: ${isTrue ? trueLabel : falseLabel}. Click to set ${nextLabel}`}
            />
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
