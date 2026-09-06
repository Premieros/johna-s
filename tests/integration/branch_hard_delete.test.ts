import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAsPersist } from './rls';

const dbUrl = getDbUrl();

type RpcResult = {
  success?: boolean;
  error?: string;
  action?: string;
  blockers?: string[];
  branch_id?: string;
};

describe.skipIf(!dbUrl)('Controlled branch deletion', () => {
  let client: pg.Client;
  const orgId = randomUUID();
  const currentBranchId = randomUUID();
  const emptyBranchId = randomUUID();
  const historyBranchId = randomUUID();
  const actorId = randomUUID();
  const actorRole = `branch_delete_${randomUUID().slice(0, 8)}`;
  const journalId = randomUUID();

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(`INSERT INTO public.organizations (id, name) VALUES ($1, 'Controlled Delete Org')`, [orgId]);
    await client.query(
      `INSERT INTO public.branches (id, organization_id, name, is_active)
       VALUES
         ($1,$4,'Current Branch',true),
         ($2,$4,'Empty Setup Branch',true),
         ($3,$4,'History Branch',true)`,
      [currentBranchId, emptyBranchId, historyBranchId, orgId],
    );

    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, scope, is_active)
       VALUES ($1, 'Branch delete QA', 'Branch delete QA', '["branches.manage"]'::jsonb, 'global', true)`,
      [actorRole],
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users (id,email,username,full_name,role,branch_id,is_active)
       VALUES ($1,$2,$3,'Branch Delete Actor',$4,$5,true)`,
      [
        actorId,
        `branch-delete-${randomUUID()}@example.test`,
        `branch_delete_${randomUUID().slice(0, 8)}`,
        actorRole,
        currentBranchId,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.user_branch_access (user_id,branch_id)
       VALUES ($1,$2),($1,$3)`,
      [actorId, emptyBranchId, historyBranchId],
    );

    const account = await client.query<{ id: string }>(
      `SELECT id FROM public.chart_of_accounts WHERE branch_id=$1 ORDER BY code LIMIT 1`,
      [historyBranchId],
    );
    expect(account.rows).toHaveLength(1);

    await client.query(
      `INSERT INTO public.journal_entries
         (id,entry_number,branch_id,reference_type,reference_number,description,created_by)
       VALUES ($1,$2,$3,'qa','QA-CONTROLLED-DELETE','Operational history must survive',$4)`,
      [journalId, `JE-${randomUUID()}`, historyBranchId, actorId],
    );
    await client.query(
      `INSERT INTO public.journal_entry_lines (journal_entry_id,account_id,debit,credit,note)
       VALUES ($1,$2,1,0,'debit'),($1,$2,0,1,'credit')`,
      [journalId, account.rows[0].id],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('disables direct authenticated branch DELETE so hard delete must use the controlled RPC', async () => {
    const policy = await client.query<{ qual: string }>(
      `SELECT qual FROM pg_policies
       WHERE schemaname='public' AND tablename='branches' AND policyname='auth_delete_branches'`,
    );
    expect(policy.rows).toHaveLength(1);
    expect(policy.rows[0].qual).toBe('false');
  });

  it('does not use a role label as authorization and protects the callers current branch', async () => {
    const res = await runAsPersist(
      client,
      actorId,
      `SELECT public.delete_branch_cascade($1) AS res`,
      [currentBranchId],
    );
    expect((res.rows[0] as { res: RpcResult }).res).toMatchObject({
      success: false,
      error: 'CANNOT_DELETE_CURRENT_BRANCH',
    });
  });

  it('hard-deletes an unused setup-only branch through branches.manage', async () => {
    const res = await runAsPersist(
      client,
      actorId,
      `SELECT public.delete_branch_cascade($1) AS res`,
      [emptyBranchId],
    );
    const result = (res.rows[0] as { res: RpcResult }).res;
    expect(result).toMatchObject({ success: true, branch_id: emptyBranchId });

    const branch = await client.query(`SELECT id FROM public.branches WHERE id=$1`, [emptyBranchId]);
    expect(branch.rows).toHaveLength(0);
  });

  it('rejects hard delete when operational history exists and directs the caller to deactivate', async () => {
    const res = await runAsPersist(
      client,
      actorId,
      `SELECT public.delete_branch_cascade($1) AS res`,
      [historyBranchId],
    );
    const result = (res.rows[0] as { res: RpcResult }).res;
    expect(result).toMatchObject({
      success: false,
      error: 'BRANCH_HAS_OPERATIONAL_HISTORY',
      action: 'DEACTIVATE_BRANCH',
    });
    expect(result.blockers).toContain('journal_entries');

    const branch = await client.query(`SELECT id FROM public.branches WHERE id=$1`, [historyBranchId]);
    expect(branch.rows).toHaveLength(1);
    const journal = await client.query(`SELECT id FROM public.journal_entries WHERE id=$1`, [journalId]);
    expect(journal.rows).toHaveLength(1);
  });

  it('deactivates a branch with history without deleting that history', async () => {
    const res = await runAsPersist(
      client,
      actorId,
      `SELECT public.deactivate_branch($1) AS res`,
      [historyBranchId],
    );
    expect((res.rows[0] as { res: RpcResult }).res).toMatchObject({ success: true });

    const branch = await client.query<{ is_active: boolean }>(
      `SELECT is_active FROM public.branches WHERE id=$1`,
      [historyBranchId],
    );
    expect(branch.rows).toHaveLength(1);
    expect(branch.rows[0].is_active).toBe(false);

    const journal = await client.query(`SELECT id FROM public.journal_entries WHERE id=$1`, [journalId]);
    expect(journal.rows).toHaveLength(1);
  });

  it('still refuses hard delete after deactivation while history exists', async () => {
    const res = await runAsPersist(
      client,
      actorId,
      `SELECT public.delete_branch_cascade($1) AS res`,
      [historyBranchId],
    );
    expect((res.rows[0] as { res: RpcResult }).res).toMatchObject({
      success: false,
      error: 'BRANCH_HAS_OPERATIONAL_HISTORY',
      action: 'DEACTIVATE_BRANCH',
    });
  });
});
