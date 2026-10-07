import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const css = fs.readFileSync('src/index.css', 'utf8');
const tableCard = fs.readFileSync('src/features/pos/components/tables/TableCard.tsx', 'utf8');
const floorPlan = fs.readFileSync('src/features/pos/components/floor/TableFloorPlan.tsx', 'utf8');
const tablesPanel = fs.readFileSync('src/features/pos/components/tables/TablesPanel.tsx', 'utf8');
const currentOrder = fs.readFileSync('src/features/pos/components/order/CurrentOrderPanel.tsx', 'utf8');
const statusStyles = fs.readFileSync('src/features/pos/utils/orderTypes.ts', 'utf8');
const standby = fs.readFileSync('src/features/dashboard/components/DashboardStandbyBar.tsx', 'utf8');

describe('dark POS contrast contract', () => {
  it('uses deep-violet page hierarchy while reserving true black for StandBy', () => {
    expect(css).toContain('--ui-page: 22 16 38;');
    expect(css).toContain('--ui-surface: 30 23 48;');
    expect(css).toContain('--ui-surface-raised: 39 30 60;');
    expect(css).toContain('--ui-text: 246 243 237;');
    expect(css).toContain('--ui-muted: 215 207 225;');
    expect(css).toContain('--ui-accent: var(--brand-400);');
    expect(css).not.toContain('--ui-page: 0 0 0;');
    expect(standby).toContain('bg-black');
  });

  it('also strengthens light-mode secondary text contrast', () => {
    expect(css).toContain('--ui-muted: 68 55 85;');
    expect(css).toContain('--ui-subtle: 110 96 124;');
  });

  it('makes table state and operator/order data visually explicit', () => {
    expect(statusStyles).toContain("occupied: { label: 'occupied', card: 'border-ui-warning/80 bg-ui-warning/20'");
    expect(tableCard).toContain("cardTone: 'border-ui-warning/60 bg-ui-warning/10'");
    expect(tableCard).toContain('min-h-[132px]');
    expect(tableCard).toContain('text-[15px] font-black text-ui-text');
    expect(tableCard).toContain('bg-ui-surface-raised text-ui-text');
    expect(floorPlan).toContain('border-ui-border-strong bg-ui-page-alt');
    expect(tablesPanel).toContain("border-ui-warning/55 bg-ui-warning/15");
  });

  it('keeps dense selling/cart values readable in both modes', () => {
    expect(currentOrder).toContain('bg-ui-surface text-ui-text');
    expect(currentOrder).toContain('text-[11px] font-bold text-ui-muted');
    expect(currentOrder).toContain('border border-ui-border bg-ui-page-alt');
  });
});
