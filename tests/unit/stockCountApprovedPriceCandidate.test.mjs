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

test('catalog zero fallback stays in central reader and is historically guarded', () => {
  const price = readFileSync('scripts/candidates/latest_approved_price_zero_catalog_NOT_FOR_PRODUCTION_20261101.sql','utf8');
  assert.match(price, /CREATE OR REPLACE FUNCTION private\.latest_approved_raw_prices/);
  assert.match(price, /rm\.default_cost=0/);
  assert.match(price, /rm\.updated_at<=p_as_of/);
  assert.match(price, /'catalog_zero'/);
  assert.match(price, /ELSE w\.unit_cost END/);
});
test('stock count raw issue reuses original historical timestamp', () => {
  assert.match(sql, /v_count\.count_number, auth\.uid\(\), v_count\.created_at/);
  const helper = readFileSync('scripts/db/candidates/approved_raw_cost_engine_v2_helpers_20261031.sql','utf8');
  assert.match(helper, /COALESCE\(p_valuation_as_of,v_now\)/);
  assert.match(helper, /v_price\.unit_cost<0/);
});

test('explicit zero price can be stored in the existing approved source and its projection', () => {
  const source = readFileSync('scripts/candidates/approved_zero_price_projection_NOT_FOR_PRODUCTION_20261101.sql','utf8');
  assert.match(source, /ALTER TABLE public\.raw_material_price_events/);
  assert.match(source, /CHECK \(unit_cost>=0\)/);
  assert.match(source, /private\.raw_approved_price_read_model/);
  assert.match(source, /v_cost IS NULL OR v_cost<0/);
});

test('zero-cost raw posting must have a real approved or catalog source', () => {
  assert.match(sql, /v_price_source NOT IN \('purchase','pricing','stock_count','catalog_zero'\)/);
  assert.match(sql, /v_price_source IS NULL/);
});

test('raw count receipt verifies last approved as-of price and freezes ledger provenance', () => {
  const helper = readFileSync('scripts/db/candidates/approved_raw_cost_engine_v2_helpers_20261031.sql','utf8');
  assert.match(helper, /APPROVED_RECEIPT_PRICE_MISMATCH/);
  assert.match(helper, /p_valuation_as_of timestamptz DEFAULT NULL/);
  assert.match(helper, /v_approved_price\.unit_cost IS DISTINCT FROM p_receipt_unit_cost/);
  assert.match(helper, /approved_cost_basis,approved_price_source,approved_price_at/);
  assert.match(sql, /v_count\.count_number, auth\.uid\(\), v_count\.created_at/);
});
