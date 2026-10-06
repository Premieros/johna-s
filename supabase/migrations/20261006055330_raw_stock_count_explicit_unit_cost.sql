-- PROPOSAL ONLY: requires separate explicit Production approval.
-- Preserve the existing permission/branch checks, signature, grants and search_path.
-- Only an optional positive raw-material stock-unit cost is added to new draft items.
-- Blank cost retains warehouse avg_cost. No old counts/batches/stock/journals are rewritten.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
DO $patch$
DECLARE
  definition text;
  marker text := E'v_system_qty:=coalesce(v_system_qty,0);\n          v_unit_cost:=coalesce(v_unit_cost,0);';
  replacement text := E'v_system_qty:=coalesce(v_system_qty,0);\n          v_unit_cost:=coalesce(v_unit_cost,0);\n          -- Optional explicit price is per raw-material stock unit.\n          IF NULLIF(btrim(v_item->>''unit_cost''), '''') IS NOT NULL THEN\n            IF (v_item->>''unit_cost'')::numeric < 0.0001\n               OR (v_item->>''unit_cost'')::numeric >= 100000000\n               OR (v_item->>''unit_cost'')::numeric::text IN (''NaN'', ''Infinity'', ''-Infinity'') THEN\n              RAISE EXCEPTION ''INVALID_STOCK_UNIT_COST'';\n            END IF;\n            v_unit_cost := round((v_item->>''unit_cost'')::numeric, 4);\n          END IF;';
BEGIN
  SELECT pg_get_functiondef('public.create_stock_count(uuid,uuid,text,text,jsonb)'::regprocedure) INTO definition;
  IF (length(definition) - length(replace(definition, marker, ''))) / length(marker) <> 1 THEN
    RAISE EXCEPTION 'CREATE_STOCK_COUNT_BASELINE_CHANGED';
  END IF;
  IF position('inventory.count.create' IN definition) = 0 OR position('p_warehouse_id' IN definition) = 0 THEN
    RAISE EXCEPTION 'CREATE_STOCK_COUNT_GUARD_MISSING';
  END IF;
  EXECUTE replace(definition, marker, replacement);
END;
$patch$;
COMMIT;
