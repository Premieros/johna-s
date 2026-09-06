import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('POS discount and order close controls', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  async function def(name: string): Promise<string> {
    const { rows } = await client.query<{ def: string }>(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname=$1 AND p.prokind='f'
      ORDER BY p.oid DESC
      LIMIT 1
    `, [name]);
    expect(rows).toHaveLength(1);
    return rows[0].def;
  }

  it('requires payment permission and full settlement before a linked order can close', async () => {
    const sale = await def('process_sale');
    expect(sale).toContain("can_permission('pos.payment.take')");
    expect(sale).toContain('user_may_access_branch(p_branch_id)');
    expect(sale).toContain('FULL_PAYMENT_REQUIRED_TO_CLOSE_ORDER');
    expect(sale).toContain("can_permission('pos.discount')");
    expect(sale).toContain("action_type='discount'");
  });

  it('applies the same payment and discount controls to split tender', async () => {
    const split = await def('process_sale_split');
    expect(split).toContain("can_permission('pos.payment.take')");
    expect(split).toContain('user_may_access_branch(p_branch_id)');
    expect(split).toContain("can_permission('pos.discount')");
    expect(split).toContain('MANAGER_APPROVAL_REQUIRED');
    expect(split).toContain("action_type='discount'");
    expect(split).toContain('SPLIT_PAYMENT_TOTAL_MISMATCH');
  });

  it('does not allow direct order completion or unsafe cancellation of sent orders', async () => {
    const status = await def('set_order_status');
    expect(status).toContain("can_permission('pos.order.edit')");
    expect(status).toContain('user_may_access_branch(v_order.branch_id)');
    expect(status).toContain('COMPLETION_REQUIRES_PAYMENT');
    expect(status).toContain('SENT_ORDER_CANCEL_REQUIRES_CONTROLLED_VOID');
    expect(status).toContain('REASON_REQUIRED');
  });

  it('keeps direct payment-status mutation internal-only', async () => {
    const { rows } = await client.query<{
      anon_exec: boolean;
      auth_exec: boolean;
      service_exec: boolean;
    }>(`
      SELECT
        has_function_privilege('anon','public.set_payment_status(uuid,text)','EXECUTE') AS anon_exec,
        has_function_privilege('authenticated','public.set_payment_status(uuid,text)','EXECUTE') AS auth_exec,
        has_function_privilege('service_role','public.set_payment_status(uuid,text)','EXECUTE') AS service_exec
    `);
    expect(rows[0]).toEqual({ anon_exec: false, auth_exec: false, service_exec: true });
  });
});
