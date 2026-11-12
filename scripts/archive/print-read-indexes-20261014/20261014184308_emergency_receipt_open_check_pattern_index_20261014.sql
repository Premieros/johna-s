-- Archived, already-applied owner-directed emergency production DDL at 20261014184308.
-- Do NOT replay manually on production. Exact version is in Supabase migration history.
-- Protect active POS writes by failing rather than holding a lock when busy.
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '15s';
CREATE INDEX IF NOT EXISTS idx_cloud_print_receipt_open_check_lookup
  ON public.cloud_print_jobs (branch_id, idempotency_key text_pattern_ops)
  WHERE kind = 'receipt';
