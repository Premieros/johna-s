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
test('missing raw prices fail closed; explicitly approved zero is allowed', () => {
  assert.match(sql, /v_final_price IS NULL OR v_final_price < 0/);
  assert.match(sql, /APPROVED_RAW_PRICE_UNAVAILABLE/);
  assert.doesNotMatch(sql, /v_final_price := COALESCE\(v_final_price,v_item\.unit_cost,0\)/);
});
test('raw count movements use v2 approved-price writers, never FIFO helpers', () => {
  assert.match(sql, /private\.raw_issue_approved_v2\(/);
  assert.match(sql, /private\.raw_receive_approved_v2\(/);
  assert.doesNotMatch(sql, /public\._raw_remove_fifo\(/);
  assert.doesNotMatch(sql, /public\._raw_add\(/);
  assert.doesNotMatch(sql, /'revaluation','stock_count'/);
});
test('raw movement amount must match approved price and raised errors roll back', () => {
  assert.match(sql, /STOCK_COUNT_APPROVED_MOVEMENT_MISMATCH/);
  assert.match(sql, /RAISE EXCEPTION 'STOCK_COUNT_ITEM_FAILED/);
  assert.match(sql, /EXCEPTION\s+WHEN OTHERS/);
});
test('checks both raw and product removal success before applying', () => {
  assert.match(sql, /RAW_STOCK_COUNT_REMOVE_FAILED|STOCK_COUNT_REMOVE_FAILED/);
  assert.match(sql, /PRODUCT_STOCK_COUNT_REMOVE_FAILED/);
  assert.match(sql, /UPDATE public\.stock_counts\s+SET status = 'applied'/);
});

test('movement verifies quantity removed', () => {
  assert.match(sql, /\(v_res->>'removed'\)::numeric/);
});

test('resolved approved price is frozen on posted stock count line', () => {
  assert.match(sql, /UPDATE public\.stock_count_items\s+SET unit_cost = v_final_price/);
  assert.match(sql, /v_item\.unit_cost IS DISTINCT FROM v_final_price/);
});
