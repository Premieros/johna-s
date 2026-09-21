import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260921180000_raw_fifo_negative_cost_reconciliation.sql',
  'utf8',
).replace(/\r\n/g, '\n');

describe('raw FIFO negative-cost reconciliation contract', () => {
  it('records explicit FIFO debt and settlement audit tables', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.raw_fifo_debts');
    expect(migration).toContain('source_ledger_id bigint NOT NULL UNIQUE');
    expect(migration).toContain('debt_quantity numeric(18,6)');
    expect(migration).toContain('settled_quantity numeric(18,6)');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.raw_fifo_settlements');
    expect(migration).toContain('UNIQUE(debt_id, receipt_ledger_id)');
  });

  it('keeps the negative-stock behavior but links every oversold row to a FIFO debt', () => {
    expect(migration).toContain('p_allow_negative boolean DEFAULT false');
    expect(migration).toContain("v_debt_batch:='OV-'||substr(replace(gen_random_uuid()::text,'-',''),1,12)");
    expect(migration).toContain('RETURNING id,created_at INTO v_oversold_ledger_id,v_oversold_created_at');
    expect(migration).toContain('INSERT INTO public.raw_fifo_debts');
    expect(migration).toContain("'fifo_debt_ledger_id',v_oversold_ledger_id");
  });

  it('settles oldest debt first from the actual incoming FIFO receipt cost', () => {
    expect(migration).toContain('ORDER BY d.source_created_at,d.source_ledger_id');
    expect(migration).toContain('v_take*COALESCE(v_receipt.unit_cost,0)');
    expect(migration).toContain('SET settled_quantity=settled_quantity+v_take');
    expect(migration).toContain('SET quantity=LEAST(quantity+v_take,0)');
    expect(migration).toContain('SET quantity=GREATEST(quantity-v_take,0)');
  });

  it('does not replay stock quantities when correcting valuation', () => {
    expect(migration).toContain('SET total_cost=total_cost-v_delta');
    expect(migration).toContain("'raw_material',");
    expect(migration).not.toContain('DELETE FROM public.inventory_ledger');
    expect(migration).not.toContain('DELETE FROM public.sales');
  });

  it('propagates FIFO valuation through sale, kitchen-send and production paths', () => {
    expect(migration).toContain("IF p_reference_type='sale' THEN");
    expect(migration).toContain("ELSIF p_reference_type='kitchen_send' THEN");
    expect(migration).toContain("ELSIF p_reference_type='production' THEN");
    expect(migration).toContain('public._fifo_adjust_kitchen_effect_delta');
    expect(migration).toContain('public._fifo_adjust_production_delta');
  });

  it('propagates production cost changes into the produced unit and its consumers', () => {
    expect(migration).toContain('v_delta_per_unit:=p_delta/v_prod.quantity');
    expect(migration).toContain('SET total_cost=GREATEST(total_cost+p_delta,0)');
    expect(migration).toContain('SET unit_cost=GREATEST(unit_cost+v_delta_per_unit,0)');
    expect(migration).toContain("'inventory_unit',");
  });

  it('posts an auditable separate accounting correction instead of rewriting the original sale journal', () => {
    expect(migration).toContain("'fifo_cogs_reconcile'");
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.raw_fifo_sale_cogs_adjustments');
    expect(migration).toContain("semantic_key='cogs'");
    expect(migration).toContain("semantic_key='inventory_fg'");
    expect(migration).toContain('exact_delta');
    expect(migration).toContain('posted_delta');
  });

  it('makes costing reports prefer accounting COGS including FIFO reconciliation', () => {
    expect(migration).toContain("je.reference_type IN ('sale','fifo_cogs_reconcile')");
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_costing_sales_summary');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_order_margin');
  });

  it('keeps the new internal tables and helpers outside the authenticated Data API surface', () => {
    expect(migration).toContain('ALTER TABLE public.raw_fifo_debts ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON public.raw_fifo_debts FROM PUBLIC, anon, authenticated');
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public._raw_fifo_settle_receipt(bigint,uuid,uuid)\n  FROM PUBLIC, anon, authenticated;',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public._raw_fifo_settle_receipt(bigint,uuid,uuid)\n  TO service_role, postgres;',
    );
  });
});
