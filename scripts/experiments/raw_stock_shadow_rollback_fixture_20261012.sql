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
  -- One warehouse cache per key; branch remains the existing official table.
  IF NOT EXISTS (
    SELECT 1 FROM private.raw_stock_warehouse_shadow
    WHERE raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      AND branch_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      AND warehouse_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
      AND quantity=5 AND positive_qty=5 AND stock_value=30
  ) OR NOT EXISTS (
    SELECT 1 FROM private.raw_stock_warehouse_shadow
    WHERE raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      AND branch_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      AND warehouse_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid
      AND quantity=7 AND positive_qty=7 AND stock_value=14
  ) OR NOT EXISTS (
    SELECT 1 FROM private.raw_stock_warehouse_shadow
    WHERE raw_material_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      AND branch_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid
      AND warehouse_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
      AND quantity=-3 AND positive_qty=0 AND stock_value=0
  ) THEN RAISE EXCEPTION 'BRANCH_OR_WAREHOUSE_SCOPE_BROKEN'; END IF;
END;
$check$;

-- Move the +7 batch between warehouses, preserving branch total.
UPDATE shadow_batch_fixture
SET warehouse_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
WHERE warehouse_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid;

-- Independent physical-count model: balance -10, counted +5, so the
-- adjustment amount is 15 (NOT 5). This tests the balance math only.
-- The actual apply_stock_count RPC and financial journals must separately
-- pass integration tests against a disposable full-schema database.
INSERT INTO shadow_batch_fixture(raw_material_id,branch_id,warehouse_id,quantity,unit_cost)
VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',-10,0);
INSERT INTO shadow_batch_fixture(raw_material_id,branch_id,warehouse_id,quantity,unit_cost)
VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',15,8);
UPDATE shadow_batch_fixture SET quantity=0
WHERE quantity=-10 AND raw_material_id='ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid;
UPDATE shadow_batch_fixture SET quantity=5
WHERE quantity=15 AND raw_material_id='ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid;
DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM private.raw_stock_warehouse_shadow
    WHERE raw_material_id='ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
      AND branch_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      AND warehouse_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid
      AND quantity=5 AND positive_qty=5 AND stock_value=40
      AND positive_value=40
  ) THEN RAISE EXCEPTION 'NEGATIVE_COUNT_ADJUSTMENT_NOT_FIVE'; END IF;
END;
$check$;

-- A failed call rolls back its shadow balance as well as its batch.
SAVEPOINT failed_send;
INSERT INTO shadow_batch_fixture(raw_material_id,branch_id,warehouse_id,quantity,unit_cost)
VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',-99,0);
ROLLBACK TO SAVEPOINT failed_send;

-- Deleting the moved batch subtracts it from the warehouse total.
DELETE FROM shadow_batch_fixture WHERE quantity=7;

-- One warehouse cache must match all four exact SUMs, including negatives.
-- The existing branch inventory stays the only authoritative branch cache.
DO $verify$
BEGIN
  IF EXISTS (
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

-- Both modeled purchase and physical-count paths must be audited against
-- real FIFO debt and journal semantics in a dedicated full-schema test.
SELECT 'shadow quantity math checked; live FIFO accounting untested' AS note;

ROLLBACK;
