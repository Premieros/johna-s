import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261011083000_kitchen_fifo_print_lookup_indexes.sql', 'utf8');
const resolver = readFileSync('src/features/pos/services/payment.ts', 'utf8');
const functionCode = resolver.split('export async function fetchBranchWarehouseId(')[1] || '';

describe('post-#482 kitchen pending performance and warehouse safeguards', () => {
  it('gives the receipt open-check prefix lookup a branch-scoped text-pattern index', () => {
    expect(sql).toContain('idx_cloud_print_receipt_open_check_lookup');
    expect(sql).toContain('ON public.cloud_print_jobs (branch_id, idempotency_key text_pattern_ops)');
    expect(sql).toContain("WHERE kind = 'receipt'");
    // Never replace or weaken the existing unique (branch_id, idempotency_key) constraint.
    expect(sql).not.toMatch(/^\s*(?:DROP\s+INDEX|DROP\s+CONSTRAINT|ALTER\s+TABLE)/im);
  });

  it('indexes the exact positive-cost FIFO candidates without changing source costs', () => {
    expect(sql).toContain('idx_inventory_ledger_fifo_known_cost_recent');
    expect(sql).toContain('idx_inventory_ledger_receipt_known_cost_recent');
    expect(sql).toContain('idx_raw_batches_known_cost_recent');
    expect(sql).toContain('raw_material_id, branch_id, warehouse_id,');
    expect(sql).toContain('created_at DESC NULLS LAST, id DESC');
    expect(sql).toContain("AND COALESCE(batch_number, '') NOT LIKE 'OV-%'");
    expect(sql).toContain("AND COALESCE(source_type, '') NOT LIKE '%_oversold'");
    expect(sql).toContain("COALESCE(reference_type, '') IN ('purchase', 'purchase_receipt')");
    // Zero data backfills, changes to financial authority or trigger reactivation.
    expect(sql).not.toMatch(/^\s*(?:UPDATE|INSERT|DELETE|TRUNCATE|CREATE\s+OR\s+REPLACE\s+FUNCTION|ALTER\s+TABLE)/im);
    expect(sql).not.toMatch(/^\s*(?:ENABLE|DISABLE)\s+TRIGGER/im);
  });

  it('does not silently swap a linked order warehouse after a failed order lookup', () => {
    expect(functionCode).toContain(".eq('branch_id', branchId)");
    expect(functionCode).toContain('if (orderError || !order) return null;');
    expect(functionCode).toContain('if (orderWarehouseId) return orderWarehouseId;');
    expect(functionCode).toContain('if (warehouseError) return null;');
    expect(functionCode).toContain(".eq('is_active', true)");
    expect(functionCode).toContain(".order('is_default', { ascending: false })");
  });
});
