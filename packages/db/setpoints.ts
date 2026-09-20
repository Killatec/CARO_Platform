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
