import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';
const url = getDbUrl();
const local = !!url && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
describe.skipIf(!local)('cashier areas — isolated localhost only', () => {
  let db: pg.Client; let ids: RlsIds; let areaA: string; let areaB: string; let tableA: string; let orderA: string;
  const run = async (actor: string, sql: string, args: unknown[] = []) => {
    const result = await runAsPersist(db, actor, sql, args);
    expect(result.error).toBeUndefined(); return result.rows[0]?.r as { success: boolean; error?: string; job_id: string; station_code?: string };
  };
  const save = (actor: string, branch: string, areas: string[], enabled = true) => run(actor,
    'select public.save_cashier_area_settings($1,$2,$3,$4) r', [branch, 'Outdoor cashier', enabled, areas]);
  beforeAll(async () => {
    db = openDb(url!); await db.connect(); await db.query('BEGIN'); ids = await seedRlsFixture(db);
    await db.query(`UPDATE public.roles SET permissions=permissions || '["settings.manage","pos.receipt.print","pos.reprint"]'::jsonb WHERE role='branch_manager'`);
    await db.query(`UPDATE public.roles SET permissions=permissions - 'settings.manage' WHERE role='cashier'`);
    areaA = (await db.query("insert into public.dining_areas(branch_id,name,is_default) values($1,'Outside',false) returning id", [ids.branchA])).rows[0].id;
    areaB = (await db.query("insert into public.dining_areas(branch_id,name,is_default) values($1,'Other',false) returning id", [ids.branchB])).rows[0].id;
    tableA = (await db.query("insert into public.dining_tables(branch_id,area_id,name) values($1,$2,'Outside 01') returning id", [ids.branchA, areaA])).rows[0].id;
    orderA = randomUUID();
    await db.query("insert into public.orders(id,branch_id,table_id,order_number,order_type,status,cashier_id) values($1,$2,$3,$4,'dine_in','open',$5)", [orderA, ids.branchA, tableA, `Cashier-${orderA}`, ids.users.branch_manager]);
    await db.query('update public.sales set table_id=$1 where id=$2', [tableA, ids.saleA]);
  }, 60000);
  afterAll(async () => { if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); } });
  it('defaults to cashier and rejects foreign areas/branches and unauthorized changes', async () => {
    expect(await run(ids.users.branch_manager, 'select public.resolve_cashier_area_station($1,$2) r', [ids.branchA, tableA])).toBe('cashier');
    expect(await save(ids.users.branch_manager, ids.branchA, [areaB])).toMatchObject({ success: false, error: 'INVALID_AREA' });
    expect(await save(ids.users.branch_manager, ids.branchB, [])).toMatchObject({ success: false, error: 'BRANCH_MISMATCH' });
    expect(await save(ids.users.cashier, ids.branchA, [areaA])).toMatchObject({ success: false, error: 'PERMISSION_DENIED' });
  });
  it('routes new open checks and sales from authoritative table area, ignoring forged payload routing', async () => {
    expect(await save(ids.users.branch_manager, ids.branchA, [areaA], false)).toMatchObject({ success: true });
    expect(await run(ids.users.branch_manager, 'select public.resolve_cashier_area_station($1,$2) r', [ids.branchA, tableA])).toBe('cashier');
    expect(await save(ids.users.branch_manager, ids.branchA, [areaA])).toMatchObject({ success: true });
    const payload = { text: 'QA not a physical print', station_code: 'main', branch_id: ids.branchB, table_id: null };
    const open = await run(ids.users.branch_manager, 'select public.enqueue_cloud_open_order_print($1,$2,$3) r', [orderA, payload, `open-check:${orderA}:test`]);
    expect(open).toMatchObject({ success: true, station_code: 'cashier_2' });
    const sale = await run(ids.users.branch_manager, 'select public.enqueue_cloud_receipt_print($1,null,$2,$3) r', [ids.saleA, payload, `cashier-sale:${ids.saleA}`]);
    expect(sale.success).toBe(true);
    const jobs = await db.query('select station_code,branch_id from public.cloud_print_jobs where id=ANY($1::uuid[])', [[open.job_id, sale.job_id]]);
    expect(jobs.rows).toHaveLength(2);
    for (const job of jobs.rows) expect(job).toEqual({ station_code: 'cashier_2', branch_id: ids.branchA });
    // Existing active job destination stays fixed after config changes; no replay.
    expect(await save(ids.users.branch_manager, ids.branchA, [], false)).toMatchObject({ success: true });
    const again = await run(ids.users.branch_manager, 'select public.enqueue_cloud_receipt_print($1,null,$2,$3) r', [ids.saleA, payload, `cashier-sale:${ids.saleA}`]);
    expect(again.job_id).toBe(sale.job_id);
    expect((await db.query('select station_code from public.cloud_print_jobs where id=$1', [sale.job_id])).rows[0].station_code).toBe('cashier_2');
  });
  it('enforces RLS against direct cross-branch mapping writes and unprivileged station writes', async () => {
    const foreign = await runAs(db, ids.users.branch_manager,
      'insert into public.cashier_area_routes(area_id,branch_id) values($1,$2)', [areaB, ids.branchA]);
    expect(foreign.error).toMatch(/row-level security/i);
    const denied = await runAs(db, ids.users.cashier,
      'update public.cashier_print_stations set enabled=false where branch_id=$1', [ids.branchA]);
    expect(denied.rowCount).toBe(0);
    const hidden = await runAs(db, ids.users.cashier_b,
      'select * from public.cashier_print_stations where branch_id=$1', [ids.branchA]);
    expect(hidden.rows).toHaveLength(0);
  });
  it('keeps no-table/other-branch fallback and report destination at primary cashier', async () => {
    expect(await save(ids.users.branch_manager, ids.branchA, [areaA])).toMatchObject({ success: true });
    for (const [branch, table] of [[ids.branchA, null], [ids.branchB, tableA]])
      expect(await run(ids.users.super_admin, 'select public.resolve_cashier_area_station($1,$2) r', [branch, table])).toBe('cashier');
    const report = await run(ids.users.branch_manager, 'select public.enqueue_cloud_report_print($1,$2,$3) r', [ids.branchA, { text: 'Z summary' }, `report:${randomUUID()}`]);
    expect(report.success).toBe(true);
    expect((await db.query('select station_code from public.cloud_print_jobs where id=$1', [report.job_id])).rows[0].station_code).toBe('cashier');
    const row = (await db.query("select prosecdef,has_function_privilege('anon',oid,'execute') anon from pg_proc where oid='public.save_cashier_area_settings(uuid,text,boolean,uuid[])'::regprocedure")).rows[0];
    expect(row).toEqual({ prosecdef: false, anon: false });
  });
});
