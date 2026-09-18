import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

describe('captain send, operator transfer and cashier print UI contract', () => {
  it('keeps captain send ownership explicit instead of weakening cross-user access', () => {
    const hook = read('src/features/pos/hooks/usePosOrderBase.ts');
    const migration = read('supabase/migrations/20260918174500_captain_operator_transfer_cashier_print.sql');

    expect(hook).toContain("res.error === 'ORDER_OPERATOR_REQUIRED'");
    expect(hook).toContain('انقل مسؤولية الطلب إلى المستخدم الصحيح');
    expect(migration).not.toContain("UPDATE public.roles SET permissions");
  });

  it('exposes user transfer inside the existing POS transfer dialog', () => {
    const modal = read('src/features/pos/components/tables/TransferOrderModal.tsx');
    const api = read('src/api/domains/pos.ts');

    expect(modal).toContain('listOrderTransferTargets');
    expect(modal).toContain('transferOrderOperator');
    expect(modal).toContain('نقل مسؤولية الطلب لمستخدم آخر');
    expect(modal).toContain('نقل المستخدم');
    expect(api).toContain("rpc('list_pos_order_transfer_targets'");
  });

  it('routes the POS open-check print button to cashier cloud printing', () => {
    const hook = read('src/features/pos/hooks/usePosOrderBase.ts');
    const cloud = read('src/features/pos/services/cloudPrint.ts');
    const migration = read('supabase/migrations/20260918174500_captain_operator_transfer_cashier_print.sql');

    expect(hook).toContain('enqueueCloudOpenOrderPrint');
    expect(hook).toContain('تم إرسال الحساب إلى محطة طباعة الكاشير');
    expect(cloud).toContain('apiPos.enqueueOpenOrderPrint');
    expect(migration).toContain("'receipt','cashier'");
    expect(migration).toContain("can_permission('pos.receipt.print')");
  });

  it('attributes linked-order sales to the current transferred operator while preserving payer audit', () => {
    const migration = read('supabase/migrations/20260918174500_captain_operator_transfer_cashier_print.sql');

    expect(migration).toContain('v_effective_operator');
    expect(migration).toContain('v_order_owner');
    expect(migration).toContain('CASE WHEN p_order_id IS NOT NULL THEN v_order_owner ELSE auth.uid() END');
    expect(migration).toContain('v_effective_operator, v_effective_operator');
    expect(migration).toContain("REVOKE ALL ON FUNCTION public._process_sale_core");
  });

  it('keeps operator transfer independent from users.manage', () => {
    const migration = read('supabase/migrations/20260918174500_captain_operator_transfer_cashier_print.sql');

    expect(migration).toContain("can_permission('pos.order.transfer')");
    expect(migration).toContain('transfer_order_operator manage-others fragment drift');
    expect(migration).toContain("COALESCE(r.permissions,'[]'::jsonb) ? 'pos.view'");
  });
});
