export type LkvValue = number | boolean | string | number[] | boolean[] | string[] | null;

export interface LkvEntry {
  value: LkvValue;
  generation: number;
}

export function valuesEqual(a: LkvValue, b: LkvValue): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class LkvCache {
  private entries = new Map<number, LkvEntry>();

  /**
   * Update the value for a tag. Returns true if the value changed
   * (and generation was bumped), false if it was the same.
   */
  set(tagId: number, value: LkvValue): boolean {
    const existing = this.entries.get(tagId);
    if (existing !== undefined && valuesEqual(existing.value, value)) {
      return false;
    }
    if (existing !== undefined) {
      existing.value = value;
      existing.generation++;
      return true;
    }
    this.entries.set(tagId, { value, generation: 1 });
    return true;
  }

  get(tagId: number): LkvEntry | undefined {
    return this.entries.get(tagId);
  }

  getGeneration(tagId: number): number {
    return this.entries.get(tagId)?.generation ?? 0;
  }

  getValue(tagId: number): LkvValue {
    return this.entries.get(tagId)?.value ?? null;
  }

  has(tagId: number): boolean {
    return this.entries.has(tagId);
  }

  tagIds(): IterableIterator<number> {
    return this.entries.keys();
  }

  get size(): number {
    return this.entries.size;
  }
}
