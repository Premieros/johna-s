import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20260917090000_harden_order_create_update_permissions.sql', 'utf8');

describe('POS order mutation server authority contract', () => {
  it('requires create/edit permissions inside SECURITY DEFINER RPCs', () => {
    expect(sql).toContain("can_permission('pos.order.create')");
    expect(sql).toContain("can_permission('pos.order.edit')");
    expect(sql).toContain('user_may_access_branch(p_branch_id)');
    expect(sql).toContain('user_may_access_branch(v_branch_id)');
  });

  it('does not trust a client supplied cashier identity for normal authenticated calls', () => {
    expect(sql).toContain('v_effective_cashier := v_uid');
    expect(sql).toContain('p_cashier_id uuid DEFAULT NULL::uuid');
  });

  it('prevents sent lines from being reduced or deleted outside controlled void', () => {
    expect(sql).toContain('SENT_ITEM_CHANGE_REQUIRES_VOID');
    expect(sql).toContain('v_quantity + 0.000001 < COALESCE(v_sent_quantity, 0)');
    expect(sql).toContain('JOIN public.order_kitchen_sends s ON s.order_item_id = oi.id');
  });

  it('prevents update_order from moving an order onto another live order table', () => {
    expect(sql).toContain("status IN ('open', 'held')");
    expect(sql).toContain("'TABLE_BUSY'");
  });
});
