import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('production-normalized migration compatibility', () => {
  it('accepts compact transfer ownership function bodies without weakening permission checks', () => {
    const migration = readFileSync(
      'supabase/migrations/20260918174500_captain_operator_transfer_cashier_print.sql',
      'utf8',
    );

    expect(migration).toContain(
      "IF NOT public.can_manage_other_pos_orders() THEN RETURN jsonb_build_object(''success'',false,''error'',''POS_ADMIN_PERMISSION_REQUIRED''); END IF;",
    );
    expect(migration).toContain(
      "IF NOT v_transfer_context THEN RAISE EXCEPTION ''ORDER_TRANSFER_RPC_REQUIRED''; END IF; IF NOT v_can_manage_others THEN RAISE EXCEPTION ''POS_ADMIN_PERMISSION_REQUIRED''; END IF;",
    );
    expect(migration).toContain("RAISE EXCEPTION 'transfer_order_operator manage-others fragment drift; refusing patch'");
  });

  it('accepts compact cloud-print function bodies while preserving permission-first execution', () => {
    const migration = readFileSync(
      'supabase/migrations/20260918185500_cloud_print_agent_operational_permissions.sql',
      'utf8',
    );

    expect(migration).toContain(
      "IF NOT public.can_permission(''settings.manage'') THEN RETURN jsonb_build_object(''success'', false, ''error'', ''PERMISSION_DENIED'', ''permission'', ''settings.manage''); END IF;",
    );
    expect(migration).toContain('public.can_execute_cloud_print_kind(kind)');
    expect(migration).toContain('public.can_execute_cloud_print_kind(v_job.kind)');
  });
});
