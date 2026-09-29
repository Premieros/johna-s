import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = fs.readFileSync(
  'supabase/migrations/20260930004000_shift_refund_single_deduction.sql',
  'utf8',
);

describe('shift refund single-deduction contract', () => {
  it('does not deduct a refund twice when the refunded sale belongs to the same shift', () => {
    expect(migration).toContain("op.operation_type='refund'");
    expect(migration).toContain('FROM sale_ids x');
    expect(migration).toContain('WHERE x.sale_id=op.reference_id');
  });

  it('still deducts refunds for sales not included in the current shift', () => {
    expect(migration).toContain("AND NOT EXISTS (");
    expect(migration).toContain("THEN -op.amount");
  });

  it('keeps canonical settlement helper as the shift sales source', () => {
    expect(migration).toContain('private.report_sale_settlement_lines');
  });
});
