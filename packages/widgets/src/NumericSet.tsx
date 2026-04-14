import { useState, useRef, useEffect } from 'react';
import { useLiveValue, useTagWriter } from '@caro/hmi-context';
import { useSingleTag } from './shared/useSingleTag.js';
import { resolveFormat, resolveLabel } from './shared/utils.js';
import { ROW_CONTAINER, LABEL_CLASS, UNIT_CLASS, COL } from './shared/widgetStyles.js';
import { useWriteGuard } from './shared/useWriteGuard.js';

export interface NumericSetProps {
  assetPath: string;
  label?: string;
}

export function NumericSet({ assetPath, label }: NumericSetProps) {
  const tag = useSingleTag(assetPath, 'NumericSet');
  const lv = useLiveValue(tag.tag_id);
  const { write, error } = useTagWriter();
  const fmt = resolveFormat(tag);
  const displayLabel = resolveLabel(assetPath, label);

  const badQuality = lv.value === null;
  const writeError = error(tag.tag_id);

  const { setAwaitedValue, isWriting } = useWriteGuard(tag.tag_id, lv.value, writeError);

  const [isFocused, setIsFocused] = useState(false);
  const [inputValue, setInputValue] = useState<string>(() =>
    lv.value !== null ? fmt(lv.value as number) : '---'
  );
  const [placeholder, setPlaceholder] = useState('');

  // isFocusedRef mirrors isFocused state — lets the lv.value effect read the
  // current focused state without adding isFocused to its dependency array
  // (which would fire the effect on every focus/blur, not just value changes).
  const isFocusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const formattedLive = lv.value !== null ? fmt(lv.value as number) : '---';

  // When live value changes: update placeholder if editing, or inputValue if idle.
  useEffect(() => {
    if (isFocusedRef.current) {
      setPlaceholder(formattedLive);
    } else {
      setInputValue(formattedLive);
    }
  }, [formattedLive]);


  function handleFocus() {
    if (badQuality || isWriting) return;
    isFocusedRef.current = true;
    setIsFocused(true);
    setPlaceholder(formattedLive);
    setInputValue('');
  }

  function handleBlur() {
    isFocusedRef.current = false;
    setIsFocused(false);
    setInputValue(formattedLive);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      if (isWriting) return;
      const trimmed = inputValue.trim();
      const parsed = parseFloat(trimmed);
      if (trimmed === '' || isNaN(parsed)) return;
      setAwaitedValue(parsed);
      void write(tag.tag_id, parsed);
      setPlaceholder(fmt(parsed));
      setInputValue('');
      // Retain focus — operator can immediately type the next value.
    }
    if (e.key === 'Escape') {
      inputRef.current?.blur();
    }
  }

  const disabled = badQuality;

  const inputClassName = [
    COL.value,
    'font-mono text-sm text-right bg-transparent border rounded px-1 py-0.5 outline-none',
    'placeholder:text-gray-400 placeholder:text-center',
    isFocused
      ? 'bg-amber-100 border-blue-500 text-gray-900 cursor-text'
      : badQuality
        ? 'text-red-600 border-red-400 bg-red-500/10 cursor-not-allowed'
        : 'text-blue-600 border-transparent cursor-pointer hover:border-blue-300',
  ].join(' ');

  return (
    <div className="flex flex-col self-start">
      <div className={ROW_CONTAINER}>
        <span className={LABEL_CLASS}>{displayLabel}</span>

        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          data-testid="numeric-set-input"
          className={inputClassName}
          value={inputValue}
          placeholder={placeholder}
          readOnly={!isFocused || isWriting}
          disabled={disabled}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={e => setInputValue(e.target.value)}
          aria-label={displayLabel}
        />

        <span className={UNIT_CLASS}>{tag.unit ?? '-'}</span>
      </div>

      {writeError && (
        <span className="text-xs text-red-600 ml-[148px]" data-testid="write-error">{writeError}</span>
      )}
    </div>
  );
}
