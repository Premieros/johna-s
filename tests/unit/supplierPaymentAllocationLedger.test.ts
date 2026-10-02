import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  'supabase/migrations/20261002202827_supplier_payment_allocation_ledger_20261002.sql',
  'utf8',
);

describe('supplier payment allocation ledger contract', () => {
  it('keeps historical payment rows legacy and makes future payments managed', () => {
    expect(migration).toContain("SET allocation_mode = 'legacy'");
    expect(migration).toContain("ALTER COLUMN allocation_mode SET DEFAULT 'managed'");
    expect(migration).toContain("allocation_mode IN ('legacy','managed')");
  });

  it('records immutable apply/unapply allocation events instead of rewriting payment history', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.supplier_payment_allocations');
    expect(migration).toContain("event_type IN ('apply','unapply')");
    expect(migration).toContain('reverses_allocation_id uuid');
    expect(migration).toContain('SUPPLIER_PAYMENT_ALLOCATION_IMMUTABLE');
    expect(migration).toContain('trg_supplier_payment_allocation_immutable');
  });

  it('captures the exact managed payment in transaction-local context without timestamp guessing', () => {
    expect(migration).toContain("set_config('app.current_supplier_payment_id'");
    expect(migration).toContain('trg_supplier_payment_allocation_context');
    expect(migration).toContain('trg_capture_supplier_purchase_payment_allocation');
    expect(migration).toContain('trg_capture_supplier_opening_payment_allocation');
  });

  it('releases managed allocation when a return/correction makes paid amount excessive', () => {
    expect(migration).toContain('trg_supplier_release_excess_before_purchase_change');
    expect(migration).toContain('purchase_return_release');
    expect(migration).toContain('purchase_correction_release');
    expect(migration).toContain('LEGACY_PAID_PURCHASE_REQUIRES_RECONCILIATION');
  });

  it('reuses released managed credit on the next completed credit invoice', () => {
    expect(migration).toContain('trg_supplier_auto_apply_unapplied_credit');
    expect(migration).toContain('auto_credit_to_new_invoice');
    expect(migration).toContain('_supplier_auto_apply_unapplied_credit');
  });

  it('does not expose internal mutation helpers to authenticated clients', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public._record_supplier_payment_apply(uuid,text,uuid,uuid,text,numeric,text) FROM PUBLIC, anon, authenticated',
    );
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public._supplier_unapply_purchase_amount(uuid,numeric,text) FROM PUBLIC, anon, authenticated',
    );
    expect(migration).toContain('ALTER TABLE public.supplier_payment_allocations ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain("public.can_permission('suppliers.view')");
  });

  it('leaves treasury and journal posting functions untouched', () => {
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public.pay_supplier_from_treasury');
    expect(migration).not.toContain('CREATE OR REPLACE FUNCTION public._post_journal_entry');
    expect(migration).not.toContain('UPDATE public.treasury_transactions');
    expect(migration).not.toContain('UPDATE public.journal_entries');
  });
});
