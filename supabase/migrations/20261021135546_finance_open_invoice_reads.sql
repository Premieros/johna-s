-- Read-only projections. No cache, triggers, new indexes or business writes.
-- The caller must still pass the base sales/purchases SELECT and RLS policies.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
CREATE VIEW public.finance_open_receivable_invoices WITH (security_invoker = true) AS
SELECT id,branch_id,customer_id,invoice_number,
       total - COALESCE(paid_amount,0) - COALESCE(refunded_amount,0) AS open
FROM public.sales
WHERE total>0 AND status<>'returned'
  AND total-COALESCE(paid_amount,0)-COALESCE(refunded_amount,0)>0;
CREATE VIEW public.finance_open_payable_invoices WITH (security_invoker = true) AS
SELECT id,branch_id,supplier_id,invoice_number,
       total - COALESCE(paid_amount,0) - COALESCE(returned_amount,0) AS open
FROM public.purchases
WHERE total>0 AND status='completed'
  AND total-COALESCE(paid_amount,0)-COALESCE(returned_amount,0)>0;
REVOKE ALL ON public.finance_open_receivable_invoices,public.finance_open_payable_invoices FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.finance_open_receivable_invoices,public.finance_open_payable_invoices TO authenticated;
