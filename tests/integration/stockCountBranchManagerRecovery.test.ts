import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

// All test writes run inside BEGIN/ROLLBACK on localhost PostgreSQL only.
// Never use a live account, stock count, warehouse or production stock balance.
const url=getDbUrl();
let local=false;
try {local=['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);}
catch { /* No disposable DB. */ }

describe.skipIf(!local)('branch manager count permission and unposted approval cancellation',()=>{
  let db:pg.Client;
  const branch=randomUUID(), warehouse=randomUUID();
  const actor=randomUUID(), approver=randomUUID();
  const count=randomUUID(), postedCount=randomUUID(), appliedCount=randomUUID();

  async function impersonate(id:string){
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id]);
    await db.query("SELECT set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:id,role:'authenticated'})]);
  }
  async function reject(id:string,reason:string|null){
    return (await db.query<{r:{success:boolean,error?:string,approved_unapplied_cancelled?:boolean}}>(
      'SELECT public.reject_stock_count($1,$2) r',[id,reason]
    )).rows[0].r;
  }
  beforeAll(async()=>{
    db=openDb(url); await db.connect(); await db.query('BEGIN');
    await db.query("INSERT INTO public.branches(id,name) VALUES($1,'Count permission QA')",[branch]);
    await db.query("INSERT INTO public.warehouses(id,branch_id,name,is_active,is_default) VALUES($1,$2,'Count QA WH',true,true)",[warehouse,branch]);
    await db.query("INSERT INTO public.users(id,email,role,branch_id,is_active) VALUES($1,$2,'branch_manager',$3,true),($4,$5,'warehouse_manager',$3,true)",
      [actor,'count-actor-'+actor+'@example.test',branch,approver,'count-reviewer-'+approver+'@example.test']);
    // Reproduce the live missing permission, regardless of canonical seed.
    await db.query("UPDATE public.roles SET permissions=(permissions-'inventory.count.create') WHERE role='branch_manager'");
    const migration=readFileSync(
      'supabase/migrations/20261101071500_restore_stock_count_operator_and_safe_cancel.sql','utf8'
    );
    // Its transaction wrapper is owned by the outer rollback-only test.
    await db.query(migration.replace(/^\s*BEGIN;\s*/,'').replace(/\s*COMMIT;\s*$/,''));
    await db.query(`
      INSERT INTO public.stock_counts(id,count_number,branch_id,warehouse_id,status,count_type,created_by,approved_by,approved_at)
      VALUES($1,'QA-APPROVED',$4,$5,'approved','partial',$2,$3,now()),
            ($6,'QA-POSTED',$4,$5,'approved','partial',$2,$3,now()),
            ($7,'QA-APPLIED',$4,$5,'applied','partial',$2,$3,now())`,
      [count,actor,approver,branch,warehouse,postedCount,appliedCount]);
    await db.query(`
      INSERT INTO public.journal_entries(entry_number,branch_id,reference_type,reference_id)
      VALUES($1,$2,'stock_count',$3)`,
      ['QA-COUNT-JOURNAL-'+postedCount,branch,postedCount]);
  },45000);
  afterAll(async()=>{
    if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}
  });

  it('restores create and submit without granting approval or financial stock application',async()=>{
    await impersonate(actor);
    const perms=(await db.query<{can_create:boolean,can_approve:boolean,can_apply:boolean,can_view:boolean}>(
      `SELECT public.can_permission('inventory.count.create') can_create,
        public.can_permission('inventory.count.approve') can_approve,
        public.can_permission('inventory.count.apply') can_apply,
        public.can_permission('inventory.view') can_view`
    )).rows[0];
    expect(perms).toEqual({
      can_create:true,can_approve:false,can_apply:false,can_view:true
    });
    const created=(await db.query<{r:{success:boolean,stock_count_id?:string}}>(
      "SELECT public.create_stock_count($1,$2,'partial',NULL,NULL) r",[branch,warehouse]
    )).rows[0].r;
    expect(created.success,JSON.stringify(created)).toBe(true);
    const rows=(await db.query<{status:string}>(
      'SELECT status FROM public.stock_counts WHERE id=$1',[created.stock_count_id]
    )).rows;
    expect(rows[0].status).toBe('draft');
  });
  it('denies branch manager approved cancellation, requires reason, and never cancels posted/applied count',async()=>{
    await impersonate(actor);
    expect(await reject(count,'attempt')).toMatchObject({success:false,error:'NOT_ALLOWED'});
    await impersonate(approver);
    expect(await reject(count,'')).toMatchObject({success:false,error:'CANCELLATION_REASON_REQUIRED'});
    expect(await reject(postedCount,'old count')).toMatchObject({success:false,error:'COUNT_HAS_POSTED_EFFECTS'});
    expect(await reject(appliedCount,'old count')).toMatchObject({success:false,error:'INVALID_STATUS'});
  });
  it('cancels only unposted approved count, preserving approval audit and leaving all stock untouched',async()=>{
    await impersonate(approver);
    const before=(await db.query<{approved_at:string,approved_by:string}>(
      'SELECT approved_at::text,approved_by::text FROM public.stock_counts WHERE id=$1',[count]
    )).rows[0];
    expect(await reject(count,'Outdated count; recount required')).toEqual({
      success:true,stock_count_id:count,approved_unapplied_cancelled:true
    });
    const after=(await db.query<{status:string,rejection_reason:string,approved_at:string,approved_by:string}>(
      'SELECT status,rejection_reason,approved_at::text,approved_by::text FROM public.stock_counts WHERE id=$1',[count]
    )).rows[0];
    expect(after).toMatchObject({status:'rejected',rejection_reason:'Outdated count; recount required'});
    expect(after.approved_at).toBe(before.approved_at);
    expect(after.approved_by).toBe(before.approved_by);
    expect(await reject(count,'repeat')).toMatchObject({success:false,error:'INVALID_STATUS'});
    const sideEffects=(await db.query<{n:number}>(
      'SELECT count(*)::int n FROM public.inventory_ledger WHERE reference_id=$1',[count]
    )).rows[0].n;
    expect(sideEffects).toBe(0);
  });
});
