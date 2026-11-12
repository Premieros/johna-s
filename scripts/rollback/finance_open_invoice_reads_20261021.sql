-- Revert frontend to #529 before removing its new read projections.
-- No CASCADE: unexpected dependencies must stop recovery.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='10s';
DROP VIEW public.finance_open_receivable_invoices;
DROP VIEW public.finance_open_payable_invoices;
COMMIT;
