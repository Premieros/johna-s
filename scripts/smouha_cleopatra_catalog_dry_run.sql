-- SMOUHA -> CLEOPATRA CATALOG COPY — READ-ONLY DRY RUN
-- Date: 2026-09-19
-- Source branch: Smouha
-- Destination branch: Cleopatra
-- IMPORTANT:
--   * SELECT-only diagnostics.
--   * Do NOT convert this file into a migration.
--   * Do NOT copy source kitchen_station_id values across branches.
--   * Do NOT copy stock, batches, purchases, sales, movements, shifts, or financial history.

BEGIN TRANSACTION READ ONLY;

-- Fixed production branch identities confirmed by read-only inspection.
WITH ids AS (
  SELECT
    '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid AS src,
    '279e6662-e901-40b2-9170-7dda0b471ba7'::uuid AS dst
)
SELECT
  (SELECT name FROM branches WHERE id = ids.src) AS source_branch,
  (SELECT name FROM branches WHERE id = ids.dst) AS destination_branch
FROM ids;

-- Catalog counts.
WITH ids AS (
  SELECT
    '19c3fd23-d784-455b-8840-f4f2ac619651'::uuid AS src,
    '279e6662-e901-40b2-9170-7dda0b471ba7'::uuid AS dst
)
SELECT 'categories' AS entity,
       (SELECT count(*) FROM categories c WHERE c.branch_id=ids.src) AS smouha,
       (SELECT count(*) FROM categories c WHERE c.branch_id=ids.dst) AS cleopatra
FROM ids
UNION ALL
SELECT 'raw_materials',
       (SELECT count(*) FROM raw_materials r WHERE r.branch_id=ids.src),
       (SELECT count(*) FROM raw_materials r WHERE r.branch_id=ids.dst)
FROM ids
UNION ALL
SELECT 'products',
       (SELECT count(*) FROM products p WHERE p.branch_id=ids.src),
       (SELECT count(*) FROM products p WHERE p.branch_id=ids.dst)
FROM ids
UNION ALL
SELECT 'recipes',
       (SELECT count(*) FROM recipes r WHERE r.branch_id=ids.src),
       (SELECT count(*) FROM recipes r WHERE r.branch_id=ids.dst)
FROM ids
UNION ALL
SELECT 'recipe_items',
       (SELECT count(*) FROM recipe_items ri JOIN recipes r ON r.id=ri.recipe_id WHERE r.branch_id=ids.src),
       (SELECT count(*) FROM recipe_items ri JOIN recipes r ON r.id=ri.recipe_id WHERE r.branch_id=ids.dst)
FROM ids
UNION ALL
SELECT 'inventory_units_manufactured',
       (SELECT count(*) FROM inventory_units u WHERE u.branch_id=ids.src AND u.unit_type='manufactured'),
       (SELECT count(*) FROM inventory_units u WHERE u.branch_id=ids.dst AND u.unit_type='manufactured')
FROM ids
UNION ALL
SELECT 'inventory_unit_recipes',
       (SELECT count(*) FROM inventory_unit_recipes x JOIN inventory_units u ON u.id=x.unit_id WHERE u.branch_id=ids.src),
       (SELECT count(*) FROM inventory_unit_recipes x JOIN inventory_units u ON u.id=x.unit_id WHERE u.branch_id=ids.dst)
FROM ids
UNION ALL
SELECT 'inventory_unit_recipe_units',
       (SELECT count(*) FROM inventory_unit_recipe_units x JOIN inventory_units u ON u.id=x.unit_id WHERE u.branch_id=ids.src),
       (SELECT count(*) FROM inventory_unit_recipe_units x JOIN inventory_units u ON u.id=x.unit_id WHERE u.branch_id=ids.dst)
FROM ids
UNION ALL
SELECT 'product_unit_links',
       (SELECT count(*) FROM product_unit_links x JOIN products p ON p.id=x.product_id WHERE p.branch_id=ids.src),
       (SELECT count(*) FROM product_unit_links x JOIN products p ON p.id=x.product_id WHERE p.branch_id=ids.dst)
FROM ids;

-- Required modifier dependencies attached to copied products.
SELECT
  (SELECT count(*) FROM product_modifier_groups WHERE branch_id='19c3fd23-d784-455b-8840-f4f2ac619651') AS modifier_groups,
  (SELECT count(*) FROM product_modifier_options WHERE branch_id='19c3fd23-d784-455b-8840-f4f2ac619651') AS modifier_options,
  (SELECT count(*) FROM product_modifier_group_products WHERE branch_id='19c3fd23-d784-455b-8840-f4f2ac619651') AS modifier_product_links,
  (SELECT count(*) FROM product_modifier_inventory_effects WHERE branch_id='19c3fd23-d784-455b-8840-f4f2ac619651') AS modifier_inventory_effects;

-- Global code uniqueness means source codes cannot be reused verbatim.
-- Proposed destination code rule: CLP-<source_code>.
SELECT
  (SELECT count(*)
   FROM raw_materials d
   JOIN raw_materials s ON d.code='CLP-'||s.code
   WHERE s.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651') AS raw_material_code_collisions,
  (SELECT count(*)
   FROM inventory_units d
   JOIN inventory_units s ON d.code='CLP-'||s.code
   WHERE s.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651') AS inventory_unit_code_collisions;

-- Source integrity checks. All should be zero.
SELECT
  (SELECT count(*) FROM products p JOIN categories c ON c.id=p.category_id
    WHERE p.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651' AND c.branch_id<>p.branch_id) AS product_category_cross_branch,
  (SELECT count(*) FROM recipes r JOIN products p ON p.id=r.product_id
    WHERE r.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651' AND p.branch_id<>r.branch_id) AS recipe_product_cross_branch,
  (SELECT count(*) FROM recipe_items ri JOIN recipes r ON r.id=ri.recipe_id JOIN raw_materials rm ON rm.id=ri.raw_material_id
    WHERE r.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651' AND rm.branch_id<>r.branch_id) AS recipe_raw_cross_branch,
  (SELECT count(*) FROM inventory_unit_recipes x JOIN inventory_units u ON u.id=x.unit_id JOIN raw_materials rm ON rm.id=x.raw_material_id
    WHERE u.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651' AND rm.branch_id<>u.branch_id) AS manufactured_raw_cross_branch,
  (SELECT count(*) FROM inventory_unit_recipe_units x JOIN inventory_units u ON u.id=x.unit_id JOIN inventory_units cu ON cu.id=x.component_unit_id
    WHERE u.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651' AND coalesce(cu.branch_id,u.branch_id)<>u.branch_id) AS manufactured_unit_cross_branch;

-- One known source item has no category; it must remain explicitly uncategorized
-- unless separately approved for data correction.
SELECT id, name, name_en
FROM products
WHERE branch_id='19c3fd23-d784-455b-8840-f4f2ac619651'
  AND category_id IS NULL;

-- Destination station compatibility by code.
-- This is diagnostic only: it does NOT change printer stations or routing.
SELECT
  s.code AS source_station_code,
  s.name_ar AS source_station_name,
  d.id AS destination_station_id,
  d.name_ar AS destination_station_name,
  d.is_active AS destination_station_active
FROM kitchen_stations s
JOIN kitchen_stations d
  ON d.code=s.code
 AND d.branch_id='279e6662-e901-40b2-9170-7dda0b471ba7'
WHERE s.branch_id='19c3fd23-d784-455b-8840-f4f2ac619651'
ORDER BY s.code;

ROLLBACK;
