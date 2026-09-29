BEGIN;

CREATE OR REPLACE FUNCTION public._compute_shift_expected_cash(p_shift_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
  WITH target_shift AS (
    SELECT
      s.id,
      s.branch_id,
      s.opening_amount,
      s.opened_at,
      COALESCE(s.closed_at,now()) effective_closed_at
    FROM public.shifts s
    WHERE s.id=p_shift_id
  ),
  sale_ids AS (
    SELECT DISTINCT op.reference_id sale_id
    FROM public.shift_operations op
    JOIN target_shift s ON s.id=op.shift_id
    WHERE op.reference_type='sale'
      AND op.reference_id IS NOT NULL
  ),
  canonical_cash_sales AS (
    SELECT COALESCE(sum(st.amount),0) amount
    FROM sale_ids x
    CROSS JOIN LATERAL private.report_sale_settlement_lines(x.sale_id) st
    WHERE st.method='cash'
  ),
  legacy_unlinked_cash_sales AS (
    SELECT COALESCE(sum(op.amount),0) amount
    FROM target_shift s
    JOIN public.shift_operations op ON op.shift_id=s.id
    WHERE op.operation_type='sale'
      AND COALESCE(op.payment_method,'cash')='cash'
      AND op.reference_id IS NULL
  ),
  cash_adjustments AS (
    SELECT COALESCE(sum(
      CASE
        WHEN COALESCE(op.payment_method,'cash')='cash'
             AND op.operation_type='cash_in'
          THEN op.amount
        WHEN COALESCE(op.payment_method,'cash')='cash'
             AND op.operation_type='cash_out'
          THEN -op.amount
        WHEN COALESCE(op.payment_method,'cash')='cash'
             AND op.operation_type='refund'
             AND NOT EXISTS (
               SELECT 1
               FROM sale_ids x
               WHERE x.sale_id=op.reference_id
             )
          THEN -op.amount
        WHEN COALESCE(op.payment_method,'cash')='cash'
             AND op.operation_type='expense'
             AND NOT EXISTS (
               SELECT 1
               FROM public.expenses e
               WHERE e.id=op.reference_id
                 AND e.status='posted'
             )
          THEN -op.amount
        ELSE 0
      END
    ),0) amount
    FROM target_shift s
    LEFT JOIN public.shift_operations op ON op.shift_id=s.id
  ),
  posted_branch_cash_expenses AS (
    SELECT COALESCE(sum(e.amount),0) amount
    FROM target_shift s
    JOIN public.expenses e
      ON e.branch_id=s.branch_id
     AND e.status='posted'
     AND COALESCE(e.payment_method,'cash')='cash'
     AND e.shift_id=s.id
    JOIN public.treasury_accounts t
      ON t.id=e.treasury_account_id
     AND t.branch_id=s.branch_id
     AND COALESCE(t.scope,'branch')='branch'
     AND COALESCE(
       t.kind,
       CASE WHEN t.account_type='bank' THEN 'bank' ELSE 'branch_cash' END
     )='branch_cash'
  ),
  cash_purchases AS (
    SELECT COALESCE(sum(
      GREATEST(COALESCE(p.paid_amount,0)-COALESCE(p.returned_amount,0),0)
    ),0) amount
    FROM target_shift s
    JOIN public.purchases p
      ON p.branch_id=s.branch_id
     AND COALESCE(p.payment_method,'cash')='cash'
     AND COALESCE(p.status,'completed') IN ('completed','returned')
     AND p.created_at>=s.opened_at
     AND p.created_at<=s.effective_closed_at
  )
  SELECT round(
    COALESCE(s.opening_amount,0)
    +COALESCE(cs.amount,0)
    +COALESCE(ls.amount,0)
    +COALESCE(a.amount,0)
    -COALESCE(e.amount,0)
    -COALESCE(p.amount,0),
    2
  )
  FROM target_shift s
  CROSS JOIN canonical_cash_sales cs
  CROSS JOIN legacy_unlinked_cash_sales ls
  CROSS JOIN cash_adjustments a
  CROSS JOIN posted_branch_cash_expenses e
  CROSS JOIN cash_purchases p;
$function$;

REVOKE ALL ON FUNCTION public._compute_shift_expected_cash(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._compute_shift_expected_cash(uuid)
  TO service_role,postgres;

COMMIT;
