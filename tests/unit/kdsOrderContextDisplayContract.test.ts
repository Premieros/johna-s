import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('KDS table and operator display contract', () => {
  it('loads table/operator context in one batch and renders both labels', () => {
    const page = read('src/features/inventory/pages/KitchenDisplayPage.tsx');
    expect(page).toContain("supabase.rpc('get_kitchen_order_context'");
    expect(page).toContain('p_order_ids: orderIds');
    expect(page).toContain('data-testid="kds-table-name"');
    expect(page).toContain('data-testid="kds-operator-name"');
    expect(page).toContain("context?.table_name");
    expect(page).toContain("context?.operator_name");
  });

  it('keeps kitchen dispatch/routing out of the display-context migration', () => {
    const migration = read('supabase/migrations/20260920171000_kds_order_table_operator_context.sql');
    expect(migration).toContain('get_kitchen_order_context');
    expect(migration).toContain("public.can_permission('pos.kds_view')");
    expect(migration).toContain('public.get_kitchen_queue');
    expect(migration).toContain('LEFT JOIN public.dining_tables');
    expect(migration).toContain('LEFT JOIN public.users');
    expect(migration).not.toContain('send_to_kitchen');
    expect(migration).not.toContain('order_kitchen_sends');
    expect(migration).not.toContain('print_jobs');
  });
});
