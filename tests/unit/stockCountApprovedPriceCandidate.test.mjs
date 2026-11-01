import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Source contract only: production activation still requires disposable-DB
// accounting/ledger integration tests and operator authorization.
const sql = readFileSync('scripts/candidates/stock_count_apply_last_price_ATOMIC_NOT_FOR_PRODUCTION_20261101.sql','utf8');

test('stock count candidate uses central existing price source', () => {
  assert.match(sql, /private\.latest_approved_raw_prices\(/);
  assert.match(sql, /v_count\.branch_id,ARRAY\[v_item\.raw_material_id\],v_count\.created_at/);
});
test('known zero prices are not filtered out', () => {
  assert.doesNotMatch(sql, /v_final_price\s*>\s*0/);
  assert.match(sql, /COALESCE\(v_final_price,v_item\.unit_cost,0\)/);
});
test('raw shortage pricing is not calculated from FIFO total_cost', () => {
  assert.match(sql, /v_value := round\(-v_variance \* COALESCE\(v_final_price, 0\), 2\)/);
  assert.match(sql, /STOCK_COUNT_LEDGER_VALUATION_MISMATCH/);
});
test('raw item failures are raised and rolled back, not early-returned', () => {
  assert.match(sql, /RAISE EXCEPTION 'STOCK_COUNT_ITEM_FAILED/);
  assert.match(sql, /EXCEPTION\s+WHEN OTHERS/);
});

test('rejects FIFO ledger and approved-price journal divergence', () => {
  assert.match(sql, /STOCK_COUNT_LEDGER_VALUATION_MISMATCH/);
  assert.match(sql, /round\(COALESCE\(\(v_res->>'total_cost'\)::numeric,0\),2\)/);
  assert.match(sql, /RAISE EXCEPTION 'STOCK_COUNT_LEDGER_VALUATION_MISMATCH/);
});
test('checks both raw and product removal success before applying', () => {
  assert.match(sql, /RAW_STOCK_COUNT_REMOVE_FAILED|STOCK_COUNT_REMOVE_FAILED/);
  assert.match(sql, /PRODUCT_STOCK_COUNT_REMOVE_FAILED/);
  assert.match(sql, /UPDATE public\.stock_counts\s+SET status = 'applied'/);
});
