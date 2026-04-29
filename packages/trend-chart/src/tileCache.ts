export interface TileCacheOptions<T> {
  capacityBytes: number;
  estimateSize: (item: T) => number;
}

/**
 * Generic LRU cache keyed by string with byte-size accounting.
 *
 * Eviction policy: insertion-ordered Map — on get() the entry is deleted and
 * re-inserted to promote it to "most recently used". On set(), existing key is
 * deleted first (promoting would break LRU ordering for overwrites). Eviction
 * removes from the front (oldest) until size <= capacity.
 */
export class TileCache<T> {
  private readonly _map: Map<string, T> = new Map();
  private readonly _sizes: Map<string, number> = new Map();
  private _currentBytes = 0;
  private readonly _estimateSize: (item: T) => number;
  readonly capacity: number;

  constructor(opts: TileCacheOptions<T>) {
    this.capacity = opts.capacityBytes;
    this._estimateSize = opts.estimateSize;
  }

  get(key: string): T | undefined {
    const item = this._map.get(key);
    if (item === undefined) return undefined;
    // Promote to MRU.
    const sz = this._sizes.get(key)!;
    this._map.delete(key);
    this._sizes.delete(key);
    this._map.set(key, item);
    this._sizes.set(key, sz);
    return item;
  }

  set(key: string, item: T): void {
    // Remove existing entry first so size accounting and LRU order are correct.
    if (this._map.has(key)) {
      this._currentBytes -= this._sizes.get(key)!;
      this._map.delete(key);
      this._sizes.delete(key);
    }
    const sz = this._estimateSize(item);
    this._map.set(key, item);
    this._sizes.set(key, sz);
    this._currentBytes += sz;
    this._evict();
  }

  has(key: string): boolean {
    return this._map.has(key);
  }

  delete(key: string): boolean {
    if (!this._map.has(key)) return false;
    this._currentBytes -= this._sizes.get(key)!;
    this._map.delete(key);
    this._sizes.delete(key);
    return true;
  }

  clear(): void {
    this._map.clear();
    this._sizes.clear();
    this._currentBytes = 0;
  }

  get size(): number {
    return this._currentBytes;
  }

  get entryCount(): number {
    return this._map.size;
  }

  private _evict(): void {
    // Evict from the front (LRU) until within capacity.
    const iter = this._map.keys();
    while (this._currentBytes > this.capacity) {
      const next = iter.next();
      if (next.done) break;
      const key = next.value;
      this._currentBytes -= this._sizes.get(key)!;
      this._map.delete(key);
      this._sizes.delete(key);
    }
  }
}

/**
 * Canonical cache key for a trend tile. Produces an unambiguous string
 * because BigInt.toString() is exact and the separator `:` cannot appear in
 * numeric values.
 */
export function makeTileCacheKey(args: {
  tagId: number;
  startTime: bigint;
  endTime: bigint;
  bucketCount: number;
}): string {
  return `${args.tagId}:${args.startTime}:${args.endTime}:${args.bucketCount}`;
}
