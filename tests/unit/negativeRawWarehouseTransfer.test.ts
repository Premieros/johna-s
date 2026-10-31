import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261031205500_transfer_allow_negative_raw_fifo.sql', 'utf8');

describe('negative raw warehouse transfers use canonical FIFO debt', () => {
  it('does not block raw transfers based on availability', () => {
    expect(sql).toContain('TRANSFER_ALLOW_NEGATIVE_RAW_V1');
    expect(sql).toContain('TRANSFER_NEGATIVE_RAW_PRECHECK_DRIFT');
    expect(sql).toContain("'INSUFFICIENT_RAW_STOCK'");
    expect(sql).toContain('Actual consumption uses the canonical FIFO debt path below');
  });
  it('explicitly uses source warehouse and negative FIFO for both transfer directions', () => {
    const calls = sql.match(/v_res := public\._raw_remove_fifo\([^;]+auth\.uid\(\), true\);/g) || [];
    expect(calls).toHaveLength(2);
    expect(calls.every(call => call.includes('v_transfer.from_warehouse_id'))).toBe(true);
    expect(sql).toContain('TRANSFER_NEGATIVE_RAW_SAME_BRANCH_DRIFT');
    expect(sql).toContain('TRANSFER_NEGATIVE_RAW_CROSS_BRANCH_DRIFT');
  });
  it('preserves product stock checks, transfer approval locks and FIFO cost writers', () => {
    expect(sql).not.toMatch(/_product_inv_remove_fifo\(/);
    expect(sql).not.toMatch(/CREATE\s+(OR REPLACE\s+)?FUNCTION\s+public\._raw_remove_fifo/i);
    expect(sql).not.toContain('UPDATE public.raw_material_inventory');
    expect(sql).toContain('EXECUTE v_def');
  });
});
