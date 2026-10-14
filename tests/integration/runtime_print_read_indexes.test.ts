import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';
const url = getDbUrl();
const local = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const candidate = readFileSync('scripts/experiments/runtime_print_read_indexes_candidate_20261014.sql', 'utf8');

describe.skipIf(!local)('staged print read indexes preserve canonical queue/security', () => {
  let db: pg.Client;
  let ids: RlsIds;
  const alertId = randomUUID();
  const key = `index-review-${randomUUID()}`;
  const metadata = async () => (await db.query(`SELECT
    (SELECT md5(string_agg(pg_get_functiondef(p.oid),',' ORDER BY p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f') functions,
    (SELECT md5(string_agg(row_to_json(p)::text,',' ORDER BY policyname)) FROM pg_policies p WHERE schemaname='public' AND tablename='cloud_print_jobs') policies,
    (SELECT md5(string_agg(pg_get_triggerdef(oid),',' ORDER BY oid)) FROM pg_trigger WHERE tgrelid='public.cloud_print_jobs'::regclass) triggers,
    (SELECT md5(string_agg(pg_get_constraintdef(oid),',' ORDER BY oid)) FROM pg_constraint WHERE conrelid='public.cloud_print_jobs'::regclass) constraints`)).rows;
  async function read(user: string, branch: string) {
    await db.query("SELECT set_config('app.user_id',$1,true)", [user]);
    await db.query('SET LOCAL ROLE authenticated');
    try {
      const alerts = (await db.query(`SELECT id FROM public.cloud_print_jobs WHERE branch_id=$1
        AND (status='failed' OR (status='submitted' AND attempts>1))
        AND updated_at>=now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 40`, [branch])).rows;
      const lock = (await db.query('SELECT public.get_open_order_print_state($1) result', [ids.rows.orders.own])).rows;
      return { alerts, lock };
    } finally { await db.query('RESET ROLE'); await db.query('RESET app.user_id'); }
  }
  beforeAll(async () => {
    db = openDb(url!); await db.connect(); await db.query('BEGIN');
    ids = await seedRlsFixture(db);
    await db.query(`INSERT INTO public.cloud_print_jobs
      (id,branch_id,requested_by,kind,station_code,payload,idempotency_key,status,attempts,created_at,updated_at)
      VALUES ($1,$2,$3,'receipt','cashier','{"text":"fixture"}'::jsonb,$4,'failed',5,now(),now())`,
      [alertId,ids.branchA,ids.users.cashier,key]);
    await db.query(`INSERT INTO public.cloud_print_jobs
      (branch_id,requested_by,kind,station_code,payload,idempotency_key,status)
      VALUES ($1,$2,'receipt','cashier','{"text":"fixture"}'::jsonb,$3,'submitted')`,
      [ids.branchA,ids.users.cashier,`open-check:${ids.rows.orders.own}:fixture`]);
  });
  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); } });
  it('returns identical authorized rows and receipt-lock truth before and after indexes', async () => {
    const security = await metadata();
    const own = await read(ids.users.cashier, ids.branchA);
    const foreign = await read(ids.users.cashier_b, ids.branchA);
    expect(own.alerts.map(x => x.id)).toContain(alertId);
    expect(own.lock[0].result).toMatchObject({ success: true, locked: true });
    expect(foreign.alerts).toEqual([]);
    expect(foreign.lock[0].result).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
    await db.query(candidate);
    expect(await read(ids.users.cashier, ids.branchA)).toEqual(own);
    expect(await read(ids.users.cashier_b, ids.branchA)).toEqual(foreign);
    expect(await metadata()).toEqual(security);
  });
  it('keeps queue idempotency enforced by the existing unique constraint', async () => {
    await db.query('SAVEPOINT duplicate_job');
    try {
      await expect(db.query(`INSERT INTO public.cloud_print_jobs
        (branch_id,requested_by,kind,station_code,payload,idempotency_key,status)
        VALUES ($1,$2,'receipt','cashier','{"text":"fixture"}'::jsonb,$3,'pending')`,
        [ids.branchA,ids.users.cashier,key])).rejects.toMatchObject({ code: '23505' });
    } finally { await db.query('ROLLBACK TO SAVEPOINT duplicate_job'); }
  });
});
