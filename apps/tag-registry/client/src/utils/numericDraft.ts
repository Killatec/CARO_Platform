/**
 * Parses the text of a numeric field while it is being typed.
 *
 * Returns the number when the text is a complete, finite number, or null while it is
 * still partial ("", "-", "1e") — the caller keeps the text and commits nothing until
 * it parses. Uses Number(), not parseFloat(), so trailing junk ("5abc") is not accepted.
 */
export function parseNumericDraft(text: string): number | null {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
