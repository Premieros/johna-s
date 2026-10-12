import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

// This fixture COMMITS synthetic rows so two genuinely independent database
// sessions can see them. Restrict it to the disposable GitHub Actions DB;
// unlike the rollback-only single-connection tests, never run on any
// developer workstation or on a Supabase connection.
const dbUrl = getDbUrl();
let disposableCi = false;
try {
  const u = new URL(dbUrl || '');
  disposableCi = process.env.GITHUB_ACTIONS === 'true'
    && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    && ['postgres:', 'postgresql:'].includes(u.protocol)
    && !dbUrl?.includes('supabase.co')
    && !dbUrl?.includes('azzdesuowpdcoflmyezn');
} catch { /* skip outside an explicitly local CI PostgreSQL */ }

describe.skipIf(!disposableCi)('FIFO material-branch serialization — two real local DB sessions', () => {
  let admin: pg.Client;
  let a: pg.Client;
  let b: pg.Client;
  const branch = randomUUID();
  const wh = randomUUID();
  const raw1 = randomUUID();
  const raw2 = randomUUID();
  const sale = randomUUID();

  const remove = async (client: pg.Client, rawId: string, amount: number) => {
    const result = await client.query<{ r: { success: boolean; shortage?: number } }>(
      "SELECT public._raw_remove_fifo($1,$2,$3,$4,'sale','sale',$5,'REVIEW-CONCURRENT',NULL,false) AS r",
      [rawId, branch, wh, amount, sale],
    );
    return result.rows[0].r;
  };

  beforeAll(async () => {
    admin = openDb(dbUrl!);
    a = openDb(dbUrl!);
    b = openDb(dbUrl!);
    await Promise.all([admin.connect(), a.connect(), b.connect()]);

    // GitHub Actions postgres service is an isolated throwaway database.
    // These setup rows must be committed, otherwise session B cannot see them.
    await admin.query('INSERT INTO public.branches(id,name) VALUES($1,$2)',
      [branch, 'FIFO two-session lock review']);
    await admin.query(
      'INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,$2,$3,true,true)',
      [wh, 'FIFO lock warehouse', branch],
    );
    for (const [id, label] of [[raw1, 'A'], [raw2, 'B']]) {
      await admin.query(
        'INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active) VALUES($1,$2,$3,$4,7,true)',
        [id, 'CONC-' + randomUUID(), 'Lock raw ' + label, branch],
      );
    }
    await admin.query(
      "INSERT INTO public.sales(id,invoice_number,branch_id,warehouse_id,subtotal,total,paid_amount,payment_method,status,order_type) " +
      "VALUES($1::uuid,'CONC-'||($1::uuid)::text,$2,$3,100,100,100,'cash','completed','takeaway')",
      [sale, branch, wh],
    );
    for (const id of [raw1, raw2]) {
      const receipt = await admin.query<{ r: { success: boolean } }>(
        "SELECT public._raw_add($1,$2,$3,10,7,NULL,NULL,NULL,'opening','opening',NULL,'CONC-OPEN',NULL) AS r",
        [id, branch, wh],
      );
      expect(receipt.rows[0].r.success).toBe(true);
    }
  }, 30000);

  afterAll(async () => {
    for (const client of [a, b]) {
      if (client) await client.query('ROLLBACK').catch(() => {});
    }
    if (admin) {
      // Best-effort local fixture cleanup. This DB is discarded by CI.
      await admin.query('DELETE FROM public.inventory_ledger WHERE raw_material_id=ANY($1::uuid[])',
        [[raw1, raw2]]).catch(() => {});
      await admin.query('DELETE FROM public.raw_material_batches WHERE raw_material_id=ANY($1::uuid[])',
        [[raw1, raw2]]).catch(() => {});
      await admin.query('DELETE FROM public.raw_material_inventory WHERE raw_material_id=ANY($1::uuid[])',
        [[raw1, raw2]]).catch(() => {});
      await admin.query('DELETE FROM public.sales WHERE id=$1', [sale]).catch(() => {});
      await admin.query('DELETE FROM public.raw_materials WHERE id=ANY($1::uuid[])',
        [[raw1, raw2]]).catch(() => {});
      await admin.query('DELETE FROM public.warehouses WHERE id=$1', [wh]).catch(() => {});
      await admin.query('DELETE FROM public.branches WHERE id=$1', [branch]).catch(() => {});
    }
    await Promise.all([a, b, admin].filter(Boolean).map(c => c.end().catch(() => {})));
  });

  it('blocks same material but not another material in same branch; retries after commit without double stock loss', async () => {
    await a.query('BEGIN');
    const first = await remove(a, raw1, 3);
    expect(first.success).toBe(true);

    await b.query('BEGIN');
    const unavailable = await b.query<{ available: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0)) AS available",
      [raw1, branch],
    );
    expect(unavailable.rows[0].available).toBe(false);

    const independent = await b.query<{ available: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0)) AS available",
      [raw2, branch],
    );
    expect(independent.rows[0].available).toBe(true);
    expect((await remove(b, raw2, 1)).success).toBe(true);
    await b.query('COMMIT');

    await b.query('BEGIN');
    await b.query("SET LOCAL lock_timeout='200ms'");
    await expect(remove(b, raw1, 4)).rejects.toMatchObject({ code: '55P03' });
    await b.query('ROLLBACK');

    // Once session A commits, session B can consume the remaining raw stock.
    await a.query('COMMIT');
    await b.query('BEGIN');
    expect((await remove(b, raw1, 4)).success).toBe(true);
    await b.query('COMMIT');

    const result = await admin.query<{
      raw_material_id: string; batches: string; official: string; removed: string; debt: string;
    }>(
      `SELECT rm.id::text AS raw_material_id,
         (SELECT coalesce(sum(quantity),0)::text FROM public.raw_material_batches bt
           WHERE bt.raw_material_id=rm.id AND bt.branch_id=$1 AND bt.warehouse_id=$2) batches,
         (SELECT quantity::text FROM public.raw_material_inventory s
           WHERE s.raw_material_id=rm.id AND s.branch_id=$1) official,
         (SELECT coalesce(sum(-quantity),0)::text FROM public.inventory_ledger l
           WHERE l.raw_material_id=rm.id AND l.branch_id=$1 AND l.quantity<0) removed,
         (SELECT count(*)::text FROM public.raw_fifo_debts d
           WHERE d.raw_material_id=rm.id) debt
       FROM public.raw_materials rm WHERE rm.id=ANY($3::uuid[]) ORDER BY rm.id`,
      [branch, wh, [raw1, raw2]],
    );
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      const isFirst = row.raw_material_id === raw1;
      expect(Number(row.batches)).toBe(isFirst ? 3 : 9);
      expect(Number(row.official)).toBe(isFirst ? 3 : 9);
      expect(Number(row.removed)).toBe(isFirst ? 7 : 1);
      expect(Number(row.debt)).toBe(0);
    }
    console.info('RAW_FIFO_2_SESSION_LOCAL', JSON.stringify({
      sameMaterialTryLock: false, otherMaterialTryLock: true,
      sameMaterialTimeoutCode: '55P03', finalBalances: { materialA: 3, materialB: 9 },
      caution: 'Proves existing lock contract in isolated CI, not p95 or staged-function concurrent throughput',
    }));
  }, 30000);
});
