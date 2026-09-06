import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('close_shift Permission-First security', () => {
  let client: pg.Client;

  const branchA = randomUUID();
  const branchB = randomUUID();
  const noPermUser = randomUUID();
  const closeUser = randomUUID();
  const managerUser = randomUUID();
  const branchManagerLabelUser = randomUUID();
  const victimA = randomUUID();
  const victimB = randomUUID();

  const noPermRole = `qa_shift_none_${randomUUID().slice(0, 8)}`;
  const closeRole = `qa_shift_close_${randomUUID().slice(0, 8)}`;
  const managerRole = `qa_shift_manage_${randomUUID().slice(0, 8)}`;

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  async function createOpenShift(cashierId: string, branchId: string): Promise<string> {
    return (
      await client.query<{ id: string }>(
        `INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, status)
         VALUES ($1,$2,100,'open') RETURNING id`,
        [branchId, cashierId],
      )
    ).rows[0].id;
  }

  async function forceClose(shiftId: string): Promise<void> {
    await client.query(
      `UPDATE public.shifts SET status='closed', closed_at=now() WHERE id=$1`,
      [shiftId],
    );
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches (id,name) VALUES ($1,'QA Shift A'),($2,'QA Shift B')`,
      [branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.roles (role,name_ar,name_en,permissions,scope,is_active) VALUES
       ($1,'بدون صلاحية','No shift permission','[]'::jsonb,'global',true),
       ($2,'إغلاق شيفت','Close shift','["shifts.close"]'::jsonb,'global',true),
       ($3,'إدارة شيفت','Manage shift','["shifts.close","shifts.manage"]'::jsonb,'global',true)`,
      [noPermRole, closeRole, managerRole],
    );

    // Make the real branch_manager label intentionally carry no shift authority
    // inside this transaction. Old role-name authorization would still allow it;
    // Permission-First authorization must not.
    await client.query(
      `UPDATE public.roles
       SET permissions = COALESCE(permissions, '[]'::jsonb) - 'shifts.close' - 'shifts.manage'
       WHERE role = 'branch_manager'`,
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users (id,email,full_name,role,branch_id,is_active) VALUES
       ($1,$2,'No Permission',$7,$6,true),
       ($3,$4,'Close Own',$8,$6,true),
       ($5,$9,'Shift Manager',$10,$6,true),
       ($11,$12,'Branch Manager Label','branch_manager',$6,true),
       ($13,$14,'Victim A',$7,$6,true),
       ($15,$16,'Victim B',$7,$17,true)`,
      [
        noPermUser, `${noPermUser}@test.local`,
        closeUser, `${closeUser}@test.local`,
        managerUser, branchA,
        noPermRole, closeRole,
        `${managerUser}@test.local`, managerRole,
        branchManagerLabelUser, `${branchManagerLabelUser}@test.local`,
        victimA, `${victimA}@test.local`,
        victimB, `${victimB}@test.local`, branchB,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('hardens SECURITY DEFINER search_path and grants', async () => {
    const row = await client.query<{
      config: string[] | null;
      authenticated_execute: boolean;
      anon_execute: boolean;
    }>(
      `SELECT p.proconfig AS config,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='close_shift'
         AND pg_get_function_identity_arguments(p.oid)='p_shift_id uuid, p_actual_amount numeric, p_notes text'`,
    );

    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].config ?? []).toContain('search_path=public, pg_temp');
    expect(row.rows[0].authenticated_execute).toBe(true);
    expect(row.rows[0].anon_execute).toBe(false);
  });

  it('requires shifts.close even for the cashier who owns the shift', async () => {
    const shiftId = await createOpenShift(noPermUser, branchA);

    const result = await asUser(noPermUser, async () =>
      client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.close_shift($1,100,NULL) AS r`,
        [shiftId],
      ),
    );

    expect(result.rows[0].r).toMatchObject({ success: false, error: 'SHIFT_NOT_ALLOWED' });
    await forceClose(shiftId);
  });

  it('allows shifts.close to close the caller own shift', async () => {
    const shiftId = await createOpenShift(closeUser, branchA);

    const result = await asUser(closeUser, async () =>
      client.query<{ r: { success?: boolean; shift_id?: string } }>(
        `SELECT public.close_shift($1,100,'own close') AS r`,
        [shiftId],
      ),
    );

    expect(result.rows[0].r).toMatchObject({ success: true, shift_id: shiftId });
  });

  it('requires shifts.manage for another cashier and ignores branch_manager label', async () => {
    const shiftId = await createOpenShift(victimA, branchA);

    const closeOnly = await asUser(closeUser, async () =>
      client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.close_shift($1,100,NULL) AS r`,
        [shiftId],
      ),
    );
    expect(closeOnly.rows[0].r).toMatchObject({ success: false, error: 'NOT_YOUR_SHIFT' });

    const labelOnly = await asUser(branchManagerLabelUser, async () =>
      client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.close_shift($1,100,NULL) AS r`,
        [shiftId],
      ),
    );
    expect(labelOnly.rows[0].r).toMatchObject({ success: false, error: 'SHIFT_NOT_ALLOWED' });

    const managed = await asUser(managerUser, async () =>
      client.query<{ r: { success?: boolean; shift_id?: string } }>(
        `SELECT public.close_shift($1,100,'managed close') AS r`,
        [shiftId],
      ),
    );
    expect(managed.rows[0].r).toMatchObject({ success: true, shift_id: shiftId });
  });

  it('does not expose a shift from an inaccessible branch', async () => {
    const shiftId = await createOpenShift(victimB, branchB);

    const result = await asUser(managerUser, async () =>
      client.query<{ r: { success?: boolean; error?: string } }>(
        `SELECT public.close_shift($1,100,NULL) AS r`,
        [shiftId],
      ),
    );

    expect(result.rows[0].r).toMatchObject({ success: false, error: 'SHIFT_NOT_FOUND' });
    await forceClose(shiftId);
  });
});
