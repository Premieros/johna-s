import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('Purchase Request creation — Permission-First contract', () => {
  let client: pg.Client;
  const branchA = randomUUID();
  const branchB = randomUUID();
  const creatorId = randomUUID();
  const legacyManagerId = randomUUID();
  const creatorRole = `qa_pr_creator_${randomUUID().slice(0, 8)}`;
  const legacyRole = `qa_pr_legacy_${randomUUID().slice(0, 8)}`;

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

  async function createRequest(userId: string, branchId: string) {
    return asUser(userId, async () => {
      const result = await client.query<{ r: { success: boolean; error?: string; detail?: string } }>(
        `SELECT public.create_purchase_request($1, NULL, 'normal', NULL, 'permission-first regression', NULL) AS r`,
        [branchId],
      );
      return result.rows[0].r;
    });
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches(id,name) VALUES ($1,'PR Permission A'),($2,'PR Permission B')`,
      [branchA, branchB],
    );

    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES
         ($1,'منشئ طلب شراء','Purchase Request Creator','["procurement.request.create"]'::jsonb,'global',true),
         ($2,'إدارة مشتريات قديمة','Legacy Purchase Manager','["purchases.manage"]'::jsonb,'global',true)`,
      [creatorRole, legacyRole],
    );

    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users(id,email,username,full_name,role,branch_id,is_active)
       VALUES
         ($1,$2,$3,'Purchase Request Creator',$4,$5,true),
         ($6,$7,$8,'Legacy Purchase Manager',$9,$5,true)`,
      [
        creatorId, `${randomUUID()}@test.local`, `prc_${randomUUID().slice(0, 8)}`, creatorRole, branchA,
        legacyManagerId, `${randomUUID()}@test.local`, `prl_${randomUUID().slice(0, 8)}`, legacyRole,
      ],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('uses procurement.request.create instead of purchases.manage in the RPC', async () => {
    const result = await client.query<{ definition: string }>(
      `SELECT pg_get_functiondef('public.create_purchase_request(uuid,uuid,text,date,text,jsonb)'::regprocedure) AS definition`,
    );
    const definition = result.rows[0].definition;

    expect(definition).toContain("can_permission('procurement.request.create')");
    expect(definition).not.toContain("can_permission('purchases.manage')");
    expect(definition).toContain('is_pos_admin()');
    expect(definition).toContain("SET search_path TO 'public', 'pg_temp'");
  });

  it('allows a same-branch user with only procurement.request.create', async () => {
    const result = await createRequest(creatorId, branchA);
    expect(result.success).toBe(true);
  });

  it('rejects a user that has only the legacy purchases.manage capability', async () => {
    const result = await createRequest(legacyManagerId, branchA);
    expect(result.success).toBe(false);
    expect(result.error).toBe('NOT_ALLOWED');
  });

  it('preserves branch isolation for the canonical creator capability', async () => {
    const result = await createRequest(creatorId, branchB);
    expect(result.success).toBe(false);
    expect(result.error).toBe('BRANCH_MISMATCH');
  });
});
