import { useState, useRef } from 'react';
import { useLiveValue, useTagWriter } from '@caro/hmi-context';
import { Button, Input, Modal, Tooltip } from '@caro/ui';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveDecimalPlaces, resolveLabel } from './shared/utils.js';
import { WidgetLabel } from './shared/WidgetLabel.js';
import { PendingOverlay } from './shared/PendingOverlay.js';

export interface NumericSetProps {
  assetPath: string;
  label?: string;
  requireConfirm?: boolean;
  confirmMessage?: string;
}

export function NumericSet({ assetPath, label, requireConfirm = false, confirmMessage }: NumericSetProps) {
  const tag = useSingleTag(assetPath, 'NumericSet');
  const lv = useLiveValue(tag.tag_id);
  const { write, isPending, error } = useTagWriter();
  const decimals = resolveDecimalPlaces(tag);
  const displayLabel = resolveLabel(assetPath, label);

  const badQuality = lv.value === null;
  const pending = isPending(tag.tag_id);
  const writeError = error(tag.tag_id);

  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const pendingValueRef = useRef<number | null>(null);

  function openEdit() {
    if (badQuality || pending) return;
    const current = lv.value !== null ? (lv.value as number).toFixed(decimals) : '';
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
      void write(tag.tag_id, parsed);
    }
  }

  function handleModalConfirm() {
    if (pendingValueRef.current === null) return;
    const value = pendingValueRef.current;
    pendingValueRef.current = null;
    setShowConfirm(false);
    setEditing(false);
    void write(tag.tag_id, value);
  }

  const resolvedConfirmMessage =
    confirmMessage ?? `Set ${displayLabel} to ${pendingValueRef.current}?`;

  const displayValue =
    lv.value !== null ? (lv.value as number).toFixed(decimals) : '---';

  return (
    <div className="inline-flex flex-col p-2 rounded border border-gray-200 bg-white min-w-[120px]">
      <WidgetLabel label={displayLabel} unit={tag.unit} />

      {editing ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1">
            <Input
              type="number"
              value={inputValue}
              onChange={e => {
                setInputValue(e.target.value);
                setValidationError(null);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleConfirm();
                if (e.key === 'Escape') cancelEdit();
              }}
              disabled={pending}
              className="w-24 text-sm"
              autoFocus
            />
            <Button variant="primary" onClick={handleConfirm} disabled={pending} className="px-2 py-1 text-xs">
              Set
            </Button>
            <Button variant="secondary" onClick={cancelEdit} disabled={pending} className="px-2 py-1 text-xs">
              ✕
            </Button>
            <PendingOverlay isPending={pending} />
          </div>
          {validationError && (
            <span className="text-xs text-red-600" data-testid="validation-error">{validationError}</span>
          )}
          {writeError && (
            <span className="text-xs text-red-600" data-testid="write-error">{writeError}</span>
          )}
        </div>
      ) : (
        <Tooltip content={badQuality ? 'Cannot write — device not connected' : undefined}>
          <div
            className={`flex items-center gap-1 font-mono text-sm cursor-pointer select-none rounded px-1 py-0.5 ${
              badQuality
                ? 'text-red-600 bg-red-500/10 border border-red-400 cursor-not-allowed'
                : 'text-gray-900 hover:bg-gray-100'
            }`}
            onClick={openEdit}
            data-testid="display-value"
          >
            {displayValue}
            {tag.unit && !badQuality && (
              <span className="text-gray-500 text-xs">{tag.unit}</span>
            )}
            <PendingOverlay isPending={pending} />
          </div>
        </Tooltip>
      )}

      {writeError && !editing && (
        <span className="text-xs text-red-600 mt-1" data-testid="write-error">{writeError}</span>
      )}

      <Modal
        isOpen={showConfirm}
        onClose={() => { setShowConfirm(false); pendingValueRef.current = null; }}
        title="Confirm"
      >
        <p className="mb-4 text-gray-700">{resolvedConfirmMessage}</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => { setShowConfirm(false); pendingValueRef.current = null; }}>
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
