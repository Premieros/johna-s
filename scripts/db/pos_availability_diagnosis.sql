-- POS availability diagnosis.
--
-- Reproduces the exact availability the POS sees for every active product of
-- every branch, using the same default-warehouse resolution and the same
-- get_pos_product_availability RPC the client calls, and classifies each row:
--
--   AVAILABLE                    sellable (is_available = true)
--   RAW_SHORTAGE_ONLY            raw shortage; POS keeps it sellable (by design)
--   INSUFFICIENT_UNIT_STOCK      manufactured-unit shortage (strict)
--   INSUFFICIENT_PRODUCT_STOCK   finished-good shortage (strict)
--   * (any other code)           configuration/recipe error (blocked as unknown)
--
-- Products that the RPC omits (unknown availability source) are classified
-- through check_product_availability directly so their exact configuration
-- error is visible instead of hidden.
--
-- Run as the postgres/service-role owner so the SECURITY DEFINER bodies run
-- without a browser session:
--
--   psql "$SUPABASE_DB_URL" -f scripts/db/pos_availability_diagnosis.sql
--
-- Read-only: no writes, no locks beyond the ones the availability functions
-- already take.

\echo '================================================================'
\echo ' POS availability diagnosis'
\echo '================================================================'
\echo ' '
\echo '(1/5) Branches, resolved default warehouses and active-product counts'
WITH default_wh AS (
  SELECT DISTINCT ON (w.branch_id)
    w.branch_id, w.id AS warehouse_id
  FROM public.warehouses w
  WHERE w.is_active = true
  ORDER BY w.branch_id, w.is_default DESC, w.created_at ASC, w.id ASC
)
SELECT b.id AS branch_id,
       b.name AS branch_name,
       dw.warehouse_id,
       (SELECT name FROM public.warehouses w WHERE w.id = dw.warehouse_id) AS warehouse_name,
       (SELECT count(*) FROM public.products p WHERE p.branch_id = b.id AND p.is_active = true) AS active_products
FROM public.branches b
JOIN default_wh dw ON dw.branch_id = b.id
ORDER BY b.name;

\echo ' '
\echo '(2/5) Summary per branch (POS view)'
WITH default_wh AS (
  SELECT DISTINCT ON (w.branch_id)
    w.branch_id, w.id AS warehouse_id
  FROM public.warehouses w
  WHERE w.is_active = true
  ORDER BY w.branch_id, w.is_default DESC, w.created_at ASC, w.id ASC
),
pos_rows AS (
  SELECT b.id AS branch_id, dw.warehouse_id,
         r.product_id, r.available_quantity, r.is_available, r.raw_shortage_only
  FROM public.branches b
  JOIN default_wh dw ON dw.branch_id = b.id
  CROSS JOIN LATERAL public.get_pos_product_availability(b.id, dw.warehouse_id, 100000) r
),
per_branch AS (
  SELECT branch_id, warehouse_id,
         COUNT(*) FILTER (WHERE is_available)                                              AS available,
         COUNT(*) FILTER (WHERE NOT is_available AND raw_shortage_only)                    AS raw_shortage_only,
         COUNT(*) FILTER (WHERE NOT is_available AND NOT raw_shortage_only)                AS hard_unavailable
  FROM pos_rows
  GROUP BY branch_id, warehouse_id
)
SELECT b.name AS branch_name,
       pb.available,
       pb.raw_shortage_only,
       pb.hard_unavailable,
       pb.hard_unavailable + pb.raw_shortage_only AS blocked_total
FROM per_branch pb
JOIN public.branches b ON b.id = pb.branch_id
ORDER BY b.name;

\echo ' '
\echo '(3/5) Itemized classification (names + causes)'
WITH default_wh AS (
  SELECT DISTINCT ON (w.branch_id)
    w.branch_id, w.id AS warehouse_id
  FROM public.warehouses w
  WHERE w.is_active = true
  ORDER BY w.branch_id, w.is_default DESC, w.created_at ASC, w.id ASC
),
pos_rows AS (
  SELECT b.id AS branch_id, dw.warehouse_id,
         r.product_id, r.available_quantity, r.is_available, r.raw_shortage_only
  FROM public.branches b
  JOIN default_wh dw ON dw.branch_id = b.id
  CROSS JOIN LATERAL public.get_pos_product_availability(b.id, dw.warehouse_id, 100000) r
),
items AS (
  SELECT b.id AS branch_id, b.name AS branch_name,
         p.id AS product_id, p.name AS product_name,
         COALESCE(rp.available_quantity, 0) AS available_quantity,
         CASE
           WHEN rp.product_id IS NULL THEN
             COALESCE((public.check_product_availability(p.id, b.id, dw.warehouse_id, 1))->>'error', 'UNKNOWN_AVAILABILITY_SOURCE')
           WHEN rp.is_available THEN 'AVAILABLE'
           WHEN rp.raw_shortage_only THEN 'RAW_SHORTAGE_ONLY'
           ELSE COALESCE((public.check_product_availability(p.id, b.id, dw.warehouse_id, 1))->>'error', 'UNKNOWN_AVAILABILITY_SOURCE')
         END AS classification
  FROM public.products p
  JOIN public.branches b ON b.id = p.branch_id
  JOIN default_wh dw ON dw.branch_id = b.id
  LEFT JOIN pos_rows rp ON rp.product_id = p.id AND rp.branch_id = b.id
  WHERE p.is_active = true
)
SELECT branch_name, product_name, classification, available_quantity
FROM items
ORDER BY branch_name, classification, product_name;

\echo ' '
\echo '(4/5) Configuration / recipe errors that need fixing (never auto-sellable)'
WITH default_wh AS (
  SELECT DISTINCT ON (w.branch_id)
    w.branch_id, w.id AS warehouse_id
  FROM public.warehouses w
  WHERE w.is_active = true
  ORDER BY w.branch_id, w.is_default DESC, w.created_at ASC, w.id ASC
),
pos_rows AS (
  SELECT b.id AS branch_id, dw.warehouse_id,
         r.product_id, r.is_available, r.raw_shortage_only
  FROM public.branches b
  JOIN default_wh dw ON dw.branch_id = b.id
  CROSS JOIN LATERAL public.get_pos_product_availability(b.id, dw.warehouse_id, 100000) r
),
items AS (
  SELECT b.id AS branch_id, b.name AS branch_name,
         p.id AS product_id, p.name AS product_name,
         CASE
           WHEN rp.product_id IS NULL THEN
             COALESCE((public.check_product_availability(p.id, b.id, dw.warehouse_id, 1))->>'error', 'UNKNOWN_AVAILABILITY_SOURCE')
           WHEN rp.is_available THEN 'AVAILABLE'
           WHEN rp.raw_shortage_only THEN 'RAW_SHORTAGE_ONLY'
           ELSE COALESCE((public.check_product_availability(p.id, b.id, dw.warehouse_id, 1))->>'error', 'UNKNOWN_AVAILABILITY_SOURCE')
         END AS classification
  FROM public.products p
  JOIN public.branches b ON b.id = p.branch_id
  JOIN default_wh dw ON dw.branch_id = b.id
  LEFT JOIN pos_rows rp ON rp.product_id = p.id AND rp.branch_id = b.id
  WHERE p.is_active = true
)
SELECT branch_name, product_name, classification
FROM items
WHERE classification NOT IN (
  'AVAILABLE',
  'RAW_SHORTAGE_ONLY',
  'INSUFFICIENT_UNIT_STOCK',
  'INSUFFICIENT_PRODUCT_STOCK',
  'INSUFFICIENT_RAW_MATERIAL_STOCK'
)
ORDER BY branch_name, product_name;

\echo ' '
\echo '(5/5) Inactive products (excluded from POS by design)'
SELECT b.name AS branch_name, p.name AS product_name
FROM public.products p
JOIN public.branches b ON b.id = p.branch_id
WHERE p.is_active = false
ORDER BY b.name, p.name;

\echo ' '
\echo 'Done. Counts:'
\echo '  AVAILABLE              -> sellable'
\echo '  RAW_SHORTAGE_ONLY      -> sellable by negative-inventory policy (kept addable)'
\echo '  INSUFFICIENT_UNIT_*    -> manufactured-unit shortage (strict, stays blocked)'
\echo '  INSUFFICIENT_PRODUCT_* -> finished-good shortage (strict, stays blocked)'
\echo '  any other code         -> configuration/recipe error (blocked as unknown)'
