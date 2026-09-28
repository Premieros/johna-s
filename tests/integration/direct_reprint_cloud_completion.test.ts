import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

type CompleteResult = {
  success?: boolean;
  error?: string;
  status?: string;
};

describe.skipIf(!dbUrl)('direct receipt reprint cloud completion', () => {
  let client: pg.Client;

  const branchId = randomUUID();
  const agentUser = randomUUID();
  const managerUser = randomUUID();
  const cashierUser = randomUUID();
  const agentRole = `print_agent_${randomUUID().slice(0, 8)}`;
  const managerRole = `print_manager_${randomUUID().slice(0, 8)}`;
  const cashierRole = `print_cashier_${randomUUID().slice(0, 8)}`;
  const managerSale = randomUUID();
  const cashierSale = randomUUID();
  const agentId = randomUUID();

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches(id,name) VALUES($1,'Direct Reprint Branch')`,
      [branchId],
    );

    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active) VALUES
       ($1,'Agent','Agent','["pos.receipt.print"]'::jsonb,'global',true),
       ($2,'Manager','Manager','["pos.receipt.print","pos.reprint"]'::jsonb,'global',true),
       ($3,'Cashier','Cashier','["pos.receipt.print"]'::jsonb,'global',true)`,
      [agentRole, managerRole, cashierRole],
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES
       ($1,$2,'Print Agent',$3,$4,true),
       ($5,$6,'Direct Reprint Manager',$7,$4,true),
       ($8,$9,'One Print Cashier',$10,$4,true)`,
      [
        agentUser, `${randomUUID()}@test.local`, agentRole, branchId,
        managerUser, `${randomUUID()}@test.local`, managerRole,
        cashierUser, `${randomUUID()}@test.local`, cashierRole,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.sales(id,invoice_number,branch_id,cashier_id,total,paid_amount,payment_method)
       VALUES
       ($1,$2,$3,$4,100,100,'cash'),
       ($5,$6,$3,$7,80,80,'cash')`,
      [
        managerSale, `DIRECT-${randomUUID()}`, branchId, managerUser,
        cashierSale, `ONE-${randomUUID()}`, cashierUser,
      ],
    );

    await client.query(
      `INSERT INTO public.sale_print_events(sale_id,branch_id,user_id,print_number)
       VALUES($1,$2,$3,1),($4,$2,$5,1)`,
      [managerSale, branchId, managerUser, cashierSale, cashierUser],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  async function createClaimedJob(saleId: string, requesterId: string): Promise<string> {
    const row = await client.query<{ id: string }>(
      `INSERT INTO public.cloud_print_jobs(
         branch_id,requested_by,kind,station_code,payload,sale_id,
         expected_print_number,idempotency_key,status,claimed_agent_id,claimed_by_user,claimed_at
       )
       VALUES($1,$2,'receipt','cashier','{}'::jsonb,$3,2,$4,'claimed',$5,$6,now())
       RETURNING id`,
      [branchId, requesterId, saleId, `direct-reprint-${randomUUID()}`, agentId, agentUser],
    );
    return row.rows[0].id;
  }

  async function complete(jobId: string): Promise<CompleteResult> {
    return asUser(agentUser, async () => {
      const row = await client.query<{ value: CompleteResult }>(
        `SELECT public.complete_cloud_print_job($1,$2,true,NULL) AS value`,
        [jobId, agentId],
      );
      return row.rows[0].value;
    });
  }

  it('lets a requester with pos.reprint complete a direct reprint without an approval row', async () => {
    const jobId = await createClaimedJob(managerSale, managerUser);
    const result = await complete(jobId);

    expect(result.success).toBe(true);
    expect(result.status).toBe('submitted');

    const events = await client.query<{ print_number: number; approval_request_id: string | null }>(
      `SELECT print_number,approval_request_id
       FROM public.sale_print_events
       WHERE sale_id=$1
       ORDER BY print_number`,
      [managerSale],
    );
    expect(events.rows.map((row) => row.print_number)).toEqual([1, 2]);
    expect(events.rows[1].approval_request_id).toBeNull();
  });

  it('still rejects a second print for a one-time-print requester without approval', async () => {
    const jobId = await createClaimedJob(cashierSale, cashierUser);
    const result = await complete(jobId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('INVALID_APPROVAL');

    const events = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM public.sale_print_events WHERE sale_id=$1`,
      [cashierSale],
    );
    expect(events.rows[0].count).toBe('1');
  });
});
