import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('work authorization backend contract', () => {
  let client: pg.Client;

  const branchA = randomUUID();
  const branchB = randomUUID();
  const worker = randomUUID();
  const approverA = randomUUID();
  const approverB = randomUUID();

  const workerRole = `wa_worker_${randomUUID().slice(0, 8)}`;
  const approverRole = `wa_approver_${randomUUID().slice(0, 8)}`;

  async function asUser<T extends pg.QueryResultRow = pg.QueryResultRow>(userId: string, sql: string, params: unknown[] = []): Promise<pg.QueryResult<T>> {
    await client.query(`SELECT set_config('app.user_id',$1,true)`, [userId]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      return await client.query<T>(sql, params);
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  type RpcValue = { success?: boolean; error?: string; status?: string; requestId?: string };

  async function rpcJson(userId: string, sql: string, params: unknown[] = []): Promise<RpcValue> {
    const result = await asUser<{ value: RpcValue }>(userId, `SELECT (${sql}) AS value`, params);
    return result.rows[0].value;
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches(id,name) VALUES ($1,'WA Branch A'),($2,'WA Branch B')`,
      [branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active) VALUES
       ($1,'Worker','Worker','[]'::jsonb,'global',true),
       ($2,'Approver','Approver','["work.authorization.approve","work.authorization.manage"]'::jsonb,'global',true)`,
      [workerRole, approverRole],
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES
       ($1,$2,'Worker A',$3,$4,true),
       ($5,$6,'Approver A',$7,$4,true),
       ($8,$9,'Approver B',$7,$10,true)`,
      [
        worker, `${randomUUID()}@test.local`, workerRole, branchA,
        approverA, `${randomUUID()}@test.local`, approverRole,
        approverB, `${randomUUID()}@test.local`, branchB,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('is fail-open when no explicit policy exists', async () => {
    const r = await asUser<{ allowed: boolean }>(
      worker,
      `SELECT public.can_user_work($1) AS allowed`,
      [branchA],
    );
    expect(r.rows[0].allowed).toBe(true);
  });

  it('lets only an in-scope manager with manage capability create the requirement', async () => {
    const denied = await rpcJson(
      approverB,
      `public.set_work_authorization_requirement($1,$2,true)`,
      [worker, branchA],
    );
    expect(denied.success).toBe(false);
    expect(denied.error).toBe('BRANCH_ACCESS_DENIED');

    const ok = await rpcJson(
      approverA,
      `public.set_work_authorization_requirement($1,$2,true)`,
      [worker, branchA],
    );
    expect(ok.success).toBe(true);

    const blocked = await asUser<{ allowed: boolean }>(
      worker,
      `SELECT public.can_user_work($1) AS allowed`,
      [branchA],
    );
    expect(blocked.rows[0].allowed).toBe(false);
  });

  it('creates one idempotent pending request for the current user', async () => {
    const first = await rpcJson(worker, `public.request_work_authorization($1)`, [branchA]);
    const second = await rpcJson(worker, `public.request_work_authorization($1)`, [branchA]);

    expect(first.status).toBe('pending');
    expect(first.requestId).toBeTruthy();
    expect(second.requestId).toBe(first.requestId);

    const count = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.work_authorizations
       WHERE user_id=$1 AND branch_id=$2 AND status='pending'`,
      [worker, branchA],
    );
    expect(count.rows[0].count).toBe('1');
  });

  it('denies self approval even when the requester temporarily owns the approval permission', async () => {
    await client.query(
      `UPDATE public.roles
       SET permissions = permissions || '["work.authorization.approve"]'::jsonb
       WHERE role=$1`,
      [workerRole],
    );

    const pending = await client.query<{ id: string }>(
      `SELECT id FROM public.work_authorizations
       WHERE user_id=$1 AND branch_id=$2 AND status='pending'`,
      [worker, branchA],
    );

    const result = await rpcJson(
      worker,
      `public.decide_work_authorization($1,true,NULL)`,
      [pending.rows[0].id],
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('SELF_APPROVAL_DENIED');

    await client.query(
      `UPDATE public.roles
       SET permissions = permissions - 'work.authorization.approve'
       WHERE role=$1`,
      [workerRole],
    );
  });

  it('denies an approver outside the branch and lets the in-scope approver approve', async () => {
    const pending = await client.query<{ id: string }>(
      `SELECT id FROM public.work_authorizations
       WHERE user_id=$1 AND branch_id=$2 AND status='pending'`,
      [worker, branchA],
    );

    const outside = await rpcJson(
      approverB,
      `public.decide_work_authorization($1,true,NULL)`,
      [pending.rows[0].id],
    );
    expect(outside.success).toBe(false);
    expect(outside.error).toBe('BRANCH_ACCESS_DENIED');

    const approved = await rpcJson(
      approverA,
      `public.decide_work_authorization($1,true,NULL)`,
      [pending.rows[0].id],
    );
    expect(approved.success).toBe(true);
    expect(approved.status).toBe('approved');

    const allowed = await asUser<{ allowed: boolean }>(
      worker,
      `SELECT public.can_user_work($1) AS allowed`,
      [branchA],
    );
    expect(allowed.rows[0].allowed).toBe(true);
  });

  it('moves a stopped authorization back to pending until a manager approves again', async () => {
    const active = await client.query<{ id: string }>(
      `SELECT id
       FROM public.work_authorizations
       WHERE user_id=$1 AND branch_id=$2 AND status='approved'
       ORDER BY updated_at DESC LIMIT 1`,
      [worker, branchA],
    );

    const revoked = await rpcJson(
      approverA,
      `public.revoke_work_authorization($1,$2)`,
      [active.rows[0].id, 'stop current work authorization'],
    );
    expect(revoked.success).toBe(true);

    const statuses = await client.query<{ status: string; id: string }>(
      `SELECT id,status
       FROM public.work_authorizations
       WHERE user_id=$1 AND branch_id=$2
       ORDER BY created_at DESC`,
      [worker, branchA],
    );
    expect(statuses.rows.some((row) => row.status === 'revoked')).toBe(true);
    const pending = statuses.rows.find((row) => row.status === 'pending');
    expect(pending?.id).toBeTruthy();

    const blocked = await asUser<{ allowed: boolean }>(
      worker,
      `SELECT public.can_user_work($1) AS allowed`,
      [branchA],
    );
    expect(blocked.rows[0].allowed).toBe(false);

    const reapproved = await rpcJson(
      approverA,
      `public.decide_work_authorization($1,true,NULL)`,
      [pending!.id],
    );
    expect(reapproved.success).toBe(true);
    expect(reapproved.status).toBe('approved');

    const allowed = await asUser<{ allowed: boolean }>(
      worker,
      `SELECT public.can_user_work($1) AS allowed`,
      [branchA],
    );
    expect(allowed.rows[0].allowed).toBe(true);
  });

  it('keeps authorization independent from shift open and close lifecycle', async () => {
    const before = await asUser<{ allowed: boolean }>(
      worker,
      `SELECT public.can_user_work($1) AS allowed`,
      [branchA],
    );
    expect(before.rows[0].allowed).toBe(true);

    const shift = await client.query<{ id: string }>(
      `INSERT INTO public.shifts(branch_id,cashier_id,opening_amount,status)
       VALUES($1,$2,0,'open') RETURNING id`,
      [branchA, worker],
    );

    const during = await asUser<{ allowed: boolean }>(
      worker,
      `SELECT public.can_user_work($1) AS allowed`,
      [branchA],
    );
    expect(during.rows[0].allowed).toBe(true);

    await client.query(
      `UPDATE public.shifts SET status='closed',closed_at=now() WHERE id=$1`,
      [shift.rows[0].id],
    );

    const after = await asUser<{ allowed: boolean }>(
      worker,
      `SELECT public.can_user_work($1) AS allowed`,
      [branchA],
    );
    expect(after.rows[0].allowed).toBe(true);

    const activeAuth = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.work_authorizations
       WHERE user_id=$1
         AND branch_id=$2
         AND status='approved'`,
      [worker, branchA],
    );
    expect(activeAuth.rows[0].count).toBe('1');
  });

  it('invalidates stale approvals when the requirement is disabled and does not restore them later', async () => {
    const disabled = await rpcJson(
      approverA,
      `public.set_work_authorization_requirement($1,$2,false)`,
      [worker, branchA],
    );
    expect(disabled.success).toBe(true);

    const allowedWithoutRequirement = await asUser<{ allowed: boolean }>(
      worker,
      `SELECT public.can_user_work($1) AS allowed`,
      [branchA],
    );
    expect(allowedWithoutRequirement.rows[0].allowed).toBe(true);

    const activeAfterDisable = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.work_authorizations
       WHERE user_id=$1
         AND branch_id=$2
         AND status IN ('approved','pending')`,
      [worker, branchA],
    );
    expect(activeAfterDisable.rows[0].count).toBe('0');

    const reenabled = await rpcJson(
      approverA,
      `public.set_work_authorization_requirement($1,$2,true)`,
      [worker, branchA],
    );
    expect(reenabled.success).toBe(true);

    const blockedAgain = await asUser<{ allowed: boolean }>(
      worker,
      `SELECT public.can_user_work($1) AS allowed`,
      [branchA],
    );
    expect(blockedAgain.rows[0].allowed).toBe(false);

    const state = await rpcJson(worker, `public.get_my_work_authorization_state($1)`, [branchA]);
    expect(state.status).toBe('revoked');
  });

  it('blocks authenticated direct writes to authorization tables', async () => {
    await client.query('SAVEPOINT wa_direct_write');
    try {
      await expect(
        asUser(
          worker,
          `INSERT INTO public.work_authorization_policies(user_id,branch_id,requires_authorization)
           VALUES($1,$2,true)`,
          [worker, branchA],
        ),
      ).rejects.toThrow();
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT wa_direct_write');
    }
  });

  it('records authorization events and audit rows', async () => {
    const events = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.work_authorization_events
       WHERE user_id=$1 AND branch_id=$2`,
      [worker, branchA],
    );
    expect(Number(events.rows[0].count)).toBeGreaterThanOrEqual(4);

    const audit = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM public.audit_log
       WHERE branch_id=$1
         AND action LIKE 'work_authorization_%'`,
      [branchA],
    );
    expect(Number(audit.rows[0].count)).toBeGreaterThanOrEqual(3);
  });
});
