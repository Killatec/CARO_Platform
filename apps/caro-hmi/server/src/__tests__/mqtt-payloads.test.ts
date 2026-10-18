import { describe, it, expect } from 'vitest';
import { parseTelemetry, parseCmdAck } from '../mqtt-payloads.js';

describe('parseTelemetry', () => {
  it('accepts a valid frame and copies only the known fields', () => {
    const r = parseTelemetry({
      timestamp: 1000, status: 'ONLINE', extra: 1,
      tags: [
        { tag_id: 1, value: 1.5 }, { tag_id: 2, value: true }, { tag_id: 3, value: 'x' },
        { tag_id: 4, value: null }, { tag_id: 5, value: [1, 2] },
      ],
    });
    expect(r).toEqual({
      ok: true,
      skipped: 0,
      message: {
        timestamp: 1000, status: 'ONLINE',
        tags: [
          { tag_id: 1, value: 1.5 }, { tag_id: 2, value: true }, { tag_id: 3, value: 'x' },
          { tag_id: 4, value: null }, { tag_id: 5, value: [1, 2] },
        ],
      },
    });
  });

  it('accepts an empty tags array (change-only frame with no changes)', () => {
    expect(parseTelemetry({ timestamp: 1, status: 'ONLINE', tags: [] })).toMatchObject({ ok: true, skipped: 0 });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a number', 5],
    ['no tags', { timestamp: 1, status: 'ONLINE' }],
    ['tags not an array', { timestamp: 1, status: 'ONLINE', tags: {} }],
    ['no timestamp', { status: 'ONLINE', tags: [] }],
    ['a string timestamp', { timestamp: '1', status: 'ONLINE', tags: [] }],
    ['no status', { timestamp: 1, tags: [] }],
  ])('drops a frame that is %s', (_label, raw) => {
    expect(parseTelemetry(raw)).toMatchObject({ ok: false });
  });

  it('skips bad entries and keeps the rest of the frame', () => {
    const r = parseTelemetry({
      timestamp: 1, status: 'ONLINE',
      tags: [
        { tag_id: 1, value: 1 },
        null,
        { value: 2 },
        { tag_id: -1, value: 2 },
        { tag_id: 1.5, value: 2 },
        { tag_id: '7', value: 2 },
        { tag_id: 8 },
        { tag_id: 9, value: { a: 1 } },
        { tag_id: 10, value: [1, 'x'] },
        { tag_id: 11, value: false },
      ],
    });
    expect(r).toEqual({
      ok: true,
      skipped: 8,
      message: { timestamp: 1, status: 'ONLINE', tags: [{ tag_id: 1, value: 1 }, { tag_id: 11, value: false }] },
    });
  });
});

describe('parseCmdAck', () => {
  it('accepts a SET_VALUES ACK with results', () => {
    const r = parseCmdAck({
      command_id: 'c1', command_type: 'SET_VALUES', ts_utc_ms: 5,
      results: [{ tag_id: 1, accepted: true }, { tag_id: 2, accepted: false, rejection_code: 'OUT_OF_RANGE' }],
    });
    expect(r).toEqual({
      ok: true, skipped: 0,
      message: {
        command_id: 'c1', command_type: 'SET_VALUES', ts_utc_ms: 5,
        results: [{ tag_id: 1, accepted: true }, { tag_id: 2, accepted: false, rejection_code: 'OUT_OF_RANGE' }],
      },
    });
  });

  it('accepts an ACK without results, and one carrying an error', () => {
    expect(parseCmdAck({ command_id: 'c1', command_type: 'RESET', ts_utc_ms: 1 })).toMatchObject({ ok: true });
    expect(parseCmdAck({ command_id: 'c1', error: 'unknown command' })).toMatchObject({
      ok: true, message: { command_id: 'c1', error: 'unknown command' },
    });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['no command_id', { command_type: 'RESET' }],
    ['a numeric command_id', { command_id: 5 }],
    ['a non-string error', { command_id: 'c1', error: 1 }],
    ['results not an array', { command_id: 'c1', results: {} }],
    ['a results entry without accepted', { command_id: 'c1', results: [{ tag_id: 1 }] }],
    ['a results entry with a bad tag_id', { command_id: 'c1', results: [{ tag_id: 'x', accepted: true }] }],
    ['a non-string rejection_code', { command_id: 'c1', results: [{ tag_id: 1, accepted: false, rejection_code: 3 }] }],
  ])('drops an ACK that is %s', (_label, raw) => {
    expect(parseCmdAck(raw)).toMatchObject({ ok: false });
  });

  it('drops the whole ACK when one result is malformed, rather than reporting the rest as accepted', () => {
    expect(parseCmdAck({
      command_id: 'c1',
      results: [{ tag_id: 1, accepted: true }, { tag_id: 2, accepted: 'no', rejection_code: 'OUT_OF_RANGE' }],
    })).toMatchObject({ ok: false });
  });
});
