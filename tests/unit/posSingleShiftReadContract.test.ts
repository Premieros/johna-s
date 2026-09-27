import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync('src/features/pos/pages/PosWorkspacePage.tsx', 'utf8');
const productBrowser = readFileSync('src/features/pos/components/catalog/ProductBrowser.tsx', 'utf8');
const payment = readFileSync('src/features/pos/services/payment.ts', 'utf8');

describe('POS single active-shift read contract', () => {
  it('keeps the workspace as the authoritative POS shift reader', () => {
    expect(workspace).toContain("api.pos.getActiveShift({ p_branch_id: effectiveBranch })");
    expect(workspace).toContain('shiftChecked={shiftChecked}');
    expect(workspace).toContain('shiftOpen={!!activeShift}');
  });

  it('does not let ProductBrowser issue a duplicate shift RPC', () => {
    expect(productBrowser).toContain('shiftChecked: boolean;');
    expect(productBrowser).toContain('shiftOpen: boolean;');
    expect(productBrowser).toContain('const canAddToCart = canModifyOrder && hasBranch && shiftChecked && shiftOpen;');
    expect(productBrowser).not.toContain('getActiveShift');
    expect(productBrowser).not.toContain("import * as api from '@/api'");
  });

  it('preserves authoritative settlement fallback validation', () => {
    expect(payment).toContain("posApi.getActiveShift({ p_branch_id: p.p_branch_id })");
    expect(payment).toContain("return { payload: null, error: 'SHIFT_REQUIRED' }");
  });

  it('does not involve frozen printing or kitchen transport', () => {
    for (const source of [workspace, productBrowser]) {
      expect(source).not.toContain('claim_cloud_print_jobs');
    }
    expect(productBrowser).not.toContain('order_kitchen_sends');
    expect(productBrowser).not.toContain('send_to_kitchen');
  });
});
