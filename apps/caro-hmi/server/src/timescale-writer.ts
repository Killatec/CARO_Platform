import type { DbWriter, DbWriteEntry } from './db-pipeline.js';
import { writeTagSamples } from '@caro/db';
import type { TagSampleRow } from '@caro/db';

export class TimescaleDbWriter implements DbWriter {
  readonly name = 'timescale';
  private _strDropLogged = false;

  async write(entries: DbWriteEntry[]): Promise<void> {
    const rows: TagSampleRow[] = [];
    for (const entry of entries) {
      for (const { tagId, value } of entry.tags) {
        rows.push({ ts: entry.moduleTs, tagId, value: this._coerce(value) });
      }
    }
    if (rows.length === 0) return;
    await writeTagSamples(rows);
  }

  private _coerce(v: number | boolean | string | null): number | null {
    if (v === null) return null;
    if (typeof v === 'boolean') return v ? 1.0 : 0.0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    // string — not historian-eligible; drop as quality gap
    if (!this._strDropLogged) {
      this._strDropLogged = true;
      console.warn('[TimescaleDbWriter] dropping string tag value — check tag type vs historian eligibility');
    }
    return null;
  }
}
