-- =============================================================================
-- Migration: 004
-- Description: Align tag_registry.tag_id column type with CARO_DB_Spec v1.2
--              §2.1 and §3.1, which define tag_id as INTEGER (uint32).
--              Migration 001 incorrectly created this column as BIGINT.
-- Date: 2026-03-29
-- Idempotency: The outer DO block checks pg_attribute/pg_type to confirm the
--              column is still int8 (BIGINT) before acting. If it is already
--              INTEGER the block exits silently — safe to re-run.
-- Safety: The inner block checks that no existing tag_id value exceeds the
--         PostgreSQL INTEGER maximum (2,147,483,647). If any row violates
--         this constraint the inner block raises an exception and the ALTER
--         TABLE is never executed.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM   pg_attribute a
    JOIN   pg_class     c ON c.oid = a.attrelid
    JOIN   pg_type      t ON t.oid = a.atttypid
    WHERE  c.relname  = 'tag_registry'
      AND  a.attname  = 'tag_id'
      AND  t.typname  = 'int8'
  ) THEN
    DECLARE
      max_val BIGINT;
    BEGIN
      SELECT COALESCE(MAX(tag_id), 0) INTO max_val FROM tag_registry;
      IF max_val > 2147483647 THEN
        RAISE EXCEPTION
          'Migration 004 aborted: max tag_id value % exceeds INTEGER range '
          '(max 2,147,483,647). All tag_id values must fit in uint32 before '
          'this migration can run.',
          max_val;
      END IF;
    END;
    ALTER TABLE tag_registry ALTER COLUMN tag_id TYPE INTEGER;
  END IF;
END $$;
