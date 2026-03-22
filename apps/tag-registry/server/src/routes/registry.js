import express from 'express';
import { asyncWrap } from '../middleware/asyncWrap.js';
import { getActiveRegistry } from '../services/registryService.js';

const router = express.Router();

/**
 * GET /api/v1/registry
 * Returns the current active (non-retired) registry rows from the database.
 */
router.get('/', asyncWrap(async (req, res) => {
  const tags = await getActiveRegistry();
  res.json({ ok: true, data: { tags } });
}));

export default router;
