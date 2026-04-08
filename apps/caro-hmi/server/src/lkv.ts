export interface LkvEntry {
  value: number | boolean | string | null;
  generation: number;
}

export class LkvCache {
  private entries = new Map<number, LkvEntry>();

  /**
   * Update the value for a tag. Returns true if the value changed
   * (and generation was bumped), false if it was the same.
   */
  set(tagId: number, value: number | boolean | string | null): boolean {
    const existing = this.entries.get(tagId);
    if (existing !== undefined && existing.value === value) {
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

  getValue(tagId: number): number | boolean | string | null {
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
