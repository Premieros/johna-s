import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('empty order table busy guard', () => {
  it('blocks only effective open/held orders with positive-quantity items', () => {
    const migration = readFileSync(
      'supabase/migrations/20260918151000_fix_empty_order_table_busy_guard.sql',
      'utf8',
    );

    expect(migration).toContain("o.status IN (''open'', ''held'')");
    expect(migration).toContain('FROM public.order_items oi');
    expect(migration).toContain('oi.quantity > 0');
    expect(migration).toContain("RETURN jsonb_build_object(''success'', false, ''error'', ''TABLE_BUSY''");
    expect(migration).toContain("create_order occupancy guard drift; refusing patch");
  });
});
