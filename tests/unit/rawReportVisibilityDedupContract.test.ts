import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261106173000_raw_report_visibility_dedup.sql', 'utf8');

describe('raw-material report authorization performance patch', () => {
  it('refuses to patch an unexpected production function body', () => {
    expect(migration).toContain("md5(definition) <> 'a6129db3abf743a3aa2a3ba9cf13e25e'");
    expect(migration).toContain('RAW_REPORT_VISIBILITY_PATTERN_MISSING');
  });
  it('reuses only reference-scoped financial checks, never unknown row-scoped checks', () => {
    expect(migration).toContain("'sale','refund','sale_refund','purchase','purchase_return'");
    expect(migration).toContain("'expense','customer_payment','supplier_payment'");
    expect(migration).toContain('il.reference_id IS NOT NULL');
    expect(migration).toContain("ELSE 'row:' || il.id::text");
    expect(migration).toContain('SELECT DISTINCT ON (visibility_key)');
    expect(migration).toContain('private.financial_reference_visible(');
  });
  it('preserves existing report accounting, temporal and permission logic', () => {
    expect(migration).toContain('definition := replace(definition, original, optimized)');
    expect(migration).toContain('WHERE il.branch_id=p_branch_id');
    expect(migration).toContain("AT TIME ZONE 'Africa/Cairo'");
    expect(migration).not.toMatch(/(?:DROP\s+POLICY|DISABLE\s+ROW\s+LEVEL\s+SECURITY|TRUNCATE|DELETE\s+FROM)/i);
  });
});
