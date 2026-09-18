import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('PR207 production drift compatibility', () => {
  it('reconciles a missing process_sale order-owner guard before attribution changes', () => {
    const migration = readFileSync(
      'supabase/migrations/20260918174500_captain_operator_transfer_cashier_print.sql',
      'utf8',
    );

    expect(migration).toContain("IF position('v_order_owner uuid;' IN v_def)=0 THEN");
    expect(migration).toContain('process_sale settlement-preview marker drift');
    expect(migration).toContain("RETURN jsonb_build_object(''success'', false, ''error'', ''ORDER_OPERATOR_REQUIRED'')");
    expect(migration).toContain('CASE WHEN p_order_id IS NOT NULL THEN v_order_owner ELSE auth.uid() END');
    expect(migration).toContain('process_sale core-call operator fragment drift');
  });

  it('still refuses unknown function-body shapes instead of applying a blind patch', () => {
    const migration = readFileSync(
      'supabase/migrations/20260918174500_captain_operator_transfer_cashier_print.sql',
      'utf8',
    );

    expect(migration).toContain('refusing compatibility patch');
    expect(migration).toContain('refusing patch');
  });
});
