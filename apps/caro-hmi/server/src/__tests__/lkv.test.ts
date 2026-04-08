import { describe, it, expect, beforeEach } from 'vitest';
import { LkvCache } from '../lkv.js';

describe('LkvCache', () => {
  let cache: LkvCache;

  beforeEach(() => {
    cache = new LkvCache();
  });

  it('set() with new tag returns true and creates entry with generation 1', () => {
    const changed = cache.set(1, 42);
    expect(changed).toBe(true);
    expect(cache.get(1)).toEqual({ value: 42, generation: 1 });
  });

  it('set() with same value returns false and generation is unchanged', () => {
    cache.set(1, 42);
    const changed = cache.set(1, 42);
    expect(changed).toBe(false);
    expect(cache.getGeneration(1)).toBe(1);
  });

  it('set() with different value returns true and bumps generation', () => {
    cache.set(1, 42);
    const changed = cache.set(1, 99);
    expect(changed).toBe(true);
    expect(cache.get(1)).toEqual({ value: 99, generation: 2 });
  });

  it('set() from non-null to null bumps generation (quality goes bad)', () => {
    cache.set(1, 100);
    const changed = cache.set(1, null);
    expect(changed).toBe(true);
    expect(cache.get(1)).toEqual({ value: null, generation: 2 });
  });

  it('set() from null to non-null bumps generation (quality restored)', () => {
    cache.set(1, null);
    const changed = cache.set(1, 55.5);
    expect(changed).toBe(true);
    expect(cache.get(1)).toEqual({ value: 55.5, generation: 2 });
  });

  it('set() null to null returns false (already bad quality)', () => {
    cache.set(1, null);
    const changed = cache.set(1, null);
    expect(changed).toBe(false);
    expect(cache.getGeneration(1)).toBe(1);
  });

  it('get() returns undefined for unknown tag', () => {
    expect(cache.get(999)).toBeUndefined();
  });

  it('getGeneration() returns 0 for unknown tag', () => {
    expect(cache.getGeneration(999)).toBe(0);
  });

  it('getValue() returns null for unknown tag', () => {
    expect(cache.getValue(999)).toBeNull();
  });

  it('has() returns false for unknown tag, true for known tag', () => {
    expect(cache.has(1)).toBe(false);
    cache.set(1, true);
    expect(cache.has(1)).toBe(true);
  });

  it('size reflects number of entries', () => {
    expect(cache.size).toBe(0);
    cache.set(1, 1);
    cache.set(2, 2);
    expect(cache.size).toBe(2);
    cache.set(1, 99); // update, not new entry
    expect(cache.size).toBe(2);
  });

  it('tagIds() returns all tag IDs', () => {
    cache.set(10, 'a');
    cache.set(20, 'b');
    cache.set(30, 'c');
    expect(new Set(cache.tagIds())).toEqual(new Set([10, 20, 30]));
  });

  it('changes to one tag do not affect another tag\'s generation', () => {
    cache.set(1, 1.0);
    cache.set(2, 2.0);
    cache.set(1, 9.9);
    expect(cache.getGeneration(2)).toBe(1);
    expect(cache.getGeneration(1)).toBe(2);
  });
});
