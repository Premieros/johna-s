import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20260922110000_reconcile_unapplied_non_print_contracts.sql',
  'utf8',
);

const executable = sql
  .replace(/--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('production migration reconciliation contract', () => {
  it('keeps printing infrastructure frozen', () => {
    expect(executable).not.toMatch(
      /cloud_print_jobs|print_agent|printer_route|route_to_station|thermal_print|print_queue/i,
    );
  });

  it('reconciles the confirmed non-print gaps', () => {
    for (const marker of [
      'product_images_insert_edit',
      'procurement.request.create',
      'raw_material_warehouse_inventory',
      'WAREHOUSE_BRANCH_MISMATCH',
      'transfer_order_to_table',
      'pos.order.create',
      'ORDER_OPERATOR_ASSIGNMENT_FORBIDDEN',
      'pos.order.edit',
      'SENT_ITEM_CHANGE_REQUIRES_VOID',
      'PERMISSION_DENIED:users.create',
      "o.status IN ('open', 'held', 'completed')",
      'sent_quantity IS DISTINCT FROM v_target_quantity',
    ]) {
      expect(sql).toContain(marker);
    }
  });

  it('uses branch-aware raw stock-count snapshots', () => {
    expect(sql).toContain('from public.raw_material_warehouse_inventory');
    expect(sql).toContain('warehouse_id=p_warehouse_id');
  });

  it('patches live order RPCs instead of replacing their later full definitions', () => {
    expect(sql).toContain('RECONCILE_CREATE_ORDER_GUARD_PATTERN_CHANGED');
    expect(sql).toContain('RECONCILE_UPDATE_ORDER_MATCH_PATTERN_CHANGED');
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.create_order\s*\(/i);
    expect(sql).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.update_order\s*\(/i);
  });

  it('keeps the reconciliation fail-closed when live function shapes drift', () => {
    for (const marker of [
      'RECONCILE_CREATE_PURCHASE_REQUEST_BRANCH_PATTERN_CHANGED',
      'RECONCILE_RECEIVE_PURCHASE_BRANCH_PATTERN_CHANGED',
      'RECONCILE_CREATE_ORDER_DECL_PATTERN_CHANGED',
      'RECONCILE_UPDATE_ORDER_SELECT_PATTERN_CHANGED',
      'RECONCILE_UPDATE_ORDER_DELETE_PATTERN_CHANGED',
    ]) {
      expect(sql).toContain(marker);
    }
  });
});
