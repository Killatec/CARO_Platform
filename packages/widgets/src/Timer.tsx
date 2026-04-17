import { useState, useCallback } from 'react';
import { useLiveValue } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { useTagGroup } from './shared/useTagGroup.js';
import { resolveFormat, resolveLabel } from './shared/utils.js';
import { useNumericInput } from './shared/useNumericInput.js';
import { getDotClass } from './shared/colorMap.js';
import { withErrorBoundary } from './shared/withErrorBoundary.js';

// ── Column widths ──────────────────────────────────────────────────────────────

const COL_LABEL = 'w-[100px] shrink-0 truncate';
const COL_UNIT  = 'w-[30px] shrink-0';
const COL_NUM   = 'w-[60px] shrink-0';
const COL_BOOL  = 'w-[30px] shrink-0';

// ── Header column descriptors (module-level — stable reference) ────────────────

const HEADER_COLS: Array<{ name: string; cls: string }> = [
  { name: 'Set',  cls: COL_NUM  },
  { name: 'Mon',  cls: COL_NUM  },
  { name: 'Done', cls: COL_BOOL },
];

// ── children array — module-level constant so useTagGroup's useMemo is stable ──

const TIMER_CHILDREN = ['Set', 'Mon', 'Done'] as const;

// ── Error callback type ────────────────────────────────────────────────────────

type ErrorCallback = (childName: string, msg: string | null) => void;

// ── Sub-components ─────────────────────────────────────────────────────────────

function NumericMonCell({ tag }: { tag: TagDef }) {
  const lv = useLiveValue(tag.tag_id);
  const fmt = resolveFormat(tag);
  const badQuality = lv.value === null;

  return (
    <div
      className={[
        COL_NUM,
        'font-mono text-sm text-center',
        badQuality ? 'text-red-600' : 'text-gray-900',
      ].join(' ')}
    >
      {badQuality ? '---' : fmt(lv.value as number)}
    </div>
  );
}

function NumericSetCell({
  tag,
  childName,
  onError,
}: {
  tag: TagDef;
  childName: string;
  onError: ErrorCallback;
}) {
  const {
    inputRef,
    inputValue,
    placeholder,
    isFocused,
    isWriting,
    badQuality,
    handleFocus,
    handleBlur,
    handleKeyDown,
    handleChange,
  } = useNumericInput(tag, { onError: (msg) => onError(childName, msg) });

  const inputCls = [
    COL_NUM,
    'font-mono text-sm text-center bg-transparent border rounded px-0.5 outline-none',
    'placeholder:text-gray-400 placeholder:text-center',
    isFocused
      ? 'bg-amber-100 border-blue-500 text-gray-900 cursor-text'
      : badQuality
        ? 'text-red-600 border-transparent cursor-not-allowed'
        : 'text-blue-600 border-transparent cursor-pointer hover:border-blue-300',
  ].join(' ');

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      className={inputCls}
      value={inputValue}
      placeholder={placeholder}
      readOnly={!isFocused || isWriting}
      disabled={badQuality}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onChange={handleChange}
      aria-label={childName}
    />
  );
}

function BooleanMonCell({ tag }: { tag: TagDef }) {
  const lv = useLiveValue(tag.tag_id);
  const badQuality = lv.value === null;
  const isTrue = lv.value === true;

  const dotCls = badQuality
    ? 'w-3 h-3 rounded-full border-2 border-dashed border-red-400 bg-transparent'
    : `w-3 h-3 rounded-full ${getDotClass(isTrue ? 'green' : 'gray')}`;

  return (
    <div className={`${COL_BOOL} flex items-center justify-center`}>
      <span className={dotCls} data-testid="state-dot" />
    </div>
  );
}

// ── Timer ──────────────────────────────────────────────────────────────────────

export interface TimerProps {
  assetPath: string;
  label?: string;
  showHeader?: boolean;
}

function TimerInner({ assetPath, label, showHeader = false }: TimerProps) {
  const tags = useTagGroup(assetPath, TIMER_CHILDREN as unknown as string[], 'Timer');
  const displayLabel = resolveLabel(assetPath, label);
  const unit = tags['Set'].unit ?? '-';

  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const handleError = useCallback((childName: string, msg: string | null) => {
    setErrors(prev => ({ ...prev, [childName]: msg }));
  }, []);

  const activeErrors = Object.entries(errors).filter(([, v]) => v !== null && v !== '');

  const ROW_CLS =
    'inline-flex flex-row items-center gap-1 px-2 py-1.5 rounded border border-gray-200 bg-white';
  const HEADER_ROW_CLS =
    'inline-flex flex-row items-center gap-1 px-2 py-0.5';

  return (
    <div className="flex flex-col self-start">
      {showHeader && (
        <div className={HEADER_ROW_CLS}>
          <div className={COL_LABEL} />
          <div className={COL_UNIT} />
          {HEADER_COLS.map(({ name, cls }) => (
            <div
              key={name}
              className={`${cls} text-[10px] text-gray-400 text-center truncate`}
            >
              {name}
            </div>
          ))}
        </div>
      )}

      <div className={ROW_CLS}>
        <span className={`${COL_LABEL} text-xs text-gray-900 font-medium tracking-wide`}>
          {displayLabel}
        </span>
        <span className={`${COL_UNIT} text-xs text-gray-500`}>{unit}</span>

        <NumericSetCell tag={tags['Set']}  childName="Set" onError={handleError} />
        <NumericMonCell tag={tags['Mon']} />
        <BooleanMonCell tag={tags['Done']} />
      </div>

      {activeErrors.length > 0 && (
        <div className="flex flex-col mt-0.5">
          {activeErrors.map(([name, msg]) => (
            <span key={name} className="text-xs text-red-600" data-testid="write-error">
              {name}: {msg}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export const Timer = withErrorBoundary(TimerInner);
