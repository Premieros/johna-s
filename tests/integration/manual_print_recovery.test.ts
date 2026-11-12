import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';
const url = getDbUrl();
const local = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('manual ticket recovery preserves canonical agent ownership', () => {
  let db: pg.Client; let ids: RlsIds;
  const fingerprints = async () => (await db.query("SELECT proname,md5(pg_get_functiondef(oid)) hash FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('claim_cloud_print_jobs','start_cloud_print_job','complete_cloud_print_job','can_execute_cloud_print_kind') ORDER BY proname")).rows;
  async function asUser<T>(user: string, action: () => Promise<T>) {
    await db.query("SELECT set_config('app.user_id',$1,true)", [user]); await db.query('SET LOCAL ROLE authenticated');
    try { return await action(); } finally { await db.query('RESET ROLE'); await db.query('RESET app.user_id'); }
  }
  async function rpc(name: string, args: unknown[]) {
    const names = ['list_delayed_cloud_print_jobs', 'reserve_manual_cloud_print_job', 'finish_manual_cloud_print_job', 'claim_cloud_print_jobs'];
    if (!names.includes(name)) throw new Error('unexpected fixture function');
    return (await db.query(`SELECT public.${name}(${args.map((_, i) => '$'+(i+1)).join(',')}) result`, args)).rows[0].result;
  }
  async function job(status = 'pending', age = 30, attempts = 0, branch?: string) {
    const id = randomUUID();
    await db.query(`INSERT INTO public.cloud_print_jobs(id,branch_id,requested_by,kind,station_code,payload,idempotency_key,status,attempts,created_at)
      VALUES($1::uuid,$2,$3,'kitchen','bar','{"text":"LOCAL FIXTURE - NEVER PRINT"}',$1::text,$4,$5,now()-make_interval(secs=>$6))`,
      [id,branch || ids.branchA,ids.users.cashier,status,attempts,age]);
    return id;
  }
  beforeAll(async () => {
    db = openDb(url); await db.connect(); await db.query('BEGIN'); ids = await seedRlsFixture(db);
    const before = await fingerprints();
    await db.query(readFileSync('supabase/migrations/20261112161939_manual_delayed_print_recovery.sql','utf8'));
    expect(await fingerprints()).toEqual(before);
    // Only the synthetic local manager gets the new permission.
    await db.query(`UPDATE public.roles SET permissions=permissions || '["pos.print_recovery","pos.print_kitchen","pos.receipt.print"]'::jsonb WHERE role='branch_manager'`);
  });
  afterAll(async () => { if (db) { await db.query('ROLLBACK'); await db.end(); } });
  it('denies ungranted cashiers and cross-branch managers', async () => {
    expect(await asUser(ids.users.cashier, () => rpc('list_delayed_cloud_print_jobs',[ids.branchA]))).toMatchObject({ success:false,error:'PERMISSION_DENIED' });
    expect(await asUser(ids.users.branch_manager, () => rpc('list_delayed_cloud_print_jobs',[ids.branchB]))).toMatchObject({ success:false,error:'BRANCH_MISMATCH' });
  });
  it('lists only old, never-claimed pending work without returning payloads', async () => {
    const own = await job(); const young = await job('pending', 1); const submitted = await job('submitted'); const failed = await job('failed',30,5);
    const result = await asUser(ids.users.branch_manager, () => rpc('list_delayed_cloud_print_jobs',[ids.branchA]));
    expect(result.jobs.map((x: { id: string }) => x.id)).toContain(own);
    for (const id of [young,submitted,failed]) expect(result.jobs.map((x: { id: string }) => x.id)).not.toContain(id);
    expect(result.jobs.find((x: { id: string }) => x.id === own)).not.toHaveProperty('payload');
  });
  it('reserves one exact job and excludes both a second manual click and the automatic agent', async () => {
    const id = await job(); const agent = randomUUID();
    const result = await asUser(ids.users.branch_manager, () => rpc('reserve_manual_cloud_print_job',[id,agent]));
    expect(result).toMatchObject({success:true,job:{id}});
    const state = (await db.query('SELECT status,attempts,lease_expires_at>now()+interval \'9 minutes\' extended FROM public.cloud_print_jobs WHERE id=$1',[id])).rows[0];
    expect(state).toEqual({status:'printing',attempts:1,extended:true});
    expect(await asUser(ids.users.branch_manager, () => rpc('reserve_manual_cloud_print_job',[id,randomUUID()]))).toMatchObject({success:false,error:'JOB_NO_LONGER_PENDING'});
    const automatic = await asUser(ids.users.branch_manager, () => rpc('claim_cloud_print_jobs',[ids.branchA,randomUUID(),25]));
    expect(automatic.jobs.map((x: {id:string}) => x.id)).not.toContain(id);
    expect(await asUser(ids.users.cashier, () => rpc('finish_manual_cloud_print_job',[id,agent,true]))).toMatchObject({success:false});
    expect(await asUser(ids.users.branch_manager, () => rpc('finish_manual_cloud_print_job',[id,agent,true]))).toMatchObject({success:true,status:'submitted'});
  });
  it('never replays cancelled/uncertain output through automatic claims', async () => {
    const id = await job(); const agent = randomUUID();
    await asUser(ids.users.branch_manager, () => rpc('reserve_manual_cloud_print_job',[id,agent]));
    expect(await asUser(ids.users.branch_manager, () => rpc('finish_manual_cloud_print_job',[id,agent,false]))).toMatchObject({success:true,retryable:false,error:'PRINT_OUTCOME_UNKNOWN'});
    expect((await db.query('SELECT status,attempts,last_error FROM public.cloud_print_jobs WHERE id=$1',[id])).rows[0]).toEqual({status:'failed',attempts:5,last_error:'PRINT_OUTCOME_UNKNOWN'});
  });
  it('does not steal an automatic-agent claim', async () => {
    const id = await job('claimed');
    expect(await asUser(ids.users.branch_manager, () => rpc('reserve_manual_cloud_print_job',[id,randomUUID()]))).toMatchObject({success:false,error:'JOB_NO_LONGER_PENDING'});
  });
});
