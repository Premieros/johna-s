import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Budget = {
  warning_ms: number;
  critical_ms: number;
  max_client_round_trips: number;
  basis: string;
};

type BudgetFile = {
  version: number;
  updated_at: string;
  scope: string;
  notes: string[];
  paths: Record<string, Budget>;
};

const budgets = JSON.parse(
  readFileSync('scripts/performance/critical-path-budgets.json', 'utf8'),
) as BudgetFile;

const requiredPaths = [
  'pos.active_orders_snapshot',
  'pos.cart_availability',
  'pos.active_shift',
  'pos.send_to_kitchen',
  'dashboard.sales_snapshot',
  'inventory.ledger',
  'costing.sales_summary',
  'costing.raw_material_overview',
  'closing.shift_day_reads',
];

describe('critical performance budget contract', () => {
  it('keeps every operational critical path under an explicit budget', () => {
    for (const path of requiredPaths) {
      expect(budgets.paths[path], `missing budget for ${path}`).toBeTruthy();
    }
  });

  it('keeps warning/critical thresholds and call budgets internally consistent', () => {
    for (const [path, budget] of Object.entries(budgets.paths)) {
      expect(budget.warning_ms, `${path} warning_ms`).toBeGreaterThan(0);
      expect(budget.critical_ms, `${path} critical_ms`).toBeGreaterThanOrEqual(budget.warning_ms);
      expect(budget.max_client_round_trips, `${path} max_client_round_trips`).toBeGreaterThan(0);
      expect(budget.basis.trim().length, `${path} basis`).toBeGreaterThan(20);
    }
  });

  it('keeps Production latency checks informational rather than a live CI dependency', () => {
    const baselineSql = readFileSync('scripts/performance/production-readonly-baseline.sql', 'utf8');

    expect(baselineSql).toContain('READ-ONLY');
    expect(baselineSql).toContain('pg_stat_statements');
    expect(baselineSql).not.toMatch(/\b(update|insert|delete|truncate|alter|drop|create)\b/i);
  });
});
