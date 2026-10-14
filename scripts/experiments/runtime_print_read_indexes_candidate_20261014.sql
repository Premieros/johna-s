-- REVIEW ONLY: not a migration; never applied by deployments.
-- Target: Premieros/johna-s / azzdesuowpdcoflmyezn only.
-- Separate explicit production approval and bounded lock window required.
-- Retains queue writes, routing, idempotency constraints, RLS and all functions.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

-- Existing receipt lock lookup uses LIKE 'open-check:<order UUID>:%'.
CREATE INDEX idx_cloud_print_receipt_open_check_lookup
  ON public.cloud_print_jobs (branch_id, idempotency_key text_pattern_ops)
  WHERE kind = 'receipt';

-- Only notifications of failures/recovery are requested by ApprovalInbox.
CREATE INDEX idx_cloud_print_alerts_recent
  ON public.cloud_print_jobs (branch_id, updated_at DESC)
  WHERE status = 'failed' OR (status = 'submitted' AND attempts > 1);
