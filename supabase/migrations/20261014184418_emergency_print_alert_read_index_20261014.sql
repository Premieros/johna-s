-- Archived, already-applied owner-directed emergency production DDL at 20261014184418.
-- Do NOT replay manually on production. Exact version is in Supabase migration history.
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '15s';
CREATE INDEX IF NOT EXISTS idx_cloud_print_alerts_recent
  ON public.cloud_print_jobs (branch_id, updated_at DESC)
  WHERE status = 'failed' OR (status = 'submitted' AND attempts > 1);
