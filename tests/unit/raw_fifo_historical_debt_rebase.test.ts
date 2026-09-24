import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260925000500_raw_fifo_historical_debt_rebase.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('historical FIFO debt rebase contract', () => {
  it('snapshots debt and settlement state before rebuilding replay allocations', () => {
    expect(migration).toContain('raw_fifo_debt_rebase_snapshots');
    expect(migration).toContain('raw_fifo_debt_rebase_settlement_snapshots');
    expect(migration).toContain('public._raw_fifo_rebase_historical_debt_state(p_run_id)');
    expect(migration).toContain('DELETE FROM public.raw_fifo_settlements');
  });

  it('refuses live or partially settled debt and refuses increasing target debt', () => {
    expect(migration).toContain('FIFO_DEBT_REBASE_LIVE_DEBT_REFUSED');
    expect(migration).toContain('FIFO_DEBT_REBASE_CURRENT_NOT_FULLY_SETTLED');
    expect(migration).toContain('FIFO_DEBT_REBASE_TARGET_UNSAFE');
    expect(migration).toContain('v_row.target_debt-v_debt.debt_quantity>0.000001');
  });

  it('rebuilds before debt materialization and restores during reversal', () => {
    const rebase = migration.indexOf('v_res:=public._raw_fifo_rebase_historical_debt_state(p_run_id)');
    const materialize = migration.indexOf('-- Materialize historical debt identity and settlement audit first.');
    const restore = migration.indexOf('v_res:=public._raw_fifo_restore_rebased_debt_state(p_run_id)');
    const cleanup = migration.indexOf('-- Remove zeroed reconciliation journal shells produced solely by this run.');
    expect(rebase).toBeGreaterThan(0);
    expect(materialize).toBeGreaterThan(rebase);
    expect(restore).toBeGreaterThan(0);
    expect(cleanup).toBeGreaterThan(restore);
  });

  it('does not change physical stock quantity in the rebase helpers', () => {
    const helperStart = migration.indexOf('CREATE OR REPLACE FUNCTION public._raw_fifo_rebase_historical_debt_state');
    const applyStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.raw_fifo_apply_backfill');
    const helpers = migration.slice(helperStart, applyStart);
    expect(helpers).not.toMatch(/raw_material_batches[\s\S]*SET\s+quantity/i);
    expect(helpers).not.toMatch(/inventory_ledger[\s\S]*SET\s+quantity/i);
  });

  it('keeps internal state tables inaccessible to normal app roles', () => {
    expect(migration).toContain('FROM PUBLIC,anon,authenticated');
    expect(migration).toContain('TO service_role,postgres');
  });
});
