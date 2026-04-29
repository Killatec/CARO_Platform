import { schemeTableau10 } from 'd3-scale-chromatic';

/** 20-entry palette: schemeTableau10 repeated twice. */
export const PALETTE: readonly string[] = [...schemeTableau10, ...schemeTableau10];
export const PALETTE_SIZE = PALETTE.length; // 20

/**
 * Deterministic color from tag ID. Two clients viewing the same tag always
 * see the same color, regardless of session or operator. Negative IDs handled
 * safely via double-modulo.
 */
export function colorAssign(tagId: number): string {
  const index = ((tagId % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  return PALETTE[index]!;
}
