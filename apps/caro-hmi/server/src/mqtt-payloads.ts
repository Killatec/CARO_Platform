// mqtt-payloads.ts — shape checks for untrusted MQTT payloads (CARO_MQTT_Spec §5.1, §6.2).
//
// MqttBridge only knows the JSON parsed; these turn the parsed value into a
// typed message or a reason to drop it, so nothing downstream (TelemetryIntake,
// CmdController) ever sees a malformed payload. Handshake messages are checked
// by HandshakeController instead.

import type { TelemetryMessage } from './telemetry-intake.js';
import type { CmdAck } from './mqtt-bridge.js';

type TelemetryValue = TelemetryMessage['tags'][number]['value'];

export type ParseResult<T> =
  | { ok: true; message: T; skipped: number }
  | { ok: false; reason: string };

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isTagId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffffff;
}

/** A value the ICD allows (§5.1): number, boolean, string, number array or null. */
function isTelemetryValue(v: unknown): v is TelemetryValue {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  return Array.isArray(v) && v.every(x => typeof x === 'number' && Number.isFinite(x));
}

/**
 * Telemetry: the frame is dropped unless `timestamp` is a finite number,
 * `status` a string and `tags` an array. Entries without a valid tag_id or
 * value are skipped (counted in `skipped`); the rest of the frame still applies.
 */
export function parseTelemetry(raw: unknown): ParseResult<TelemetryMessage> {
  if (!isObject(raw)) return { ok: false, reason: 'not a JSON object' };
  if (typeof raw.timestamp !== 'number' || !Number.isFinite(raw.timestamp)) return { ok: false, reason: 'timestamp is not a number' };
  if (typeof raw.status !== 'string') return { ok: false, reason: 'status is not a string' };
  if (!Array.isArray(raw.tags)) return { ok: false, reason: 'tags is not an array' };

  const tags: TelemetryMessage['tags'] = [];
  let skipped = 0;
  for (const entry of raw.tags) {
    if (isObject(entry) && isTagId(entry.tag_id) && 'value' in entry && isTelemetryValue(entry.value)) {
      tags.push({ tag_id: entry.tag_id, value: entry.value });
    } else {
      skipped++;
    }
  }
  return { ok: true, message: { timestamp: raw.timestamp, status: raw.status, tags }, skipped };
}

/**
 * CMD_ACK: dropped unless it is an object with a string `command_id`, an
 * optional string `error`, and an optional `results` array whose every entry
 * has an integer tag_id, a boolean `accepted` and an optional string
 * `rejection_code`. One malformed result drops the whole ACK: filtering it out
 * could turn a rejection into an all-accepted ACK, while dropping lets the
 * command time out.
 */
export function parseCmdAck(raw: unknown): ParseResult<CmdAck> {
  if (!isObject(raw)) return { ok: false, reason: 'not a JSON object' };
  if (typeof raw.command_id !== 'string') return { ok: false, reason: 'command_id is not a string' };
  if (raw.error !== undefined && typeof raw.error !== 'string') return { ok: false, reason: 'error is not a string' };

  let results: CmdAck['results'];
  if (raw.results !== undefined) {
    if (!Array.isArray(raw.results)) return { ok: false, reason: 'results is not an array' };
    results = [];
    for (const r of raw.results) {
      if (!isObject(r) || !isTagId(r.tag_id) || typeof r.accepted !== 'boolean' ||
          (r.rejection_code !== undefined && typeof r.rejection_code !== 'string')) {
        return { ok: false, reason: 'malformed results entry' };
      }
      results.push({
        tag_id:   r.tag_id,
        accepted: r.accepted,
        ...(r.rejection_code !== undefined ? { rejection_code: r.rejection_code as string } : {}),
      });
    }
  }

  return {
    ok: true,
    message: {
      command_id:   raw.command_id,
      command_type: typeof raw.command_type === 'string' ? raw.command_type : '',
      ts_utc_ms:    typeof raw.ts_utc_ms === 'number' ? raw.ts_utc_ms : 0,
      ...(raw.error !== undefined ? { error: raw.error as string } : {}),
      ...(results !== undefined ? { results } : {}),
    },
    skipped: 0,
  };
}
