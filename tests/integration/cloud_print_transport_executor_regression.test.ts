import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('cloud print transport executor regression', () => {
  let client: pg.Client;
  const orgId = randomUUID();
  const branchId = randomUUID();
  const receiptOnlyUser = randomUUID();
  const noPrintUser = randomUUID();
  const receiptOnlyRole = `qa_receipt_transport_${randomUUID().slice(0, 8)}`;
  const noPrintRole = `qa_no_print_${randomUUID().slice(0, 8)}`;
  const kitchenJobId = randomUUID();

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.organizations(id,name,slug) VALUES($1,'Print Transport Org',$2)`,
      [orgId, `print-transport-${randomUUID()}`],
    );
    await client.query(
      `INSERT INTO public.branches(id,organization_id,name) VALUES($1,$2,'Print Transport Branch')`,
      [branchId, orgId],
    );
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active) VALUES
       ($1,'Receipt transport','Receipt transport','["pos.receipt.print"]'::jsonb,'branch',true),
       ($2,'No print','No print','["pos.view"]'::jsonb,'branch',true)`,
      [receiptOnlyRole, noPrintRole],
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users(id,email,username,full_name,role,branch_id,is_active) VALUES
       ($1,$2,'receipt-transport','Receipt Transport',$3,$5,true),
       ($4,$6,'no-print','No Print',$7,$5,true)`,
      [
        receiptOnlyUser, `${receiptOnlyUser}@example.test`, receiptOnlyRole,
        noPrintUser, branchId, `${noPrintUser}@example.test`, noPrintRole,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.cloud_print_jobs
       (id,branch_id,requested_by,kind,station_code,payload,idempotency_key,status)
       VALUES($1,$2,$3,'kitchen','kit','{"text":"KITCHEN TEST"}'::jsonb,$4,'pending')`,
      [kitchenJobId, branchId, receiptOnlyUser, `transport-${kitchenJobId}`],
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('allows a receipt-capable terminal operator to transport a kitchen job without granting kitchen business permission', async () => {
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [receiptOnlyUser]);

    const helper = await client.query<{ kitchen: boolean; receipt: boolean; report: boolean; unknown: boolean }>(
      `SELECT
         public.can_execute_cloud_print_kind('kitchen') AS kitchen,
         public.can_execute_cloud_print_kind('receipt') AS receipt,
         public.can_execute_cloud_print_kind('report') AS report,
         public.can_execute_cloud_print_kind('test') AS unknown`,
    );
    expect(helper.rows[0]).toEqual({ kitchen: true, receipt: true, report: true, unknown: false });

    const claimed = await client.query<{ result: { success: boolean; jobs: Array<{ id: string; kind: string }> } }>(
      `SELECT public.claim_cloud_print_jobs($1,$2,12) AS result`,
      [branchId, randomUUID()],
    );

    expect(claimed.rows[0].result.success).toBe(true);
    expect(claimed.rows[0].result.jobs.some((job) => job.id === kitchenJobId && job.kind === 'kitchen')).toBe(true);
    await client.query('RESET ROLE');
  });

  it('still denies background queue execution to users with no operational print capability', async () => {
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [noPrintUser]);

    const helper = await client.query<{ kitchen: boolean; receipt: boolean; report: boolean }>(
      `SELECT
         public.can_execute_cloud_print_kind('kitchen') AS kitchen,
         public.can_execute_cloud_print_kind('receipt') AS receipt,
         public.can_execute_cloud_print_kind('report') AS report`,
    );
    expect(helper.rows[0]).toEqual({ kitchen: false, receipt: false, report: false });
    await client.query('RESET ROLE');
  });
});
