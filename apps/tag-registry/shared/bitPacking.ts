/**
 * LSB-first bit packing helpers for i16[] tags.
 *
 * Watchdog convention: one `i16[]` packed 1-bit-per-module, LSB-first.
 * Module index `i` lives in word `floor(i / 16)`, bit `i mod 16`.
 * Array length is `ceil(N_Modules / 16)`, always at least 1 element.
 *
 * The `& 0xFFFF` normalization in packedBit is required because proto `int32`
 * values with bit 15 set arrive in JS as negative numbers (two's complement).
 * Masking to 16 bits then applying an unsigned right-shift (`>>>`) gives
 * consistent unsigned bit semantics regardless of the sign.
 */

/**
 * Reads a single packed bit. Returns false if the target word is past the end
 * of the array.
 */
export function packedBit(moduleIndex: number, words: number[]): boolean {
  const wordIdx = moduleIndex >> 4;
  if (wordIdx >= words.length) return false;
  const word = (words[wordIdx] ?? 0) & 0xFFFF;
  return ((word >>> (moduleIndex & 0x0F)) & 1) === 1;
}

/**
 * Sets or clears a single packed bit. Extends the array with zero-words as
 * needed to reach the target word index.
 */
export function setPackedBit(moduleIndex: number, words: number[], value: boolean): void {
  const wordIdx = moduleIndex >> 4;
  const mask    = 1 << (moduleIndex & 0x0F);
  while (words.length <= wordIdx) words.push(0);
  words[wordIdx] = value
    ? (words[wordIdx] | mask) & 0xFFFF
    : (words[wordIdx] & ~mask) & 0xFFFF;
}
