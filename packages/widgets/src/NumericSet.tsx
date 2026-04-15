import { useSingleTag } from './shared/useSingleTag.js';
import { resolveLabel } from './shared/utils.js';
import { ROW_CONTAINER, LABEL_CLASS, UNIT_CLASS, COL } from './shared/widgetStyles.js';
import { useNumericInput } from './shared/useNumericInput.js';

export interface NumericSetProps {
  assetPath: string;
  label?: string;
}

export function NumericSet({ assetPath, label }: NumericSetProps) {
  const tag = useSingleTag(assetPath, 'NumericSet');
  const displayLabel = resolveLabel(assetPath, label);
  const {
    inputRef,
    inputValue,
    placeholder,
    isFocused,
    isWriting,
    badQuality,
    writeError,
    handleFocus,
    handleBlur,
    handleKeyDown,
    handleChange,
  } = useNumericInput(tag);

  const inputClassName = [
    COL.value,
    'font-mono text-sm text-right bg-transparent border rounded px-1 py-0.5 outline-none',
    'placeholder:text-gray-400 placeholder:text-center',
    isFocused
      ? 'bg-amber-100 border-blue-500 text-gray-900 cursor-text'
      : badQuality
        ? 'text-red-600 border-transparent bg-transparent cursor-not-allowed'
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
          disabled={badQuality}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
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
