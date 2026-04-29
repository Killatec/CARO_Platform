import { describe, it, expect } from 'vitest';
import { TileCache, makeTileCacheKey } from '../src/tileCache.js';

const estimateSize = (s: string) => s.length * 2; // bytes, arbitrary

function makeCache(capacityBytes = 1000) {
  return new TileCache<string>({ capacityBytes, estimateSize });
}

describe('TileCache', () => {
  it('get returns undefined for missing key', () => {
    const cache = makeCache();
    expect(cache.get('nope')).toBeUndefined();
  });

  it('set then get returns the inserted item', () => {
    const cache = makeCache();
    cache.set('a', 'hello');
    expect(cache.get('a')).toBe('hello');
  });

  it('size accounting reflects estimateSize() return value', () => {
    const cache = makeCache();
    const item = 'hello'; // 5 chars * 2 = 10 bytes
    cache.set('a', item);
    expect(cache.size).toBe(estimateSize(item));
    expect(cache.entryCount).toBe(1);
  });

  it('set with existing key updates value and resets size correctly', () => {
    const cache = makeCache();
    cache.set('a', 'hi');    // 4 bytes
    cache.set('a', 'hello'); // 10 bytes — replaces
    expect(cache.get('a')).toBe('hello');
    expect(cache.size).toBe(estimateSize('hello'));
    expect(cache.entryCount).toBe(1);
  });

  it('evicts least-recently-used when over capacity', () => {
    // Capacity 20 bytes. Each 5-char string = 10 bytes.
    const cache = new TileCache<string>({ capacityBytes: 20, estimateSize });
    cache.set('a', 'aaaaa'); // 10 bytes
    cache.set('b', 'bbbbb'); // 10 bytes — now at capacity
    cache.set('c', 'ccccc'); // 10 bytes — must evict 'a' (LRU)
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
    expect(cache.size).toBe(20);
  });

  it('get() promotes entry so it is not evicted first', () => {
    const cache = new TileCache<string>({ capacityBytes: 20, estimateSize });
    cache.set('a', 'aaaaa'); // 10 bytes — inserted first (LRU candidate)
    cache.set('b', 'bbbbb'); // 10 bytes
    cache.get('a');           // promote 'a' — now 'b' is LRU
    cache.set('c', 'ccccc'); // must evict 'b'
    expect(cache.has('b')).toBe(false);
    expect(cache.has('a')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('evicts multiple entries if a single set exceeds remainder of capacity', () => {
    // Capacity 30 bytes. Fill with three 10-byte entries then insert a 30-byte one.
    const cache = new TileCache<string>({ capacityBytes: 30, estimateSize });
    cache.set('a', 'aaaaa'); // 10
    cache.set('b', 'bbbbb'); // 10
    cache.set('c', 'ccccc'); // 10 — full
    const big = 'x'.repeat(15); // 30 bytes
    cache.set('big', big);      // must evict all three to fit
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
    expect(cache.has('big')).toBe(true);
    expect(cache.size).toBe(30);
  });

  it('delete removes entry and decrements size', () => {
    const cache = makeCache();
    cache.set('a', 'hello'); // 10 bytes
    const deleted = cache.delete('a');
    expect(deleted).toBe(true);
    expect(cache.has('a')).toBe(false);
    expect(cache.size).toBe(0);
    expect(cache.entryCount).toBe(0);
  });

  it('delete returns false for non-existent key', () => {
    const cache = makeCache();
    expect(cache.delete('nope')).toBe(false);
  });

  it('clear empties cache and resets size to 0', () => {
    const cache = makeCache();
    cache.set('a', 'hello');
    cache.set('b', 'world');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.entryCount).toBe(0);
    expect(cache.has('a')).toBe(false);
  });

  it('has returns true for existing key, false otherwise', () => {
    const cache = makeCache();
    cache.set('x', 'data');
    expect(cache.has('x')).toBe(true);
    expect(cache.has('y')).toBe(false);
  });
});

describe('makeTileCacheKey', () => {
  it('same inputs produce identical strings', () => {
    const args = { tagId: 42, startTime: 1000n, endTime: 2000n, bucketCount: 500 };
    expect(makeTileCacheKey(args)).toBe(makeTileCacheKey(args));
  });

  it('distinct inputs produce distinct strings', () => {
    const base = { tagId: 42, startTime: 1000n, endTime: 2000n, bucketCount: 500 };
    const diffTag = { ...base, tagId: 43 };
    const diffStart = { ...base, startTime: 1001n };
    const diffEnd = { ...base, endTime: 2001n };
    const diffBucket = { ...base, bucketCount: 250 };
    const keys = [
      makeTileCacheKey(base),
      makeTileCacheKey(diffTag),
      makeTileCacheKey(diffStart),
      makeTileCacheKey(diffEnd),
      makeTileCacheKey(diffBucket),
    ];
    // All keys should be unique.
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('returns a non-empty string', () => {
    const key = makeTileCacheKey({ tagId: 1, startTime: 0n, endTime: 1000n, bucketCount: 500 });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });
});
