import type { TagDef } from '@caro/hmi-context';

// ── Number formatting ─────────────────────────────────────────────────────────

export type NumberFormatter = (value: number) => string;

/**
 * Parses a format string ONCE and returns a fast closure.
 *
 * Fixed-point:  "#"  "#.#"  "#.##"  "#.###"  "#.####"
 * Exponential:  "#.##E+0"  "#.#E+0"  etc.
 * Anything else returns a formatter that renders "Format not valid".
 */
export function compileFormat(format: string): NumberFormatter {
  // Exponential: #(.#+)?E+0
  const expMatch = /^#(\.#+)?E\+0$/.exec(format);
  if (expMatch) {
    const decimals = expMatch[1] ? expMatch[1].length - 1 : 0;
    return (v) => v.toExponential(decimals);
  }

  // Fixed-point: #(.#+)?
  const fixedMatch = /^#(\.#+)?$/.exec(format);
  if (fixedMatch) {
    const decimals = fixedMatch[1] ? fixedMatch[1].length - 1 : 0;
    return (v) => v.toFixed(decimals);
  }

  return (_v) => 'Format not valid';
}

/**
 * Resolves a NumberFormatter for a tag. Called once at widget mount.
 * Uses the registry-resolved format field from TagDef — never walks meta.
 * Default: "#.##" (2 decimal places).
 */
export function resolveFormat(tag: TagDef): NumberFormatter {
  // Use resolved registry field — never walk meta for these.
  // See apps/tag-registry/shared/resolveRegistry.ts.
  if (tag.format) return compileFormat(tag.format);
  return compileFormat('#.##');
}

// ── Label ─────────────────────────────────────────────────────────────────────

/**
 * If labelOverride is provided, return it.
 * Otherwise return the last dot-separated segment of assetPath.
 */
export function resolveLabel(assetPath: string, labelOverride?: string): string {
  if (labelOverride !== undefined) return labelOverride;
  const segs = assetPath.split('.');
  return segs[segs.length - 1];
}
