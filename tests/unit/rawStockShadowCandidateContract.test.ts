import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const candidatePath = 'scripts/experiments/raw_stock_shadow_state_candidate_20261012.sql';
const fixturePath = 'scripts/experiments/raw_stock_shadow_rollback_fixture_20261012.sql';
const candidate = readFileSync(candidatePath, 'utf8');
const fixture = readFileSync(fixturePath, 'utf8');

const sqlOnly = (source: string) =>
  source.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n');

describe('negative-first raw stock shadow design contract (#489)', () => {
  it('keeps live database mutations OUT of automatically applied migrations', () => {
    expect(candidatePath).toMatch(/^scripts\/experiments\//);
    expect(fixturePath).toMatch(/^scripts\/experiments\//);
    expect(candidate).toContain('STAGE A IS SHADOW ONLY');
    expect(candidate).toContain('BEGIN;');
    expect(candidate).toContain('COMMIT;');
    expect(candidate).toContain("SET LOCAL lock_timeout = '2s'");
    expect(candidate).toContain('LOCK TABLE public.raw_material_batches IN SHARE ROW EXCLUSIVE MODE');
    const sql = sqlOnly(candidate);
    expect(sql).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+public\./i);
    expect(sql).not.toMatch(/\b(?:DROP|ALTER)\s+(?:TABLE|FUNCTION)\s+public\./i);
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\./i);
  });

  it('retains signed stock, valuation and positive-only figures at warehouse AND branch scope', () => {
    for (const tableName of [
      'private.raw_stock_branch_shadow',
      'private.raw_stock_warehouse_shadow',
    ]) {
      expect(candidate).toContain(`CREATE TABLE ${tableName}`);
      expect(candidate).toContain(`ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`);
      expect(candidate).toContain(`REVOKE ALL ON ${tableName} FROM PUBLIC, anon, authenticated`);
    }
    expect(candidate).toContain('PRIMARY KEY (raw_material_id, branch_id)');
    expect(candidate).toContain('PRIMARY KEY (raw_material_id, branch_id, warehouse_id)');
    expect(candidate).toContain('SUM(quantity)');
    expect(candidate).toContain('SUM(quantity * COALESCE(unit_cost, 0))');
    expect(candidate).toContain('SUM(GREATEST(quantity, 0))');
    expect(candidate).toContain('SUM(GREATEST(quantity, 0) * COALESCE(unit_cost, 0))');
    expect(candidate).toContain('WHERE warehouse_id IS NOT NULL');
  });

  it('preserves transactionality and captures final BEFORE-trigger cost changes', () => {
    expect(candidate).toContain('CREATE TRIGGER trg_raw_stock_shadow_batch_delta');
    expect(candidate).toContain('AFTER INSERT OR UPDATE OR DELETE ON public.raw_material_batches');
    expect(candidate).toContain('private.sync_raw_stock_shadow_from_batch()');
    expect(candidate).toContain('CREATE FUNCTION private.apply_raw_stock_shadow_delta(');
    expect(candidate).toContain('CREATE FUNCTION private.sync_raw_stock_shadow_from_batch()');
    expect(candidate).toContain('SECURITY DEFINER');
    expect(candidate).toContain('SET search_path = pg_catalog, private');
    expect(candidate).toContain('REVOKE ALL ON FUNCTION private.sync_raw_stock_shadow_from_batch()');
    expect(candidate).toContain('REVOKE ALL ON FUNCTION private.apply_raw_stock_shadow_delta(');
    for (const action of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(candidate).toContain(`TG_OP = '${action}'`);
    }
    expect(candidate).toContain('NEW.quantity * NEW.unit_cost - OLD.quantity * OLD.unit_cost');
    expect(candidate).toContain('ON CONFLICT (raw_material_id, branch_id) DO UPDATE');
    expect(candidate).toContain('ON CONFLICT (raw_material_id, branch_id, warehouse_id) DO UPDATE');
    expect(candidate).toContain('RAW_STOCK_SHADOW_BOOTSTRAP_PARITY_FAILED');
    expect(candidate).toContain('TRG_OP'); // trigger metadata must be used for every batch event
  });

  it('refuses untracked TRUNCATE and does not replace historic costing/FIFO or POS access', () => {
    expect(candidate).toContain('BEFORE TRUNCATE ON public.raw_material_batches');
    expect(candidate).toContain('RAW_STOCK_SHADOW_TRUNCATE_REQUIRES_SEPARATE_RECONCILIATION');
    expect(sqlOnly(candidate)).not.toContain('CREATE FUNCTION public._raw_remove_fifo');
    expect(sqlOnly(candidate)).not.toContain('CREATE FUNCTION public._raw_fifo_settle_receipt');
    expect(sqlOnly(candidate)).not.toContain('CREATE OR REPLACE VIEW public.raw_material_warehouse_inventory');
    expect(sqlOnly(candidate)).not.toContain('CREATE OR REPLACE FUNCTION public._raw_last_known_fifo_cost');
    expect(sqlOnly(candidate)).not.toContain('GRANT SELECT ON private.raw_stock_warehouse_shadow');
  });

  it('keeps staging fixture rollback-only, synthetic and branch-aware', () => {
    expect(fixture).toMatch(/^BEGIN;/m);
    expect(fixture.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(fixture).toContain('CREATE TEMP TABLE shadow_batch_fixture');
    expect(fixture).toContain('AFTER INSERT OR UPDATE OR DELETE ON shadow_batch_fixture');
    expect(fixture).toContain("quantity=-10 AND positive_qty=0");
    expect(fixture).toContain('quantity=5 AND stock_value=20 AND positive_qty=5');
    expect(fixture).toContain("SET unit_cost=6");
    expect(fixture).toContain('SAVEPOINT failed_send;');
    expect(fixture).toContain('ROLLBACK TO SAVEPOINT failed_send;');
    expect(fixture).toContain('RAW_SHADOW_STAGE_A_TRANSACTION_PARITY_FAILED');
    const sql = sqlOnly(fixture);
    expect(sql).not.toMatch(/\b(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE)\s+public\./i);
    expect(sql).not.toMatch(/\bCOMMIT\s*;/i);
  });
});
