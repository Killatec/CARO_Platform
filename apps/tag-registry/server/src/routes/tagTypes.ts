import express, { Router } from 'express';
import { asyncWrap } from '@caro/server/asyncWrap';
import { getTagTypes } from '@caro/db';

const router: Router = express.Router();

/**
 * GET /api/v1/tag-types
 * Returns all rows from the tag_types lookup table.
 */
router.get('/', asyncWrap(async (_req, res) => {
  const tagTypes = await getTagTypes();
  res.json({ ok: true, data: tagTypes });
}));

export default router;
