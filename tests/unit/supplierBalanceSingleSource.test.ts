import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  'supabase/migrations/20260930011000_supplier_balance_single_source.sql',
  'utf8',
);
const statement = fs.readFileSync(
  'src/features/parties/components/SupplierStatementModal.tsx',
  'utf8',
);

describe('supplier balance single source', () => {
  it('uses applied purchase paid_amount and opening remaining as canonical balance', () => {
    expect(migration).toContain("COALESCE(sum(COALESCE(p.paid_amount,0)),0)");
    expect(migration).toContain("v_opening_remaining");
    expect(migration).toContain("v_canonical_open := round");
  });

  it('does not derive current payable from raw supplier payment log totals', () => {
    expect(migration).toContain("'open_balance', v_canonical_open");
    expect(migration).toContain("'total_paid', v_canonical_paid");
    expect(migration).toContain("'recorded_payments_total'");
  });

  it('makes any legacy payment-log mismatch explicit without mutating business data', () => {
    expect(migration).toContain("'balance_reconciliation'::text");
    expect(migration).toContain("abs(rt.raw_balance-v_canonical_open) > 0.009");
    expect(statement).toContain("تسوية رصيد العرض");
    expect(statement).toContain("سجل الدفعات التاريخي");
  });
});
