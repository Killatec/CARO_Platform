import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TimescaleDbWriter } from '../timescale-writer.js';
import { writeTagSamples } from '@caro/db';
import type { DbWriteEntry } from '../db-pipeline.js';

vi.mock('@caro/db', () => ({
  writeTagSamples: vi.fn(),
}));

const mockWrite = vi.mocked(writeTagSamples);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(moduleTs: number, tags: DbWriteEntry['tags']): DbWriteEntry {
  return { moduleTs, tags };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TimescaleDbWriter — coerce', () => {
  let writer: TimescaleDbWriter;

  beforeEach(() => {
    writer = new TimescaleDbWriter();
    mockWrite.mockReset();
    mockWrite.mockResolvedValue(undefined);
  });

  it('coerces boolean true to 1.0', async () => {
    await writer.write([makeEntry(1000, [{ tagId: 1, value: true }])]);
    expect(mockWrite.mock.calls[0][0][0].value).toBe(1.0);
  });

  it('coerces boolean false to 0.0', async () => {
    await writer.write([makeEntry(1000, [{ tagId: 1, value: false }])]);
    expect(mockWrite.mock.calls[0][0][0].value).toBe(0.0);
  });

  it('passes null through as null', async () => {
    await writer.write([makeEntry(1000, [{ tagId: 1, value: null }])]);
    expect(mockWrite.mock.calls[0][0][0].value).toBeNull();
  });

  it('passes finite numbers unchanged', async () => {
    await writer.write([makeEntry(1000, [{ tagId: 1, value: 3.14 }])]);
    expect(mockWrite.mock.calls[0][0][0].value).toBe(3.14);
  });

  it('drops NaN to null', async () => {
    await writer.write([makeEntry(1000, [{ tagId: 1, value: NaN }])]);
    expect(mockWrite.mock.calls[0][0][0].value).toBeNull();
  });

  it('drops Infinity to null', async () => {
    await writer.write([makeEntry(1000, [{ tagId: 1, value: Infinity }])]);
    expect(mockWrite.mock.calls[0][0][0].value).toBeNull();
  });

  it('drops string to null, logs warn once; second drop does not log again', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await writer.write([makeEntry(1000, [{ tagId: 1, value: 'hello' }])]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(mockWrite.mock.calls[0][0][0].value).toBeNull();

      await writer.write([makeEntry(2000, [{ tagId: 2, value: 'world' }])]);
      expect(warnSpy).toHaveBeenCalledTimes(1); // still 1 — guard fired
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('empty entries array skips writeTagSamples call', async () => {
    await writer.write([]);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('entries with no tags skips writeTagSamples call', async () => {
    await writer.write([makeEntry(1000, []), makeEntry(2000, [])]);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('flattens entries × tags into a single rows array with shared ts', async () => {
    const entries: DbWriteEntry[] = [
      makeEntry(1000, [{ tagId: 1, value: 10 }, { tagId: 2, value: 20 }]),
      makeEntry(2000, [{ tagId: 3, value: 30 }]),
    ];
    await writer.write(entries);
    expect(mockWrite).toHaveBeenCalledTimes(1);
    const rows = mockWrite.mock.calls[0][0];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ ts: 1000, tagId: 1, value: 10 });
    expect(rows[1]).toEqual({ ts: 1000, tagId: 2, value: 20 });
    expect(rows[2]).toEqual({ ts: 2000, tagId: 3, value: 30 });
  });
});
