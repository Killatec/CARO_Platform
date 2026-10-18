import { query } from './query.js';

export interface PendingSetpointRow {
  tag_id: number;
  value:  number | boolean;
}

/**
 * Batch upsert pending setpoint values. Overwrites existing row for any
 * tag_id that already has an entry. Fire-and-forget safe — callers should
 * catch and log errors rather than propagating them to the write response.
 */
export async function upsertPendingSetpoints(
  entries: PendingSetpointRow[],
): Promise<void> {
  if (entries.length === 0) return;

  const clauses = entries.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::jsonb)`).join(', ');
  const params  = entries.flatMap(e => [e.tag_id, JSON.stringify(e.value)]);

  await query(
    `INSERT INTO pending_setpoint_values (tag_id, value)
     VALUES ${clauses}
     ON CONFLICT (tag_id) DO UPDATE
       SET value  = EXCLUDED.value,
           set_at = now()`,
    params,
  );
}

/**
 * Returns all pending setpoint rows whose tag_id is in the provided list.
 * Returns an empty array if tagIds is empty.
 */
export async function getPendingSetpointsByTagIds(
  tagIds: number[],
): Promise<PendingSetpointRow[]> {
  if (tagIds.length === 0) return [];

  const result = await query(
    `SELECT tag_id, value
     FROM pending_setpoint_values
     WHERE tag_id = ANY($1::int[])`,
    [tagIds],
  );

  return result.rows as PendingSetpointRow[];
}

/** 'accepted' = CMD_ACK confirmed the value; 'timeout' = no CMD_ACK in time. */
export type SetpointAckStatus = 'accepted' | 'timeout';

export interface CommandedSetpointEntry {
  tag_id:     number;
  /** null = unpopulated (stored as SQL NULL, not JSON null). */
  value:      number | boolean | null;
  ack_status: SetpointAckStatus;
}

export interface CommandedSetpointRow extends CommandedSetpointEntry {
  set_at: Date;
}

/**
 * Batch upsert the last commanded value per Set. Overwrites the existing row
 * for any tag_id; if a tag_id appears more than once, the last entry wins
 * (Postgres refuses to update one row twice in a single INSERT ... ON CONFLICT).
 * Fire-and-forget safe — callers should catch and log errors rather than
 * propagating them to the write response.
 */
export async function upsertCommandedSetpoints(
  entries: CommandedSetpointEntry[],
): Promise<void> {
  const byTagId = new Map(entries.map(e => [e.tag_id, e]));
  if (byTagId.size === 0) return;

  const unique  = [...byTagId.values()];
  const clauses = unique.map((_, i) => `($${i * 3 + 1}::int, $${i * 3 + 2}::jsonb, $${i * 3 + 3}::varchar)`).join(', ');
  const params  = unique.flatMap(e => [e.tag_id, e.value === null ? null : JSON.stringify(e.value), e.ack_status]);

  await query(
    `INSERT INTO commanded_setpoints (tag_id, value, ack_status)
     VALUES ${clauses}
     ON CONFLICT (tag_id) DO UPDATE
       SET value      = EXCLUDED.value,
           ack_status = EXCLUDED.ack_status,
           set_at     = now()`,
    params,
  );
}

/**
 * Returns the commanded_setpoints rows whose tag_id is in the provided list.
 * A tag_id with no row is simply absent — callers treat it as unpopulated.
 * Returns an empty array if tagIds is empty.
 */
export async function getCommandedSetpointsByTagIds(
  tagIds: number[],
): Promise<CommandedSetpointRow[]> {
  if (tagIds.length === 0) return [];

  const result = await query(
    `SELECT tag_id, value, ack_status, set_at
     FROM commanded_setpoints
     WHERE tag_id = ANY($1::int[])`,
    [tagIds],
  );

  return result.rows as CommandedSetpointRow[];
}
