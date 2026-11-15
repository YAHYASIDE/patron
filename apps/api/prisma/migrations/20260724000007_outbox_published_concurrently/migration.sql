-- Partial index so the outbox purge never touches live (unpublished) events.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "outbox_published_idx"
  ON "outbox_events" ("publishedAt") WHERE "status" = 'PUBLISHED';
