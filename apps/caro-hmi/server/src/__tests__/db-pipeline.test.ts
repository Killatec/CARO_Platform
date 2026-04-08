import { describe, it, expect } from 'vitest';
import { DbPipeline } from '../db-pipeline.js';
import type { DbWriteEntry } from '../db-pipeline.js';

function makeEntry(moduleTs: number, tagIds: number[] = []): DbWriteEntry {
  return { moduleTs, tags: tagIds.map(id => ({ tagId: id, value: id })) };
}

describe('DbPipeline', () => {
  it('enqueue adds entries', () => {
    const p = new DbPipeline();
    p.enqueue(makeEntry(1, [1]));
    expect(p.queueSize).toBe(1);
  });

  it('flush drains queue and returns entries', () => {
    const p = new DbPipeline();
    const entry = makeEntry(1, [1]);
    p.enqueue(entry);
    const result = p.flush();
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(entry);
    expect(p.queueSize).toBe(0);
  });

  it('flush on empty queue returns empty array', () => {
    const p = new DbPipeline();
    expect(p.flush()).toEqual([]);
  });

  it('backpressure: drops oldest entry when at max capacity', () => {
    const p = new DbPipeline(2);
    const e1 = makeEntry(1);
    const e2 = makeEntry(2);
    const e3 = makeEntry(3);
    p.enqueue(e1);
    p.enqueue(e2);
    p.enqueue(e3); // e1 dropped
    const result = p.flush();
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(e2);
    expect(result[1]).toBe(e3);
  });

  it('queueSize reflects current count', () => {
    const p = new DbPipeline();
    expect(p.queueSize).toBe(0);
    p.enqueue(makeEntry(1));
    p.enqueue(makeEntry(2));
    expect(p.queueSize).toBe(2);
    p.flush();
    expect(p.queueSize).toBe(0);
  });
});
