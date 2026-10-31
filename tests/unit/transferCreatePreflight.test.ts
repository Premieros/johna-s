import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('transfer creation source stock gate candidate', () => {
  const sql = readFileSync('scripts/db/candidates/transfer_create_stock_preflight_20261031.sql', 'utf8');
  it('rejects absent or short stock before creating a transfer header', () => {
    expect(sql.indexOf('INSUFFICIENT_RAW_STOCK')).toBeLessThan(sql.indexOf("v_number := (public.next_document_number"));
    expect(sql).toContain('SUM((i->>\'quantity\')::numeric)');
    expect(sql).toContain('CREATE_TRANSFER_SOURCE_DRIFT');
  });
  it('does not alter existing FIFO or stock transaction writers', () => {
    expect(sql).not.toContain('UPDATE public.raw_material_inventory');
    expect(sql).not.toContain('_raw_remove_fifo(');
  });
});
