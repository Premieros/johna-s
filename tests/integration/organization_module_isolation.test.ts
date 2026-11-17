import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const url=getDbUrl();
const local=!!url && ['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname);

describe.skipIf(!local)('per-organization module isolation and admin control', () => {
  let db: pg.Client;
  let ids: RlsIds;
  let orgA: string;
  let orgB: string;
  let featureKey: string;
  let canImp=false;
  beforeAll(async () => {
    db=openDb(url!);await db.connect();await db.query('BEGIN');
    ids=await seedRlsFixture(db);
    canImp=await canImpersonate(db);
    const q=await db.query<{id:string;organization_id:string}>(
      'SELECT id,organization_id FROM public.branches WHERE id=ANY($1::uuid[])',
      [[ids.branchA,ids.branchB]],
    );
    orgA=q.rows.find(x=>x.id===ids.branchA)!.organization_id;
    orgB=q.rows.find(x=>x.id===ids.branchB)!.organization_id;
    featureKey='org-module-'+randomUUID();
    await db.query(`INSERT INTO public.features(key,name,category,is_active,is_system)
      VALUES ($1,'Organization Test Module','management',true,false)`,[featureKey]);
  });
  afterAll(async () => {
    if(db){await db.query('ROLLBACK').catch(()=>{});await db.end();}
  });

  it('does not add any implicit module override and retains default allow',async () => {
    const r=await db.query(`SELECT (public.resolve_feature_access($1::uuid,NULL,$3,NULL)->>'allowed')::boolean a,
      (public.resolve_feature_access($2::uuid,NULL,$3,NULL)->>'allowed')::boolean b`,
      [orgA,orgB,featureKey]);
    expect(r.rows[0]).toMatchObject({a:true,b:true});
  });

  it('preserves a branch cashier\'s default feature access when no organization override exists',async () => {
    if(!canImp)return;
    const view=await runAs(db,ids.users.cashier,
      `SELECT public.get_feature_access($1,$2::uuid) result`,[featureKey,ids.branchA]);
    expect(view.rows[0].result).toMatchObject({allowed:true});
  });

  it('does not let a regular organization member or branch owner change another organization',async () => {
    if(!canImp)return;
    const res=await runAs(db,ids.users.owner,`SELECT public.super_admin_set_organization_module($1,$2,false) result`,
      [orgB,featureKey]);
    expect(res.rows[0].result).toMatchObject({success:false,error:'PERMISSION_DENIED'});
  });

  it('allows Super Admin to disable one organization only; reenable and reset',async () => {
    if(!canImp)return;
    const deny=await runAsPersist(db,ids.users.super_admin,
      'SELECT public.super_admin_set_organization_module($1,$2,false) result',[orgA,featureKey]);
    expect(deny.rows[0].result).toMatchObject({success:true});
    // The guarded resolver must deny orgA even with a direct SQL call;
    // a second org with no override must remain at legacy default.
    const states=await db.query(`SELECT
      (public.resolve_feature_access($1::uuid,NULL,$3,NULL)->>'allowed')::boolean a,
      (public.resolve_feature_access($2::uuid,NULL,$3,NULL)->>'allowed')::boolean b`,
      [orgA,orgB,featureKey]);
    expect(states.rows[0]).toMatchObject({a:false,b:true});
    const reset=await runAsPersist(db,ids.users.super_admin,
      'SELECT public.super_admin_reset_organization_module($1,$2) result',[orgA,featureKey]);
    expect(reset.rows[0].result).toMatchObject({success:true});
    const after=await db.query(`SELECT (public.resolve_feature_access($1::uuid,NULL,$2,NULL)->>'allowed')::boolean allowed`,
      [orgA,featureKey]);
    expect(after.rows[0].allowed).toBe(true);
  });

  it('enforces an explicitly disabled non-core module in central role permission checks',async () => {
    if(!canImp)return;
    const feature='tables';
    // The fixture owner has POS/table permissions. Ensure a known permission is present.
    await db.query(`UPDATE public.roles SET permissions=permissions || '["floor_plan.view"]'::jsonb WHERE role='owner'`);
    const baseline=await runAs(db,ids.users.owner,
      'SELECT public.can_permission($1) allowed',['floor_plan.view']);
    expect(baseline.rows[0].allowed).toBe(true);

    const deny=await runAsPersist(db,ids.users.super_admin,
      'SELECT public.super_admin_set_organization_module($1,$2,false) result',[orgA,feature]);
    expect(deny.rows[0].result).toMatchObject({success:true});
    const restricted=await runAs(db,ids.users.owner,
      'SELECT public.can_permission($1) allowed',['floor_plan.view']);
    expect(restricted.rows[0].allowed).toBe(false);
    const disabled=await runAs(db,ids.users.owner,
      'SELECT public.get_my_disabled_organization_modules() AS modules');
    expect(disabled.rows[0].modules).toContain(feature);

    const other=await runAs(db,ids.users.cashier_b,
      'SELECT public.get_my_disabled_organization_modules() AS modules');
    expect(other.rows[0].modules).not.toContain(feature);

    const reset=await runAsPersist(db,ids.users.super_admin,
      'SELECT public.super_admin_reset_organization_module($1,$2) result',[orgA,feature]);
    expect(reset.rows[0].result).toMatchObject({success:true});
    const restored=await runAs(db,ids.users.owner,
      'SELECT public.can_permission($1) allowed',['floor_plan.view']);
    expect(restored.rows[0].allowed).toBe(true);
  });

  it('keeps organization profile independent of other organization names',async () => {
    if(!canImp)return;
    const old=await db.query<{name:string}>('SELECT name FROM public.organizations WHERE id=$1',[orgB]);
    const res=await runAsPersist(db,ids.users.super_admin,
      `SELECT public.super_admin_set_organization_profile($1,'Org A Settings','012345','Test Address','','EGP') result`,
      [orgA]);
    expect(res.rows[0].result).toMatchObject({success:true});
    const other=await db.query<{name:string}>('SELECT name FROM public.organizations WHERE id=$1',[orgB]);
    expect(other.rows[0].name).toBe(old.rows[0].name);
    const data=await db.query('SELECT phone,currency FROM public.organization_settings WHERE organization_id=$1',[orgA]);
    expect(data.rows[0]).toMatchObject({phone:'012345',currency:'EGP'});
  });
});
