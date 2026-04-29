/**
 * Renders a numeric value with optional units. nulls render as '—'.
 * Boolean tags (isBoolean=true) format as '0' or '1' with no unit suffix.
 */
export function formatValue(value: number | null, unit: string | null | undefined, isBoolean: boolean): string {
  if (value === null) return '—';
  if (isBoolean) return value !== 0 ? '1' : '0';
  const formatted = parseFloat(value.toPrecision(4)).toString();
  return unit ? `${formatted} ${unit}` : formatted;
}
