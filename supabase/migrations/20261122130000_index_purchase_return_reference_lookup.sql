-- The purchase-return journal lookup used by process_purchase_return
-- and update_purchase_invoice currently scans all journal rows of a branch.
-- 2026-11-22 read-only EXPLAIN observed 6,872 rows filtered and 842 shared hits.
-- This partial index supports only the purchase_return search and minimizes writes.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
CREATE INDEX IF NOT EXISTS idx_je_purchase_return_branch_reference
ON public.journal_entries (branch_id, reference_number)
WHERE reference_type = 'purchase_return';
