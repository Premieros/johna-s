-- Stability Foundation Phase 3
-- Dashboard bounded aggregate snapshot.
-- SECURITY INVOKER by default: underlying table RLS/history visibility remains authoritative.

CREATE OR REPLACE FUNCTION public.get_dashboard_sales_snapshot(
  p_branch_id uuid,
  p_current_from timestamptz,
  p_current_to timestamptz,
  p_previous_from timestamptz,
  p_previous_to timestamptz,
  p_granularity text DEFAULT 'day',
  p_timezone text DEFAULT 'UTC'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO public, pg_temp
AS $function$
WITH
params AS (
  SELECT
    CASE WHEN p_granularity IN ('hour','day','month') THEN p_granularity ELSE 'day' END AS granularity,
    COALESCE(NULLIF(p_timezone, ''), 'UTC') AS tz
),
current_sales AS MATERIALIZED (
  SELECT
    s.id,
    s.invoice_number,
    s.branch_id,
    s.created_at,
    s.order_type,
    s.total,
    s.paid_amount,
    s.payment_method,
    s.refunded_amount,
    s.discount_amount,
    GREATEST(COALESCE(s.total, 0) - COALESCE(s.refunded_amount, 0), 0)::numeric AS net_total
  FROM public.sales s
  WHERE s.created_at >= p_current_from
    AND s.created_at <= p_current_to
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
),
previous_sales AS MATERIALIZED (
  SELECT
    s.id,
    s.branch_id,
    s.created_at,
    s.total,
    s.paid_amount,
    s.payment_method,
    s.refunded_amount,
    s.discount_amount,
    GREATEST(COALESCE(s.total, 0) - COALESCE(s.refunded_amount, 0), 0)::numeric AS net_total
  FROM public.sales s
  WHERE s.created_at >= p_previous_from
    AND s.created_at <= p_previous_to
    AND (p_branch_id IS NULL OR s.branch_id = p_branch_id)
),
current_summary AS (
  SELECT
    count(*)::bigint AS orders,
    COALESCE(sum(net_total), 0)::numeric AS sales,
    COALESCE(sum(COALESCE(refunded_amount, 0)), 0)::numeric AS returns,
    COALESCE(sum(COALESCE(discount_amount, 0)), 0)::numeric AS discounts
  FROM current_sales
),
previous_summary AS (
  SELECT
    count(*)::bigint AS orders,
    COALESCE(sum(net_total), 0)::numeric AS sales,
    COALESCE(sum(GREATEST(COALESCE(paid_amount, 0) - COALESCE(refunded_amount, 0), 0)), 0)::numeric AS payments,
    COALESCE(sum(COALESCE(refunded_amount, 0)), 0)::numeric AS returns,
    COALESCE(sum(COALESCE(discount_amount, 0)), 0)::numeric AS discounts
  FROM previous_sales
),
current_payment_rows AS (
  SELECT
    cs.id AS sale_id,
    COALESCE(sp.branch_id, cs.branch_id) AS branch_id,
    lower(COALESCE(sp.payment_method, 'other')) AS method,
    GREATEST(COALESCE(sp.amount, 0) - COALESCE(sp.refunded_amount, 0), 0)::numeric AS amount
  FROM current_sales cs
  JOIN public.sale_payments sp ON sp.sale_id = cs.id
  UNION ALL
  SELECT
    cs.id,
    cs.branch_id,
    lower(COALESCE(cs.payment_method, 'other')),
    GREATEST(COALESCE(cs.paid_amount, 0) - COALESCE(cs.refunded_amount, 0), 0)::numeric
  FROM current_sales cs
  WHERE NOT EXISTS (SELECT 1 FROM public.sale_payments sp WHERE sp.sale_id = cs.id)
),
previous_payment_rows AS (
  SELECT
    ps.id AS sale_id,
    COALESCE(sp.branch_id, ps.branch_id) AS branch_id,
    lower(COALESCE(sp.payment_method, 'other')) AS method,
    GREATEST(COALESCE(sp.amount, 0) - COALESCE(sp.refunded_amount, 0), 0)::numeric AS amount
  FROM previous_sales ps
  JOIN public.sale_payments sp ON sp.sale_id = ps.id
  UNION ALL
  SELECT
    ps.id,
    ps.branch_id,
    lower(COALESCE(ps.payment_method, 'other')),
    GREATEST(COALESCE(ps.paid_amount, 0) - COALESCE(ps.refunded_amount, 0), 0)::numeric
  FROM previous_sales ps
  WHERE NOT EXISTS (SELECT 1 FROM public.sale_payments sp WHERE sp.sale_id = ps.id)
),
current_payment_summary AS (
  SELECT COALESCE(sum(amount), 0)::numeric AS payments FROM current_payment_rows
),
order_types AS (
  SELECT COALESCE(order_type, 'other') AS key, count(*)::bigint AS count
  FROM current_sales
  GROUP BY COALESCE(order_type, 'other')
  ORDER BY count(*) DESC, COALESCE(order_type, 'other')
  LIMIT 5
),
branch_totals AS (
  SELECT branch_id, count(*)::bigint AS orders, COALESCE(sum(net_total), 0)::numeric AS sales
  FROM current_sales
  GROUP BY branch_id
  ORDER BY COALESCE(sum(net_total), 0) DESC
  LIMIT 5
),
recent_sales AS (
  SELECT id, invoice_number, branch_id, created_at, order_type, total, refunded_amount
  FROM current_sales
  ORDER BY created_at DESC, id DESC
  LIMIT 5
),
top_products AS (
  SELECT
    COALESCE(p.name, 'Unknown') AS name,
    COALESCE(sum(GREATEST(COALESCE(si.quantity, 0) - COALESCE(si.refunded_quantity, 0), 0)), 0)::numeric AS quantity
  FROM current_sales cs
  JOIN public.sale_items si ON si.sale_id = cs.id
  LEFT JOIN public.products p ON p.id = si.product_id
  GROUP BY COALESCE(p.name, 'Unknown')
  HAVING COALESCE(sum(GREATEST(COALESCE(si.quantity, 0) - COALESCE(si.refunded_quantity, 0), 0)), 0) > 0
  ORDER BY quantity DESC, COALESCE(p.name, 'Unknown')
  LIMIT 5
),
current_series AS (
  SELECT
    CASE (SELECT granularity FROM params)
      WHEN 'hour' THEN to_char(date_trunc('hour', created_at AT TIME ZONE (SELECT tz FROM params)), 'YYYY-MM-DD"T"HH24:00:00')
      WHEN 'month' THEN to_char(date_trunc('month', created_at AT TIME ZONE (SELECT tz FROM params)), 'YYYY-MM-01')
      ELSE to_char(date_trunc('day', created_at AT TIME ZONE (SELECT tz FROM params)), 'YYYY-MM-DD')
    END AS bucket,
    COALESCE(sum(net_total), 0)::numeric AS sales
  FROM current_sales
  GROUP BY 1
  ORDER BY 1
),
previous_series AS (
  SELECT
    CASE (SELECT granularity FROM params)
      WHEN 'hour' THEN to_char(date_trunc('hour', created_at AT TIME ZONE (SELECT tz FROM params)), 'YYYY-MM-DD"T"HH24:00:00')
      WHEN 'month' THEN to_char(date_trunc('month', created_at AT TIME ZONE (SELECT tz FROM params)), 'YYYY-MM-01')
      ELSE to_char(date_trunc('day', created_at AT TIME ZONE (SELECT tz FROM params)), 'YYYY-MM-DD')
    END AS bucket,
    COALESCE(sum(net_total), 0)::numeric AS sales
  FROM previous_sales
  GROUP BY 1
  ORDER BY 1
),
payment_methods AS (
  SELECT branch_id, method, COALESCE(sum(amount), 0)::numeric AS total, count(*)::bigint AS count
  FROM current_payment_rows
  WHERE amount > 0
  GROUP BY branch_id, method
  ORDER BY COALESCE(sum(amount), 0) DESC
),
previous_payment_methods AS (
  SELECT branch_id, method, COALESCE(sum(amount), 0)::numeric AS total, count(*)::bigint AS count
  FROM previous_payment_rows
  WHERE amount > 0
  GROUP BY branch_id, method
  ORDER BY COALESCE(sum(amount), 0) DESC
)
SELECT jsonb_build_object(
  'current', jsonb_build_object(
    'orders', cs.orders,
    'sales', cs.sales,
    'payments', cps.payments,
    'returns', cs.returns,
    'discounts', cs.discounts
  ),
  'previous', jsonb_build_object(
    'orders', ps.orders,
    'sales', ps.sales,
    'payments', ps.payments,
    'returns', ps.returns,
    'discounts', ps.discounts
  ),
  'order_types', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM order_types x), '[]'::jsonb),
  'branches', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM branch_totals x), '[]'::jsonb),
  'recent_sales', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM recent_sales x), '[]'::jsonb),
  'top_products', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM top_products x), '[]'::jsonb),
  'current_series', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM current_series x), '[]'::jsonb),
  'previous_series', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM previous_series x), '[]'::jsonb),
  'payment_methods', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM payment_methods x), '[]'::jsonb),
  'previous_payment_methods', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM previous_payment_methods x), '[]'::jsonb)
)
FROM current_summary cs
CROSS JOIN previous_summary ps
CROSS JOIN current_payment_summary cps;
$function$;

REVOKE ALL ON FUNCTION public.get_dashboard_sales_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dashboard_sales_snapshot(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text,text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
