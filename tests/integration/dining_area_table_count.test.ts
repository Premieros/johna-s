import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';
const url = getDbUrl();
const local = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('atomic dining area with table count — owned localhost only', () => {
  let db: pg.Client;
  let ids: RlsIds;
  const call = async (actor: string, branch: string, name: string, count: number) => {
    await db.query('SAVEPOINT area_call');
    const result = await runAsPersist(db, actor, 'select public.floor_plan_create_area_with_tables($1,$2,$3) as r', [branch, name, count]);
    if (result.error) await db.query('ROLLBACK TO area_call');
    await db.query('RELEASE area_call');
    return { result: result.rows[0]?.r as { success: boolean; error?: string; area_id?: string; table_count?: number } | undefined, error: result.error };
  };
  beforeAll(async () => {
    db = openDb(url!); await db.connect(); await db.query('BEGIN');
    expect(await canImpersonate(db)).toBe(true);
    ids = await seedRlsFixture(db);
    await db.query(`UPDATE public.roles SET permissions=permissions || '["floor_plan.manage"]'::jsonb WHERE role='branch_manager'`);
    await db.query(`UPDATE public.roles SET permissions=permissions - 'floor_plan.manage' WHERE role='cashier'`);
  }, 60000);
  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); } });
  it.each([0, 1, 100])('creates an area and exactly %i tables without changing Main Area', async count => {
    const before = (await db.query('select jsonb_agg(to_jsonb(t) order by t.id) as rows from public.dining_tables t join public.dining_areas a on a.id=t.area_id where t.branch_id=$1 and a.is_default', [ids.branchA])).rows;
    const name = `Count-${count}`;
    const response = await call(ids.users.branch_manager, ids.branchA, name, count);
    expect(response.error).toBeUndefined();
    expect(response.result).toMatchObject({ success: true, table_count: count });
    const tables = await db.query('select name,branch_id,is_active,status from public.dining_tables where area_id=$1 order by name', [response.result!.area_id]);
    expect(tables.rows).toHaveLength(count);
    expect(new Set(tables.rows.map(t => t.name)).size).toBe(count);
    for (const table of tables.rows) expect(table).toMatchObject({ branch_id: ids.branchA, is_active: true, status: 'vacant' });
    if (count === 100) expect(tables.rows.some(t => t.name === `${name} / Table 100`)).toBe(true);
    expect((await db.query('select jsonb_agg(to_jsonb(t) order by t.id) as rows from public.dining_tables t join public.dining_areas a on a.id=t.area_id where t.branch_id=$1 and a.is_default', [ids.branchA])).rows).toEqual(before);
  });
  it('creates independently in the second branch and rejects unauthorized branch/configuration calls', async () => {
    expect((await call(ids.users.super_admin, ids.branchB, 'Second-branch', 2)).result?.success).toBe(true);
    expect((await call(ids.users.branch_manager, ids.branchB, 'Forbidden', 2)).result).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
    expect((await call(ids.users.cashier, ids.branchA, 'No permission', 2)).result).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
    for (const count of [-1, 101]) expect((await call(ids.users.branch_manager, ids.branchA, 'Invalid', count)).result).toMatchObject({ success: false, error: 'INVALID_AREA_TABLE_COUNT' });
    expect((await call(ids.users.branch_manager, ids.branchA, '   ', 1)).result).toMatchObject({ success: false, error: 'INVALID_AREA_NAME' });
    expect((await call(ids.users.branch_manager, ids.branchA, 'count-1', 1)).result).toMatchObject({ success: false, error: 'AREA_NAME_EXISTS' });
  });
  it('rolls back the new area and earlier tables if a later table name collides', async () => {
    const name = 'Atomic-' + randomUUID();
    const area = (await db.query("insert into public.dining_areas(branch_id,name,is_default) values($1,'Existing custom',false) returning id", [ids.branchA])).rows[0].id;
    await db.query("insert into public.dining_tables(branch_id,area_id,name) values($1,$2,$3)", [ids.branchA, area, `${name} / Table 02`]);
    const response = await call(ids.users.branch_manager, ids.branchA, name, 3);
    expect(response.error).toBe('AREA_TABLE_CREATE_FAILED');
    expect((await db.query('select id from public.dining_areas where branch_id=$1 and name=$2', [ids.branchA, name])).rows).toHaveLength(0);
    expect((await db.query('select id from public.dining_tables where branch_id=$1 and name=$2', [ids.branchA, `${name} / Table 01`])).rows).toHaveLength(0);
  });
  it('keeps the wrapper invoker-only and does not grant anonymous execution', async () => {
    const row = (await db.query("select p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p where p.oid='public.floor_plan_create_area_with_tables(uuid,text,integer)'::regprocedure")).rows[0];
    expect(row).toEqual({ prosecdef: false, anon: false });
  });
});
