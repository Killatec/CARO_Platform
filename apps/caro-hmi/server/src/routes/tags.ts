import { Router } from 'express';
import { asyncWrap } from '@caro/server';
import type { TagDef } from '@caro/hmi-context';

export function createTagsRouter(tagMap: Map<number, TagDef>): Router {
  const router = Router();

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

  return router;
}
