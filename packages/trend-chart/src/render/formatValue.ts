/**
 * Renders a numeric value with optional format string. nulls render as '—'.
 * Boolean tags (isBoolean=true) format as '0' or '1'.
 * format: '%.2f' → value.toFixed(2); null/unsupported → toPrecision(4).
 */
export function formatValue(
  value: number | null,
  format: string | null | undefined,
  isBoolean: boolean,
): string {
  if (value === null) return '—';
  if (isBoolean) return value !== 0 ? '1' : '0';
  if (format) {
    const m = /%[.](\d+)f/.exec(format);
    if (m) return value.toFixed(parseInt(m[1]!, 10));
  }
  return parseFloat(value.toPrecision(4)).toString();
}
