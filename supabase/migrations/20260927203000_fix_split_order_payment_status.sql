-- Fix linked-order payment_status for authoritative split-tender settlement.
-- Root cause: process_sale_split delegates to _process_sale_core directly and
-- finalizes Kitchen settlement, but it never performs the linked-order payment
-- status reconciliation that the normal process_sale wrapper performs.
--
-- Scope lock:
-- - split-tender settlement only;
-- - no Print Agent / cloud print / printer routing changes;
-- - no KDS or send_to_kitchen semantic changes;
-- - no inventory deduction changes;
-- - no RLS weakening.

DO $patch$
DECLARE
  v_def text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(
    'public.process_sale_split(text,uuid,uuid,uuid,uuid,numeric,numeric,text,numeric,numeric,numeric,jsonb,text,jsonb,uuid,text,uuid,uuid,integer)'::regprocedure
  ) INTO v_def;

  IF position('SPLIT_ORDER_PAYMENT_STATUS_SYNC' IN v_def) > 0 THEN
    RETURN;
  END IF;

  v_old :=
    '    UPDATE public.sales' || E'\n' ||
    '    SET payment_method = ''split'', paid_amount = v_sale_total' || E'\n' ||
    '    WHERE id = v_sale_id;' || E'\n';

  v_new :=
    v_old || E'\n' ||
    '    -- SPLIT_ORDER_PAYMENT_STATUS_SYNC' || E'\n' ||
    '    -- Mirror the normal process_sale linked-order reconciliation after' || E'\n' ||
    '    -- the split sale has its final paid_amount and Kitchen events are settled.' || E'\n' ||
    '    IF p_order_id IS NOT NULL THEN' || E'\n' ||
    '      UPDATE public.orders o' || E'\n' ||
    '      SET payment_status = CASE' || E'\n' ||
    '            WHEN x.total > 0 AND x.paid >= x.total THEN' || E'\n' ||
    '              CASE WHEN o.status = ''completed'' THEN ''paid'' ELSE ''partial'' END' || E'\n' ||
    '            WHEN x.paid > 0 THEN ''partial''' || E'\n' ||
    '            ELSE ''unpaid''' || E'\n' ||
    '          END,' || E'\n' ||
    '          payment_at = CASE WHEN x.paid > 0 THEN now() ELSE o.payment_at END,' || E'\n' ||
    '          updated_at = now()' || E'\n' ||
    '      FROM (' || E'\n' ||
    '        SELECT' || E'\n' ||
    '          COALESCE(sum(s.paid_amount), 0) AS paid,' || E'\n' ||
    '          COALESCE(sum(s.total), 0) AS total' || E'\n' ||
    '        FROM public.sales s' || E'\n' ||
    '        WHERE s.id IN (' || E'\n' ||
    '          SELECT DISTINCT e.settled_sale_id' || E'\n' ||
    '          FROM public.order_kitchen_inventory_events e' || E'\n' ||
    '          WHERE e.order_id = p_order_id' || E'\n' ||
    '            AND e.settled_sale_id IS NOT NULL' || E'\n' ||
    '        )' || E'\n' ||
    '      ) x' || E'\n' ||
    '      WHERE o.id = p_order_id' || E'\n' ||
    '        AND o.branch_id = p_branch_id;' || E'\n' ||
    '    END IF;' || E'\n';

  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'process_sale_split paid-sale marker drift; refusing payment-status patch';
  END IF;

  v_def := replace(v_def, v_old, v_new);
  EXECUTE v_def;
END;
$patch$;

-- Deterministic repair for historical linked orders that were successfully
-- settled through split tender but retained an obsolete order payment_status.
-- The authoritative amounts come from settled sales, de-duplicated by sale id.
WITH linked_sales AS (
  SELECT DISTINCT
    e.order_id,
    e.settled_sale_id
  FROM public.order_kitchen_inventory_events e
  WHERE e.settled_sale_id IS NOT NULL
),
payment_truth AS (
  SELECT
    ls.order_id,
    COALESCE(sum(s.paid_amount), 0) AS paid,
    COALESCE(sum(s.total), 0) AS total,
    max(s.created_at) AS last_payment_at,
    bool_or(s.payment_method = 'split') AS has_split
  FROM linked_sales ls
  JOIN public.sales s
    ON s.id = ls.settled_sale_id
   AND s.status = 'completed'
  GROUP BY ls.order_id
),
repair AS (
  SELECT
    o.id,
    CASE
      WHEN p.total > 0 AND p.paid >= p.total THEN
        CASE WHEN o.status = 'completed' THEN 'paid' ELSE 'partial' END
      WHEN p.paid > 0 THEN 'partial'
      ELSE 'unpaid'
    END AS expected_payment_status,
    p.last_payment_at
  FROM public.orders o
  JOIN payment_truth p ON p.order_id = o.id
  WHERE p.has_split
)
UPDATE public.orders o
SET payment_status = r.expected_payment_status,
    payment_at = CASE
      WHEN r.expected_payment_status IN ('paid','partial')
        THEN COALESCE(o.payment_at, r.last_payment_at)
      ELSE o.payment_at
    END,
    updated_at = now()
FROM repair r
WHERE o.id = r.id
  AND o.payment_status IS DISTINCT FROM r.expected_payment_status;
