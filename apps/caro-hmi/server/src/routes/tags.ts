import { Router } from 'express';
import { asyncWrap } from '@caro/server';
import type { CaroError } from '@caro/server';
import type { TagDef } from '@caro/hmi-context';
import type { CmdController } from '../cmd-controller.js';

type ValidationDetail =
  | { tag_id: number; code: 'TAG_NOT_FOUND' }
  | { tag_id: number; code: 'TAG_NOT_WRITABLE' }
  | { tag_id: number; code: 'TYPE_MISMATCH'; message: string };

function coerceValue(raw: unknown): number | boolean | null {
  if (typeof raw === 'number' || typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const n = parseFloat(raw);
    return isNaN(n) ? null : n;
  }
  return null;
}

export function createTagsRouter(
  tagMap: Map<number, TagDef>,
  cmdController: CmdController,
  trendableTagIds: Set<number>,
): Router {
  const router = Router();

  router.get('/trendable', asyncWrap(async (_req, res) => {
    const tags: Array<{ tag_id: number; tag_path: string }> = [];
    for (const id of trendableTagIds) {
      const def = tagMap.get(id);
      if (def) tags.push({ tag_id: def.tag_id, tag_path: def.tag_path });
    }
    res.json({ ok: true, data: { tags } });
  }));

  router.get('/', asyncWrap(async (_req, res) => {
    const tags = Array.from(tagMap.values());
    res.json({
      ok: true,
      data: {
        tags,
        pagination: {
          page: 1,
          page_size: tags.length,
          total: tags.length,
          total_pages: 1,
        },
      },
    });
  }));

  router.post('/write', asyncWrap(async (req, res) => {
    const body = req.body as { values?: unknown; comment?: unknown };

    if (!Array.isArray(body.values) || body.values.length === 0) {
      const err = new Error('values must be a non-empty array') as CaroError;
      err.status = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const rawValues = body.values as Array<{ tag_id?: unknown; value?: unknown }>;
    const errors: ValidationDetail[] = [];
    const valid: Array<{ tag_id: number; value: number | boolean }> = [];

    for (const entry of rawValues) {
      const tag_id = typeof entry.tag_id === 'number' ? entry.tag_id : NaN;
      if (!isFinite(tag_id)) continue; // malformed entry — skip silently

      const tagDef = tagMap.get(tag_id);
      if (!tagDef) {
        errors.push({ tag_id, code: 'TAG_NOT_FOUND' });
        continue;
      }

      if (!tagDef.is_setpoint) {
        errors.push({ tag_id, code: 'TAG_NOT_WRITABLE' });
        continue;
      }

      const value = coerceValue(entry.value);
      if (value === null) {
        errors.push({ tag_id, code: 'TYPE_MISMATCH', message: `Expected number or boolean, got ${typeof entry.value}` });
        continue;
      }

      valid.push({ tag_id, value });
    }

    if (errors.length > 0) {
      const err = new Error('One or more tags failed validation') as CaroError;
      err.status = 422;
      err.code = 'WRITE_VALIDATION_FAILED';
      err.details = errors;
      throw err;
    }

    const writeResult = await cmdController.writeValues(valid);
    res.json({ ok: true, data: writeResult });
  }));

  return router;
}
