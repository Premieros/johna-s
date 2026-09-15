import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

type RpcEnvelope = {
  success?: boolean;
  error?: string;
  open?: number;
};

const rpcResult = (row: Record<string, unknown> | undefined): RpcEnvelope =>
  (row?.result || {}) as RpcEnvelope;

describe.skipIf(!dbUrl)('customer opening receivables', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
    if (!imp) return;

    await client.query(`
      UPDATE public.roles
      SET permissions = permissions || '["accounts.view","sales.payment.receive"]'::jsonb
      WHERE role = 'branch_manager'
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  const guarded = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx: { skip?: () => unknown }) => {
      if (!imp) return typeof ctx.skip === 'function' ? ctx.skip() : undefined;
      await fn();
    });

  guarded('includes historical opening movements in AR aging and settles them before sales', async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();

    await client.query(
      `INSERT INTO public.customer_opening_receivables
        (id, branch_id, customer_id, occurred_at, external_reference, amount, entry_type, source_system)
       VALUES
        ($1,$2,$3,'2026-08-31T12:00:00Z','OPENING-1',100,'opening_balance','integration'),
        ($4,$2,$3,'2026-09-02T12:00:00Z','LEGACY-ORDER-1',40,'historical_charge','integration')`,
      [firstId, ids.branchA, ids.custA, secondId],
    );

    const agingBefore = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.get_ar_aging($1,$2) AS result',
      [ids.branchA, '2026-09-16'],
    );
    expect(agingBefore.error).toBeUndefined();
    const beforeRows = (agingBefore.rows[0]?.result || []) as Array<Record<string, unknown>>;
    const before = beforeRows.find((row) => row.customer_id === ids.custA);
    expect(Number(before?.open_amount)).toBe(140);

    const payment = await runAsPersist(
      client,
      ids.users.branch_manager,
      `SELECT public.receive_payment($1,$2,$3,'cash',NULL,'opening AR settlement') AS result`,
      [ids.custA, ids.branchA, 60],
    );
    expect(payment.error).toBeUndefined();
    expect(rpcResult(payment.rows[0]).success).toBe(true);

    const entries = await client.query(
      `SELECT id, amount, settled_amount
       FROM public.customer_opening_receivables
       WHERE id = ANY($1::uuid[])
       ORDER BY occurred_at ASC`,
      [[firstId, secondId]],
    );
    expect(entries.rows).toHaveLength(2);
    expect(Number(entries.rows[0].settled_amount)).toBe(60);
    expect(Number(entries.rows[1].settled_amount)).toBe(0);

    const agingAfter = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT public.get_ar_aging($1,$2) AS result',
      [ids.branchA, '2026-09-16'],
    );
    expect(agingAfter.error).toBeUndefined();
    const afterRows = (agingAfter.rows[0]?.result || []) as Array<Record<string, unknown>>;
    const after = afterRows.find((row) => row.customer_id === ids.custA);
    expect(Number(after?.open_amount)).toBe(80);
  });

  guarded('keeps opening receivables branch isolated under RLS', async () => {
    const otherId = randomUUID();
    await client.query(
      `INSERT INTO public.customer_opening_receivables
        (id, branch_id, customer_id, occurred_at, external_reference, amount, entry_type, source_system)
       VALUES ($1,$2,$3,now(),'OTHER-BRANCH',25,'opening_balance','integration')`,
      [otherId, ids.branchB, ids.custB],
    );

    const hidden = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT count(*)::int AS count FROM public.customer_opening_receivables WHERE id=$1',
      [otherId],
    );
    expect(hidden.error).toBeUndefined();
    expect(Number(hidden.rows[0]?.count)).toBe(0);
  });
});
