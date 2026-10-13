import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';
const url = getDbUrl();
const local = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('source-order kitchen print branch guard', () => {
  let db: pg.Client;
  let ids: RlsIds;
  let number: string;
  let metadata: unknown;
  const catalog = () => db.query(`SELECT oid::text,prosecdef,proconfig,proacl::text,proowner::text FROM pg_proc WHERE oid IN ('public.send_to_kitchen(uuid,uuid)'::regprocedure,'public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text)'::regprocedure) ORDER BY oid`);
  beforeAll(async () => {
    db = openDb(url!); await db.connect(); await db.query('BEGIN');
    metadata = (await catalog()).rows;
    ids = await seedRlsFixture(db);
    number = (await db.query('SELECT order_number FROM public.orders WHERE id=$1', [ids.rows.orders.own])).rows[0].order_number;
    const guarded = (await db.query("SELECT position('ORDER_PRINT_BRANCH_MISMATCH' IN prosrc)>0 present FROM pg_proc WHERE oid='public.enqueue_cloud_kitchen_print(uuid,text,jsonb,text)'::regprocedure")).rows[0].present;
    if (!guarded) await db.query(readFileSync('scripts/rollout/kitchen_print_order_branch_guard_20261013.sql','utf8').replace(/^BEGIN;\n/m,'').replace(/^COMMIT;\n/m,''));
  });
  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); } });
  async function enqueue(branch: string, payload: object, key: string) {
    await db.query("SELECT set_config('app.user_id',$1,true)",[ids.users.super_admin]);
    await db.query('SET LOCAL ROLE authenticated');
    try {
      return (await db.query('SELECT public.enqueue_cloud_kitchen_print($1,$2,$3::jsonb,$4) r',[branch,'main',JSON.stringify(payload),key])).rows[0].r as {success:boolean;error?:string;job_id?:string};
    } finally { await db.query('RESET ROLE'); await db.query('RESET app.user_id'); }

  }
  it('rejects the Cleopatra-in-Smoha shape even for a super administrator', async () => {
    const r = await enqueue(ids.branchB, { order_id: ids.rows.orders.own, text: `Order: ${number}\r\n` }, 'wrong-branch');
    expect(r).toMatchObject({ success: false, error: 'ORDER_PRINT_BRANCH_MISMATCH' });
    expect((await db.query("SELECT count(*)::int n FROM public.cloud_print_jobs WHERE idempotency_key='wrong-branch'")).rows[0].n).toBe(0);
  });
  it('protects already-deployed clients whose tickets contain only an order number', async () => {
    expect(await enqueue(ids.branchB, { text: `الطلب: ${number}\r\nالطاولة: 43\r\n` }, 'legacy-wrong')).toMatchObject({ success: false, error: 'ORDER_PRINT_BRANCH_MISMATCH' });
  });
  it('accepts the correct branch once and preserves queue idempotency', async () => {
    const p = { order_id: ids.rows.orders.own, text: `Order: ${number}\n` };
    const first = await enqueue(ids.branchA, p, 'correct-branch');
    const retry = await enqueue(ids.branchA, p, 'correct-branch');
    expect(first.success).toBe(true); expect(retry.job_id).toBe(first.job_id);
    expect((await db.query("SELECT count(*)::int n FROM public.cloud_print_jobs WHERE idempotency_key='correct-branch'")).rows[0].n).toBe(1);
  });
  it('rejects invalid order identities and preserves existing function security', async () => {
    expect(await enqueue(ids.branchA, { order_id: 'invalid', text: 'ticket' }, 'invalid-order')).toMatchObject({ success: false, error: 'ORDER_PRINT_CONTEXT_INVALID' });
    expect((await catalog()).rows).toEqual(metadata);
  });
});
