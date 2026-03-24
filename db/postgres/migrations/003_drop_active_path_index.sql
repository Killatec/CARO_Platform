-- Drop the partial unique index that only allowed one active row per tag_path.
-- The DISTINCT ON (tag_id) ORDER BY tag_id, registry_rev DESC query in
-- getActiveRegistry correctly returns the latest row per tag regardless of
-- the retired flag on older rows, so the constraint is unnecessary and
-- conflicts with the append-only insert pattern used by applyRegistry.
DROP INDEX IF EXISTS uq_tag_registry_active_path;
