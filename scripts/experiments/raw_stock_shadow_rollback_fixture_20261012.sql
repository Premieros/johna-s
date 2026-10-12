-- ISOLATED STAGING FIXTURE for the Stage A shadow-balance candidate (#489).
-- PRECONDITION: run raw_stock_shadow_state_candidate_20261012.sql in a
-- DISPOSABLE PostgreSQL database only; never use Production as a test target.
-- Exercises the REAL sync trigger/helper against a TEMPORARY batch table.
-- Does NOT send restaurant orders, use existing batch records or touch FIFO
-- debts, receipts, journals or the live public raw_material_batches table.
-- Entire fixture uses a transaction and ends with ROLLBACK.

BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';

CREATE TEMP TABLE shadow_batch_fixture (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  raw_material_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  warehouse_id uuid,
  quantity numeric NOT NULL,
  unit_cost numeric NOT NULL
) ON COMMIT DROP;

CREATE TRIGGER trg_fixture_shadow_batch_delta
AFTER INSERT OR UPDATE OR DELETE ON shadow_batch_fixture
FOR EACH ROW EXECUTE FUNCTION private.sync_raw_stock_shadow_from_batch();

-- Material A, Branch A, Warehouse A: consume stock not yet purchased.
INSERT INTO shadow_batch_fixture(raw_material_id,branch_id,warehouse_id,quantity,unit_cost)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',-10,0);

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.raw_stock_warehouse_shadow
    WHERE raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      AND branch_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      AND warehouse_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
      AND quantity=-10 AND positive_qty=0 AND positive_value=0
  ) THEN RAISE EXCEPTION 'NEGATIVE_KITCHEN_SEND_NOT_CACHED'; END IF;
END;
$check$;

-- Purchase 15 units @ 4, then settle the previously generated debt 10 units.
-- This models ONLY quantity movement; separate FIFO debt/ledger tests must
-- prove the historical financial reconciliation logic.
INSERT INTO shadow_batch_fixture(raw_material_id,branch_id,warehouse_id,quantity,unit_cost)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',15,4);

UPDATE shadow_batch_fixture SET quantity=0 WHERE quantity=-10
  AND raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
UPDATE shadow_batch_fixture SET quantity=5 WHERE quantity=15
  AND raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.raw_stock_warehouse_shadow
    WHERE raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      AND branch_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      AND warehouse_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
      AND quantity=5 AND stock_value=20 AND positive_qty=5
      AND positive_value=20
  ) THEN RAISE EXCEPTION 'NEGATIVE_PURCHASE_SETTLEMENT_NOT_FIVE'; END IF;
END;
$check$;

-- Positive batch repricing is a valuation-only delta; no phantom quantity.
UPDATE shadow_batch_fixture SET unit_cost=6
WHERE raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  AND quantity=5;

-- Another warehouse and another branch stay isolated.
INSERT INTO shadow_batch_fixture(raw_material_id,branch_id,warehouse_id,quantity,unit_cost)
VALUES
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',7,2),
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',-3,0);

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.raw_stock_branch_shadow
    WHERE raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      AND branch_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      AND quantity=12 AND positive_qty=12 AND stock_value=44
      AND positive_value=44
  ) OR NOT EXISTS (
    SELECT 1 FROM private.raw_stock_branch_shadow
    WHERE raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      AND branch_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
      AND quantity=-3
  ) THEN RAISE EXCEPTION 'BRANCH_OR_WAREHOUSE_SCOPE_BROKEN'; END IF;
END;
$check$;

-- Move the +7 batch between warehouses, preserving branch total.
UPDATE shadow_batch_fixture
SET warehouse_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
WHERE warehouse_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid;

-- A failed call rolls back its shadow balance as well as its batch.
SAVEPOINT failed_send;
INSERT INTO shadow_batch_fixture(raw_material_id,branch_id,warehouse_id,quantity,unit_cost)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',-99,0);
ROLLBACK TO SAVEPOINT failed_send;

-- Deleting the moved batch subtracts it from branch and warehouse totals.
DELETE FROM shadow_batch_fixture WHERE quantity=7;

-- Both branch and warehouse caches must match all four exact SUMs over
-- this synthetic batch set, including quantities <0 and 0.
DO $verify$
BEGIN
  IF EXISTS (
    WITH actual AS (
      SELECT raw_material_id, branch_id,
        SUM(quantity) qty, SUM(quantity*unit_cost) val,
        SUM(GREATEST(quantity,0)) posqty,
        SUM(GREATEST(quantity,0)*unit_cost) posval
      FROM shadow_batch_fixture GROUP BY 1,2
    )
    SELECT 1 FROM actual a
    JOIN private.raw_stock_branch_shadow s USING(raw_material_id,branch_id)
    WHERE a.qty IS DISTINCT FROM s.quantity OR a.val IS DISTINCT FROM s.stock_value
      OR a.posqty IS DISTINCT FROM s.positive_qty OR a.posval IS DISTINCT FROM s.positive_value
  ) OR EXISTS (
    WITH actual AS (
      SELECT raw_material_id, branch_id,warehouse_id,
        SUM(quantity) qty, SUM(quantity*unit_cost) val,
        SUM(GREATEST(quantity,0)) posqty,
        SUM(GREATEST(quantity,0)*unit_cost) posval
      FROM shadow_batch_fixture WHERE warehouse_id IS NOT NULL GROUP BY 1,2,3
    )
    SELECT 1 FROM actual a
    JOIN private.raw_stock_warehouse_shadow s USING(raw_material_id,branch_id,warehouse_id)
    WHERE a.qty IS DISTINCT FROM s.quantity OR a.val IS DISTINCT FROM s.stock_value
      OR a.posqty IS DISTINCT FROM s.positive_qty OR a.posval IS DISTINCT FROM s.positive_value
  ) OR EXISTS (
    SELECT 1 FROM private.raw_stock_warehouse_shadow
    WHERE raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      AND branch_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      AND warehouse_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
      AND (quantity<>0 OR stock_value<>0 OR positive_qty<>0 OR positive_value<>0)
  ) THEN RAISE EXCEPTION 'RAW_SHADOW_STAGE_A_TRANSACTION_PARITY_FAILED'; END IF;
END;
$verify$;

-- PHYSICAL STOCK COUNT -10 -> +5 follows the same quantity arithmetic:
-- write a +15 stock-count adjustment and settle 10 outstanding debt.
-- Keep this explanation in the fixture; live apply_stock_count must be
-- exercised separately for full authorization / ledger / journal semantics.
SELECT 'shadow math verified; physical-count FIFO accounting requires separate integration' AS note;

ROLLBACK;
