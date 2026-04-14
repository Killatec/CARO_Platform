import { useState, useRef } from 'react';
import { useLiveValue, useTagWriter } from '@caro/hmi-context';
import { Button, Input, Modal, Tooltip } from '@caro/ui';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveFormat, resolveLabel } from './shared/utils.js';
import { ROW_CONTAINER, LABEL_CLASS, VALUE_BAD_CLASS, UNIT_CLASS, COL } from './shared/widgetStyles.js';
import { useWriteGuard } from './shared/useWriteGuard.js';

export interface NumericSetProps {
  assetPath: string;
  label?: string;
  requireConfirm?: boolean;
  confirmMessage?: string;
}

export function NumericSet({ assetPath, label, requireConfirm = false, confirmMessage }: NumericSetProps) {
  const tag = useSingleTag(assetPath, 'NumericSet');
  const lv = useLiveValue(tag.tag_id);
  const { write, error } = useTagWriter();
  const fmt = resolveFormat(tag);
  const displayLabel = resolveLabel(assetPath, label);

  const badQuality = lv.value === null;
  const writeError = error(tag.tag_id);

  const { setAwaitedValue, isWriting } = useWriteGuard(tag.tag_id, lv.value, writeError);

  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const pendingValueRef = useRef<number | null>(null);

  function openEdit() {
    if (badQuality || isWriting) return;
    const current = lv.value !== null ? fmt(lv.value as number) : '';
    setInputValue(current);
    setValidationError(null);
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setValidationError(null);
  }

  function validate(raw: string): number | null {
    const parsed = parseFloat(raw);
    if (isNaN(parsed)) {
      setValidationError('Must be a valid number');
      return null;
    }
    if (tag.eng_min !== null && parsed < tag.eng_min) {
      setValidationError(`Min value is ${tag.eng_min}`);
      return null;
    }
    if (tag.eng_max !== null && parsed > tag.eng_max) {
      setValidationError(`Max value is ${tag.eng_max}`);
      return null;
    }
    setValidationError(null);
    return parsed;
  }

  function handleConfirm() {
    const parsed = validate(inputValue);
    if (parsed === null) return;

    if (requireConfirm) {
      pendingValueRef.current = parsed;
      setShowConfirm(true);
    } else {
      setEditing(false);
      setAwaitedValue(parsed);
      void write(tag.tag_id, parsed);
    }
  }

  function handleModalConfirm() {
    if (pendingValueRef.current === null) return;
    const value = pendingValueRef.current;
    pendingValueRef.current = null;
    setShowConfirm(false);
    setEditing(false);
    setAwaitedValue(value);
    void write(tag.tag_id, value);
  }

  const resolvedConfirmMessage =
    confirmMessage ?? `Set ${displayLabel} to ${pendingValueRef.current}?`;

  const displayValue =
    lv.value !== null ? fmt(lv.value as number) : '---';

  return (
    <div className="flex flex-col self-start">
      <div className={ROW_CONTAINER}>
        <span className={LABEL_CLASS}>{displayLabel}</span>

        {editing ? (
          <div className={`${COL.value} flex items-center gap-1`}>
            <Input
              type="number"
              value={inputValue}
              onChange={e => { setInputValue(e.target.value); setValidationError(null); }}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirm(); if (e.key === 'Escape') cancelEdit(); }}
              disabled={isWriting}
              className="w-20 text-sm"
              autoFocus
            />
            <Button variant="primary" onClick={handleConfirm} disabled={isWriting} className="px-2 py-1 text-xs">Set</Button>
            <Button variant="secondary" onClick={cancelEdit} disabled={isWriting} className="px-2 py-1 text-xs">✕</Button>
          </div>
        ) : (
          <Tooltip content={badQuality ? 'Cannot write — device not connected' : undefined}>
            <div
              className={`${COL.value} flex items-center justify-end gap-1 font-mono text-sm cursor-pointer select-none rounded px-1 py-0.5 ${
                badQuality
                  ? 'text-red-600 bg-red-500/10 border border-red-400 cursor-not-allowed'
                  : 'text-blue-600 hover:bg-blue-50'
              }`}
              onClick={openEdit}
              data-testid="display-value"
            >
              {displayValue}
            </div>
          </Tooltip>
        )}

        <span className={UNIT_CLASS}>{tag.unit ?? '-'}</span>
      </div>

      {validationError && editing && (
        <span className="text-xs text-red-600 ml-[148px]" data-testid="validation-error">{validationError}</span>
      )}
      {writeError && !editing && (
        <span className="text-xs text-red-600 ml-[148px]" data-testid="write-error">{writeError}</span>
      )}

      <Modal
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); pendingValueRef.current = null; }}
        title="Confirm"
      >
        <p className="mb-4 text-gray-700">{resolvedConfirmMessage}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setShowConfirm(false); pendingValueRef.current = null; }}>Cancel</Button>
          <Button variant="primary" onClick={handleModalConfirm}>Confirm</Button>
        </div>
      </Modal>
    </div>
  );
}
