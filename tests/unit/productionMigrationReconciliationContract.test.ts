import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20260922110000_reconcile_unapplied_non_print_contracts.sql',
  'utf8',
);

const executable = sql
  .replace(/--.*$/gm, '')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function stripDollarQuotedBodies(input: string) {
  return input.replace(
    /\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g,
    '',
  );
}

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

  it('does not directly rewrite transactional business data during migration', () => {
    const topLevelSql = stripDollarQuotedBodies(executable);

    expect(topLevelSql).not.toMatch(
      /DELETE\s+FROM\s+public\.(sales|purchases|orders|order_items|raw_material_batches|inventory_batches)\b/i,
    );
    expect(topLevelSql).not.toMatch(
      /UPDATE\s+public\.(sales|purchases|orders|order_items|raw_material_inventory|raw_material_warehouse_inventory|inventory)\b/i,
    );
  });

  it('uses branch-aware raw stock-count snapshots', () => {
    expect(sql).toContain('from public.raw_material_warehouse_inventory');
    expect(sql).toContain('warehouse_id=p_warehouse_id');
  });

  it('patches live order RPCs instead of replacing later table-shell/note fixes', () => {
    expect(sql).toContain('RECONCILE_CREATE_ORDER_GUARD_PATTERN_CHANGED');
    expect(sql).toContain('RECONCILE_UPDATE_ORDER_MATCH_PATTERN_CHANGED');

    const targetedPatch = sql.slice(sql.indexOf('-- create_order:'));
    expect(targetedPatch).not.toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(create_order|update_order)\b/i,
    );
  });
});
