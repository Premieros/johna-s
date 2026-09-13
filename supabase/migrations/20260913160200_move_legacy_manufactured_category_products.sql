-- Move legacy rows that were modeled as sellable products under the Arabic
-- category "تصنيعات" into the existing manufactured inventory-unit model.
--
-- Safety:
-- - additive first: create the manufactured item and copy its composition
-- - never delete the legacy product or its recipe/history
-- - abort if a candidate is currently on an open/held order
-- - abort if a candidate is used as a legacy product_component because that
--   relationship needs an explicit business mapping rather than guessing
-- - deterministic codes make the data move idempotent if retried in staging
--
-- Production execution is gated by Full Verify + explicit approval.

DO $migration$
DECLARE
  v_open_count integer;
  v_component_count integer;
BEGIN
  SELECT COUNT(*)
  INTO v_open_count
  FROM public.products p
  JOIN public.categories c ON c.id = p.category_id
  JOIN public.order_items oi ON oi.product_id = p.id
  JOIN public.orders o ON o.id = oi.order_id
  WHERE p.is_active = true
    AND p.product_type = 'manufactured'
    AND lower(btrim(c.name)) = lower('تصنيعات')
    AND o.status IN ('open', 'held');

  IF v_open_count > 0 THEN
    RAISE EXCEPTION 'LEGACY_MANUFACTURED_PRODUCTS_HAVE_OPEN_ORDERS';
  END IF;

  SELECT COUNT(*)
  INTO v_component_count
  FROM public.products p
  JOIN public.categories c ON c.id = p.category_id
  JOIN public.product_components pc ON pc.component_product_id = p.id
  WHERE p.is_active = true
    AND p.product_type = 'manufactured'
    AND lower(btrim(c.name)) = lower('تصنيعات');

  IF v_component_count > 0 THEN
    RAISE EXCEPTION 'LEGACY_MANUFACTURED_PRODUCTS_USED_AS_PRODUCT_COMPONENTS';
  END IF;
END
$migration$;

CREATE TEMP TABLE _legacy_manufactured_product_map (
  product_id uuid PRIMARY KEY,
  unit_id uuid NOT NULL,
  branch_id uuid NOT NULL
) ON COMMIT DROP;

-- Create one manufactured inventory unit per candidate. The deterministic code
-- is internal migration metadata and avoids name-based matching.
INSERT INTO public.inventory_units (
  code,
  name,
  name_en,
  unit_type,
  category_id,
  branch_id,
  cost_price,
  sale_price,
  min_stock,
  max_stock,
  reorder_point,
  low_stock_threshold,
  barcode,
  sku,
  description,
  image_url,
  is_active
)
SELECT
  'MFG-PRODUCT-' || replace(p.id::text, '-', ''),
  p.name,
  p.name_en,
  'manufactured',
  NULL,
  p.branch_id,
  p.cost_price,
  p.sale_price,
  p.min_stock,
  p.max_stock,
  p.reorder_point,
  p.low_stock_threshold,
  p.barcode,
  p.sku,
  p.description,
  p.image_url,
  true
FROM public.products p
JOIN public.categories c ON c.id = p.category_id
WHERE p.is_active = true
  AND p.product_type = 'manufactured'
  AND lower(btrim(c.name)) = lower('تصنيعات')
  AND NOT EXISTS (
    SELECT 1
    FROM public.inventory_units iu
    WHERE iu.code = 'MFG-PRODUCT-' || replace(p.id::text, '-', '')
  );

INSERT INTO _legacy_manufactured_product_map(product_id, unit_id, branch_id)
SELECT
  p.id,
  iu.id,
  p.branch_id
FROM public.products p
JOIN public.categories c ON c.id = p.category_id
JOIN public.inventory_units iu
  ON iu.code = 'MFG-PRODUCT-' || replace(p.id::text, '-', '')
WHERE p.is_active = true
  AND p.product_type = 'manufactured'
  AND lower(btrim(c.name)) = lower('تصنيعات')
  AND iu.branch_id = p.branch_id
  AND iu.unit_type = 'manufactured';

-- Copy the latest active product recipe into the manufactured item's raw recipe.
-- Product recipe quantities are yield-based; inventory-unit recipe quantities
-- are per one produced unit, hence division by yield_quantity.
WITH latest_recipe AS (
  SELECT DISTINCT ON (r.product_id)
    r.id,
    r.product_id,
    NULLIF(r.yield_quantity, 0) AS yield_quantity
  FROM public.recipes r
  JOIN _legacy_manufactured_product_map m ON m.product_id = r.product_id
  WHERE r.is_active = true
  ORDER BY r.product_id, r.version DESC, r.created_at DESC
), normalized_items AS (
  SELECT
    m.unit_id,
    ri.raw_material_id,
    SUM(ri.quantity / COALESCE(lr.yield_quantity, 1)) AS quantity,
    MAX(COALESCE(ri.wastage_percent, 0)) AS wastage_percent
  FROM latest_recipe lr
  JOIN _legacy_manufactured_product_map m ON m.product_id = lr.product_id
  JOIN public.recipe_items ri ON ri.recipe_id = lr.id
  GROUP BY m.unit_id, ri.raw_material_id
)
INSERT INTO public.inventory_unit_recipes (
  unit_id,
  raw_material_id,
  quantity,
  wastage_percent
)
SELECT unit_id, raw_material_id, quantity, wastage_percent
FROM normalized_items
ON CONFLICT (unit_id, raw_material_id)
DO UPDATE SET
  quantity = EXCLUDED.quantity,
  wastage_percent = EXCLUDED.wastage_percent;

-- Preserve nested manufactured-item requirements that were previously stored
-- in product_unit_links.
INSERT INTO public.inventory_unit_recipe_units (
  unit_id,
  component_unit_id,
  quantity,
  wastage_percent
)
SELECT
  m.unit_id,
  pul.unit_id,
  pul.quantity,
  0
FROM _legacy_manufactured_product_map m
JOIN public.product_unit_links pul ON pul.product_id = m.product_id
ON CONFLICT (unit_id, component_unit_id)
DO UPDATE SET
  quantity = EXCLUDED.quantity,
  wastage_percent = EXCLUDED.wastage_percent,
  updated_at = now();

-- Archive, never delete, the legacy product rows. Keeping IDs and recipe rows
-- preserves any external/historical references while removing them from the
-- active Product/POS catalog.
UPDATE public.products p
SET is_active = false,
    updated_at = now()
FROM _legacy_manufactured_product_map m
WHERE p.id = m.product_id;

-- Contract assertion: every migrated product must now have one active
-- manufactured inventory unit and must no longer be active as a product.
DO $assert$
DECLARE
  v_bad integer;
BEGIN
  SELECT COUNT(*) INTO v_bad
  FROM _legacy_manufactured_product_map m
  LEFT JOIN public.inventory_units iu ON iu.id = m.unit_id
  LEFT JOIN public.products p ON p.id = m.product_id
  WHERE iu.id IS NULL
     OR iu.is_active IS DISTINCT FROM true
     OR iu.unit_type <> 'manufactured'
     OR iu.branch_id <> m.branch_id
     OR p.is_active IS DISTINCT FROM false;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'LEGACY_MANUFACTURED_PRODUCT_MIGRATION_INCOMPLETE';
  END IF;
END
$assert$;
