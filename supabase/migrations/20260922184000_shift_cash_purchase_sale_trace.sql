-- Shift cash integrity + sale/order traceability.
-- Scope:
-- 1) Persist the original POS order on financial sales without changing invoice numbering.
-- 2) Backfill historical mappings from kitchen settlement events.
-- 3) Keep future mappings synchronized when kitchen inventory events settle.
-- 4) Make expected drawer cash subtract posted cash expenses and cash purchases exactly once.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source_order_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_source_order_id_fkey'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_source_order_id_fkey
      FOREIGN KEY (source_order_id)
      REFERENCES public.orders(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sales_source_order_id
  ON public.sales(source_order_id);

WITH mapped_sales AS (
  SELECT
    e.settled_sale_id AS sale_id,
    (array_agg(DISTINCT e.order_id))[1] AS order_id
  FROM public.order_kitchen_inventory_events e
  WHERE e.settled_sale_id IS NOT NULL
  GROUP BY e.settled_sale_id
  HAVING count(DISTINCT e.order_id) = 1
)
UPDATE public.sales s
SET source_order_id = m.order_id
FROM mapped_sales m
WHERE s.id = m.sale_id
  AND s.source_order_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_sale_source_order_from_kitchen_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.settled_sale_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.sales s
  SET source_order_id = NEW.order_id
  WHERE s.id = NEW.settled_sale_id
    AND s.branch_id = NEW.branch_id
    AND (
      s.source_order_id IS NULL
      OR s.source_order_id = NEW.order_id
    );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_sale_source_order_from_kitchen_event
  ON public.order_kitchen_inventory_events;

CREATE TRIGGER trg_sync_sale_source_order_from_kitchen_event
AFTER INSERT OR UPDATE OF settled_sale_id
ON public.order_kitchen_inventory_events
FOR EACH ROW
WHEN (NEW.settled_sale_id IS NOT NULL)
EXECUTE FUNCTION public.sync_sale_source_order_from_kitchen_event();

REVOKE ALL ON FUNCTION public.sync_sale_source_order_from_kitchen_event() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._compute_shift_expected_cash(p_shift_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH target_shift AS (
    SELECT
      s.id,
      s.branch_id,
      s.opening_amount,
      s.opened_at,
      COALESCE(s.closed_at, now()) AS effective_closed_at
    FROM public.shifts s
    WHERE s.id = p_shift_id
  ),
  operation_cash AS (
    SELECT COALESCE(sum(
      CASE
        WHEN COALESCE(op.payment_method, 'cash') = 'cash'
             AND op.operation_type IN ('sale', 'cash_in')
          THEN op.amount
        WHEN COALESCE(op.payment_method, 'cash') = 'cash'
             AND op.operation_type IN ('refund', 'cash_out')
          THEN -op.amount
        WHEN COALESCE(op.payment_method, 'cash') = 'cash'
             AND op.operation_type = 'expense'
             AND NOT EXISTS (
               SELECT 1
               FROM public.expenses e
               WHERE e.id = op.reference_id
                 AND e.status = 'posted'
             )
          THEN -op.amount
        ELSE 0
      END
    ), 0) AS amount
    FROM target_shift s
    LEFT JOIN public.shift_operations op
      ON op.shift_id = s.id
  ),
  posted_cash_expenses AS (
    SELECT COALESCE(sum(e.amount), 0) AS amount
    FROM target_shift s
    JOIN public.expenses e
      ON e.branch_id = s.branch_id
     AND e.status = 'posted'
     AND COALESCE(e.payment_method, 'cash') = 'cash'
     AND (
       e.shift_id = s.id
       OR (
         e.shift_id IS NULL
         AND e.created_at >= s.opened_at
         AND e.created_at <= s.effective_closed_at
       )
     )
  ),
  cash_purchases AS (
    SELECT COALESCE(sum(
      GREATEST(
        COALESCE(p.paid_amount, 0) - COALESCE(p.returned_amount, 0),
        0
      )
    ), 0) AS amount
    FROM target_shift s
    JOIN public.purchases p
      ON p.branch_id = s.branch_id
     AND COALESCE(p.payment_method, 'cash') = 'cash'
     AND COALESCE(p.status, 'completed') IN ('completed', 'returned')
     AND p.created_at >= s.opened_at
     AND p.created_at <= s.effective_closed_at
  )
  SELECT round(
    COALESCE(s.opening_amount, 0)
    + COALESCE(o.amount, 0)
    - COALESCE(e.amount, 0)
    - COALESCE(p.amount, 0),
    2
  )
  FROM target_shift s
  CROSS JOIN operation_cash o
  CROSS JOIN posted_cash_expenses e
  CROSS JOIN cash_purchases p;
$function$;

REVOKE ALL ON FUNCTION public._compute_shift_expected_cash(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._compute_shift_expected_cash(uuid) TO service_role, postgres;
