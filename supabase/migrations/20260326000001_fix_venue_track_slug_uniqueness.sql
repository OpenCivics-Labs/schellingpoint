-- Fix venue and track slug uniqueness constraints for multi-tenancy
-- The original single-tenant schema had globally unique slugs.
-- In multi-tenant mode, slugs only need to be unique within an event.

-- =============================================================================
-- VENUES: Replace global UNIQUE(slug) with UNIQUE(event_id, slug)
-- =============================================================================
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_slug_key;
ALTER TABLE venues ADD CONSTRAINT venues_event_slug_unique UNIQUE (event_id, slug);

-- =============================================================================
-- TRACKS: Replace global UNIQUE(slug) with UNIQUE(event_id, slug)
-- =============================================================================
ALTER TABLE tracks DROP CONSTRAINT IF EXISTS tracks_slug_key;
ALTER TABLE tracks ADD CONSTRAINT tracks_event_slug_unique UNIQUE (event_id, slug);
