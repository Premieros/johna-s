import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const cart = fs.readFileSync('src/features/pos/utils/cart.ts', 'utf8');
const base = fs.readFileSync('src/features/pos/hooks/usePosOrderBase.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260930183000_pos_line_identity_resend_guard.sql', 'utf8');

describe('resumed POS line identity / kitchen resend guard', () => {
  it('carries order_item_id back to update_order', () => {
    expect(cart).toContain('order_item_id?: string | null;');
    expect(cart).toContain('order_item_id: i.order_item_id || null');
  });

  it('merges a fresh addition into an existing resumed business configuration', () => {
    expect(base).toContain('sameCartConfiguration(i, incoming)');
    expect(base).toContain('const existingKey = cartLineKey(existing)');
    expect(base).not.toContain('const incomingKey = cartLineKey(incoming);');
  });

  it('makes update_order honor exact persisted line identity before fallback matching', () => {
    expect(migration).toContain("v_requested_item_id := NULLIF(v_item->>'order_item_id', '')::uuid");
    expect(migration).toContain('oi.id = v_requested_item_id');
    expect(migration).toContain('ORDER_ITEM_IDENTITY_MISMATCH');
    expect(migration).toContain("oi.unit_price = COALESCE((v_item->>'unit_price')::numeric, oi.unit_price)");
  });
});
