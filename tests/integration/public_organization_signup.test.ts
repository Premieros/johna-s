import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type pg from 'pg';
import {getDbUrl,openDb} from './db';
import {runAs,runAsPersist,seedRlsFixture,type RlsIds} from './rls';
const url=getDbUrl();const local=!!url&&['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('verified public organization onboarding — owned localhost only',()=>{
 let db:pg.Client;let ids:RlsIds;let owner:string;let organization:string;let branch:string;let otherOrganization:string;
 beforeAll(async()=>{
  db=openDb(url!);await db.connect();await db.query('BEGIN');await db.query("SET LOCAL statement_timeout='8s'");ids=await seedRlsFixture(db);await db.query("INSERT INTO auth.users(id,email,email_confirmed_at,is_anonymous) SELECT id,email,now(),false FROM public.users WHERE id=$1 ON CONFLICT(id) DO UPDATE SET email_confirmed_at=now()",[ids.users.cashier]);otherOrganization=(await db.query('SELECT organization_id FROM public.branches WHERE id=$1',[ids.branchA])).rows[0].organization_id;
  await db.query(`UPDATE public.roles SET permissions=permissions||'["branches.manage","users.branches.manage","products.view","accounts.view"]'::jsonb WHERE role='owner'`);
 });
 afterAll(async()=>{if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}});
 async function identity(verified=true){const id=randomUUID();await db.query(`INSERT INTO auth.users(id,email,aud,role,email_confirmed_at,created_at,updated_at,is_anonymous) VALUES($1,$2,'authenticated','authenticated',CASE WHEN $3 THEN now() ELSE NULL END,now(),now(),false)`,[id,'signup-'+id+'@example.test',verified]);return id;}
 const signup=(id:string,persist=false)=> (persist?runAsPersist:runAs)(db,id,'SELECT public.complete_own_organization_signup($1,$2,$3) r',['Independent restaurant','Verified owner','01000000000']);
 const counts=async()=> (await db.query(`SELECT (SELECT count(*) FROM public.organizations)::int organizations,(SELECT count(*) FROM public.branches)::int branches,(SELECT count(*) FROM public.users)::int users,(SELECT count(*) FROM public.sales)::int sales,(SELECT count(*) FROM public.journal_entries)::int journals,(SELECT count(*) FROM public.cloud_print_jobs)::int prints`)).rows[0];
 it('atomically creates only the verified caller, canonical branch defaults and both trial scopes',async()=>{
  owner=await identity();const before=await counts();const r=await signup(owner,true);expect(r.error).toBeUndefined();expect(r.rows[0].r).toMatchObject({success:true,trial_days:14});const created=r.rows[0].r as {organization_id:string;branch_id:string};organization=created.organization_id;branch=created.branch_id;
  const after=await counts();expect(after).toEqual({...before,organizations:before.organizations+1,branches:before.branches+1,users:before.users+1});
  const profile=(await db.query('SELECT id,role,branch_id,is_active FROM public.users WHERE id=$1',[owner])).rows[0];expect(profile).toEqual({id:owner,role:'owner',branch_id:branch,is_active:true});
  expect((await db.query('SELECT organization_id,membership_role FROM public.organization_members WHERE user_id=$1',[owner])).rows).toEqual([{organization_id:organization,membership_role:'owner'}]);
  expect((await db.query('SELECT branch_id FROM public.warehouses WHERE branch_id=$1',[branch])).rows).toHaveLength(1);
  expect((await db.query('SELECT count(*)::int n FROM public.chart_of_accounts WHERE branch_id=$1',[branch])).rows[0].n).toBeGreaterThan(0);
  expect((await db.query('SELECT count(*)::int n FROM public.account_mappings WHERE branch_id=$1',[branch])).rows[0].n).toBeGreaterThan(0);
  expect((await db.query('SELECT count(*)::int n FROM public.user_branch_access WHERE user_id=$1 AND branch_id=$2',[owner,branch])).rows[0].n).toBe(1);
  expect((await db.query("SELECT status,trial_ends_at>now() active FROM public.subscriptions WHERE tenant_id=$1",[organization])).rows[0]).toEqual({status:'trialing',active:true});
  expect((await db.query("SELECT status,trial_ends_at>now() active FROM public.branch_subscriptions WHERE branch_id=$1",[branch])).rows[0]).toEqual({status:'trial',active:true});
  expect((await db.query("SELECT coalesce(current_setting('app.register_branch',true),'off')='on' leaked")).rows[0].leaked).toBe(false);
 });
 it('makes repeated completion idempotent without elevating existing accounts',async()=>{
  const before=await counts();const r=await signup(owner,true);expect(r.error).toBeUndefined();expect(r.rows[0].r).toMatchObject({success:true,already_completed:true,organization_id:organization,branch_id:branch});expect(await counts()).toEqual(before);
  const staff=await signup(ids.users.cashier);expect(staff.error).toBe('PROFILE_ALREADY_EXISTS');expect((await db.query('SELECT role FROM public.users WHERE id=$1',[ids.users.cashier])).rows[0].role).toBe('cashier');
 });
 it('keeps the new owner outside every pre-existing institution and platform settings',async()=>{
  const access=await runAs(db,owner,'SELECT public.user_may_access_branch($1) own,public.user_may_access_branch($2) a,public.user_may_access_branch($3) b,public.is_pos_admin() platform,public.subscription_is_active($4) subscribed',[branch,ids.branchA,ids.branchB,organization]);expect(access.error).toBeUndefined();expect(access.rows[0]).toEqual({own:true,a:false,b:false,platform:false,subscribed:true});
  expect((await runAs(db,owner,'SELECT id FROM public.organizations')).rows).toEqual([{id:organization}]);
  expect((await runAs(db,owner,'SELECT id FROM public.products WHERE branch_id=ANY($1)',[[ids.branchA,ids.branchB]])).rows).toEqual([]);
  expect((await runAs(db,owner,'SELECT id FROM public.system_settings')).rows).toEqual([]);
  expect((await runAs(db,owner,'SELECT public.set_public_tenant_registration_enabled(false)')).error).toBe('PERMISSION_DENIED');
 });
 it('rejects membership reassignment, self promotion and unrelated member attachment',async()=>{
  expect((await runAs(db,owner,'UPDATE public.organization_members SET organization_id=$1 WHERE user_id=$2',[otherOrganization,owner])).error).toBe('MEMBERSHIP_BINDING_IMMUTABLE');
  expect((await runAs(db,owner,"UPDATE public.organization_members SET membership_role='admin' WHERE user_id=$1",[owner])).error).toBe('MEMBERSHIP_BINDING_IMMUTABLE');
  expect((await runAs(db,owner,"INSERT INTO public.organization_members(organization_id,user_id,membership_role) VALUES($1,$2,'member')",[organization,ids.users.cashier])).error).toBe('MEMBERSHIP_BRANCH_MISMATCH');
 });
 it('rejects unconfirmed and anonymous identities, preserving privileged legacy RPC closure',async()=>{
  const unconfirmed=await identity(false);const before=await counts();expect((await signup(unconfirmed)).error).toBe('EMAIL_CONFIRMATION_REQUIRED');expect(await counts()).toEqual(before);
  expect((await db.query("SELECT has_function_privilege('anon','public.complete_own_organization_signup(text,text,text)','execute') bootstrap,has_function_privilege('anon','public.register_tenant(text,text,text,text,text,text,text,text)','execute') legacy")).rows[0]).toEqual({bootstrap:false,legacy:false});
 });
 it('rolls back every partial profile/organization and permits retry after a downstream failure',async()=>{
  const id=await identity();const before=await counts();await db.query('SAVEPOINT failure_injection');
  try{
   await db.query(`CREATE FUNCTION private.qa_signup_subscription_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA_SIGNUP_ROLLBACK'; END $$; CREATE TRIGGER qa_signup_subscription_failure BEFORE INSERT ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION private.qa_signup_subscription_failure()`);
   expect((await signup(id)).error).toBe('QA_SIGNUP_ROLLBACK');expect(await counts()).toEqual(before);expect((await db.query('SELECT id FROM public.users WHERE id=$1',[id])).rows).toHaveLength(0);
   expect((await db.query("SELECT coalesce(current_setting('app.register_branch',true),'off')='on' leaked")).rows[0].leaked).toBe(false);
  }finally{await db.query('ROLLBACK TO SAVEPOINT failure_injection');}
  expect((await signup(id,true)).rows[0].r).toMatchObject({success:true});
 });
 it('uses a separate administrator-controlled public flag without changing staff creation',async()=>{
  const id=await identity();const staffBefore=(await db.query("SELECT config#>'{security,allow_new_user_creation}' setting FROM public.system_settings WHERE id=1")).rows[0].setting;
  expect((await runAsPersist(db,ids.users.super_admin,'SELECT public.set_public_tenant_registration_enabled(false) r')).error).toBeUndefined();
  expect((await signup(id)).error).toBe('PUBLIC_REGISTRATION_DISABLED');
  expect((await db.query("SELECT config#>'{security,allow_new_user_creation}' setting FROM public.system_settings WHERE id=1")).rows[0].setting).toEqual(staffBefore);
  expect((await runAsPersist(db,ids.users.super_admin,'SELECT public.set_public_tenant_registration_enabled(true) r')).rows[0].r).toMatchObject({success:true,enabled:true});
 });
});
