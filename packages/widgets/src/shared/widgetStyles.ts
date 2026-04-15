/**
 * Shared column widths for single-row widget layout.
 * Every widget uses the same label and value widths so they align when stacked.
 */

/** Fixed column widths */
export const COL = {
  /** Label column */
  label: 'w-[130px] shrink-0',
  /** Value column */
  value: 'w-[70px] shrink-0',
  /** Unit column */
  unit: 'w-[30px] shrink-0',
} as const;

/** Shared outer container */
export const ROW_CONTAINER = 'inline-flex flex-row items-center gap-3 px-2 py-1.5 rounded border border-gray-200 bg-white self-start';

/** Shared label class */
export const LABEL_CLASS = `${COL.label} text-xs text-gray-900 font-medium tracking-wide truncate`;

/** Shared unit class — fixed width, centered */
export const UNIT_CLASS = `${COL.unit} min-w-[2rem] text-xs text-gray-900 text-left`;

/** Shared value class (normal quality — read-only) */
export const VALUE_CLASS = `${COL.value} font-mono text-sm text-gray-900 text-right`;

/** Shared value class (editable — blue to indicate clickable) */
export const VALUE_EDITABLE_CLASS = `${COL.value} font-mono text-sm text-blue-600 text-right`;

/** Shared value class (bad quality / disconnected) */
export const VALUE_BAD_CLASS = `${COL.value} font-mono text-sm text-red-600 text-right`;
