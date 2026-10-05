import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const workspace = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
const publicHook = readFileSync('src/features/pos/hooks/usePosOrder.ts', 'utf8');
const previewService = readFileSync('src/features/pos/services/settlementPreview.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260917084500_sent_only_order_settlement.sql', 'utf8');
const paidOrderGuard = readFileSync('supabase/migrations/20261002194500_paid_order_reopen_guard.sql', 'utf8');

describe('POS sent-only settlement contract', () => {
  it('derives payable and printable quantities from authoritative unsettled kitchen events', () => {
    expect(migration).toContain('e.settled_sale_id IS NULL');
    expect(migration).toContain('e.sent_quantity > e.voided_quantity');
    expect(migration).toContain("'has_payable_items', v_pending > 0");
    expect(previewService).toContain("supabase.rpc('get_order_settlement_preview'");
  });

  it('keeps payment preview read-only for already-sent orders', () => {
    expect(publicHook).toContain('const saveOpenOrderSnapshot = useCallback');
    expect(publicHook).toContain('api.floorPlan.updateOrder');
    expect(publicHook).toContain('const preview = await loadSettlementPreview(false)');
    expect(publicHook).not.toContain('settlementPreview || await loadSettlementPreview(false)');
    expect(publicHook).toContain('useScopedSettlementPreview(base.activeOrderId, input.branchId)');
    expect(publicHook).not.toContain('const preview = await loadSettlementPreview(true)');
    expect(publicHook).not.toContain('settlementPreview || await loadSettlementPreview(true)');
  });

  it('excludes unsent additions from checkout totals and open-order receipt', () => {
    expect(publicHook).toContain('settlementPreview.subtotal');
    expect(publicHook).toContain('settlementPreview.discount_amount');
    expect(publicHook).toContain('settlementPreview.tax_amount');
    expect(publicHook).toContain('settlementPreview.total');
    expect(publicHook).toContain('buildSettlementReceipt(preview');
    expect(publicHook).toContain('buildReceiptThermalText(receipt, input.effSettings, lang, isAr)');
    expect(publicHook).toContain('buildReceiptFixedTemplate(receipt, input.effSettings, lang, isAr)');
    expect(publicHook).toContain('template,');
    expect(publicHook).toContain('paperWidthMm: APPROVED_FIXED_THERMAL_WIDTH_MM');
    expect(publicHook).toContain('enqueueCloudOpenOrderPrint({');
  });

  it('keeps the order open after partial settlement and completes only when nothing remains', () => {
    expect(migration).toContain('v_remaining_unsettled <= 0.000001');
    expect(migration).toContain('v_remaining_unsent <= 0.000001');
    expect(migration).toContain("SET status = 'completed'");
    expect(publicHook).toContain('if (extended.order_completed)');
    expect(publicHook).toContain('Only part of the order was settled; the order is still open');
    expect(publicHook).toContain("preview.unsent_quantity > 0");
    expect(publicHook).toContain("setSettlementReceiptOrderCompleted(Boolean(extended.order_completed))");
    expect(workspace).toContain("pos.receiptOrderCompleted === false");
    expect(workspace).toContain('Partial payment recorded — order is still open');
  });

  it('prevents kitchen Void from crossing the financial settlement boundary', () => {
    expect(paidOrderGuard).toContain("'PAID_ITEM_REFUND_REQUIRED'");
    expect(paidOrderGuard).toContain('v_unsettled_available');
    expect(paidOrderGuard).toContain('v_settled_active');
    expect(paidOrderGuard).toContain('private.reconcile_paid_order_after_kitchen_void');
    expect(paidOrderGuard).toContain("SET status='completed'");
  });

  it('keeps the first-send UI gate in the workspace', () => {
    expect(workspace).toContain('const hasUnsentItems = useMemo');
  });
});
