import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, runAsPersist, type RlsIds } from './rls';
import { buildKitchenFixedTemplate } from '@/features/pos/services/localPrintAgent';
import type { KitchenSendItem } from '@/features/pos/types';

const url = getDbUrl();
const local = Boolean(url) && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
const sqlPath = 'scripts/experiments/kitchen_atomic_print_handoff_PROPOSAL_20261014.sql';

describe.skipIf(!local)('staged atomic kitchen print handoff (ROLLBACK ONLY)', () => {
  let db: pg.Client;
  let ids: RlsIds;
  const one = randomUUID(), two = randomUUID();
  const sendOne = randomUUID(), sendTwo = randomUUID();
  const sent = {
    success: true, order_number: 'TEST-PAPER-NOT-PRINTED', order_type: 'dine_in',
    table_name: 'T1', guest_count: 2, items_sent_count: 2,
    sent: [
      { send_id: sendTwo, order_item_id: two, product_name: 'Tea', station_code: 'بار',
        quantity: 1, current_quantity: 1, notes: null, modifiers: [] },
      { send_id: sendOne, order_item_id: one, product_name: 'Coffee', station_code: 'بار',
        quantity: 2, current_quantity: 2, notes: 'بدون سكر',
        modifiers: [{ option_name: 'لبن' }] },
    ],
  };

  beforeAll(async () => {
    db = openDb(url!);
    await db.connect();
    await db.query('BEGIN');
    ids = await seedRlsFixture(db);
    const stations = await db.query<{ id: string; code: string }>(
      "INSERT INTO public.kitchen_stations(branch_id,code,name_ar,name_en,is_active) VALUES ($1,'بار','بار','Bar',true),($1,'kit','مطبخ','Kitchen',true) RETURNING id,code",
      [ids.branchA],
    );
    const bar = stations.rows.find((row) => row.code === 'بار')?.id;
    expect(bar).toBeTruthy();
    await db.query('UPDATE public.categories SET kitchen_station_id=$1 WHERE id=$2', [bar, ids.catA]);
    await db.query('UPDATE public.products SET category_id=$1 WHERE id=$2', [ids.catA, ids.prodA]);
    // Rollback-only experiment. Never touch the production database.
    await db.query(readFileSync(sqlPath, 'utf8'));
  });
  afterAll(async () => {
    if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
  });

  async function enqueue(branch: string, order: string, body: object = sent) {
    return (await db.query(
      'SELECT private._enqueue_kitchen_sent_delta($1,$2,$3,$4::jsonb) n',
      [branch, order, ids.users.cashier, JSON.stringify(body)],
    )).rows[0].n as number;
  }

  it('preserves the original kitchen send and exposes only an opt-in print RPC', async () => {
    const r = await db.query(
      "SELECT oid::regprocedure::text name,prosecdef,proconfig FROM pg_proc WHERE oid='public.send_to_kitchen(uuid,uuid)'::regprocedure",
    );
    expect(r.rows[0].prosecdef).toBe(true);
    expect(r.rows[0].name).toContain('send_to_kitchen(uuid,uuid)');
    expect(r.rows[0].proconfig).toContain('search_path=public, pg_temp');
    const body = (await db.query(
      "SELECT prosrc FROM pg_proc WHERE oid='public.send_to_kitchen(uuid,uuid)'::regprocedure",
    )).rows[0].prosrc as string;
    expect(body).toContain('_send_to_kitchen_core_20260914');
    expect(body).not.toContain('PERFORM private._enqueue_kitchen_sent_delta');
    const opt = (await db.query(
      "SELECT prosrc,prosecdef FROM pg_proc WHERE oid='public.send_to_kitchen_with_print(uuid,uuid,boolean)'::regprocedure",
    )).rows[0];
    expect(opt.prosecdef).toBe(true);
    expect(opt.prosrc).toContain('public.send_to_kitchen(p_order_id,p_sent_by)');
    expect(opt.prosrc).toContain("print_queue_state','client_fallback'");
  });

  it('queues one formatted durable station ticket and never duplicates its identity on retry', async () => {
    const order = ids.rows.orders.own;
    expect(await enqueue(ids.branchA, order)).toBe(1);
    expect(await enqueue(ids.branchA, order)).toBe(1);
    const jobs = (await db.query(
      "SELECT idempotency_key,branch_id,station_code,payload,status FROM public.cloud_print_jobs WHERE payload->>'order_id'=$1",
      [order],
    )).rows;
    expect(jobs).toHaveLength(1);
    const expectedKey = 'kitchen:بار:' + [sendOne + ':2', sendTwo + ':1'].sort().join(',');
    expect(jobs[0].idempotency_key).toBe(expectedKey);
    expect(jobs[0].branch_id).toBe(ids.branchA);
    expect(jobs[0].station_code).toBe('بار');
    expect(jobs[0].payload.template.kind).toBe('kitchen');
    expect(jobs[0].payload.template.items).toHaveLength(2);
    expect(jobs[0].payload.text).toContain('بدون سكر');
    expect(jobs[0].payload.text).toContain('Coffee');
    expect(jobs[0].payload.text).toContain('ملاحظة: بدون سكر');
    const frontend = buildKitchenFixedTemplate(
      'بار', sent.sent as unknown as KitchenSendItem[],
      { orderId: order, orderNumber: sent.order_number,
        tableName: sent.table_name, orderType: sent.order_type,
        guestCount: sent.guest_count, isAr: true },
    );
    // Timestamps may cross a minute while this test runs; every other printed
    // field must match the existing frontend formatter exactly.
    const normalize = (value: typeof frontend) => ({
      ...value,
      meta: value.meta.map((row) => row.label === 'التاريخ'
        ? { ...row, value: '<current-time>' } : row),
    });
    expect(normalize(jobs[0].payload.template)).toEqual(normalize(frontend));
  });

  it('rejects wrong-branch ticket injection and leaves no foreign queue row', async () => {
    await db.query('SAVEPOINT reject_wrong_branch');
    try {
      await expect(enqueue(ids.branchB, ids.rows.orders.own)).rejects.toThrow(/KITCHEN_PRINT_ORDER_BRANCH_MISMATCH/);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT reject_wrong_branch');
    }
    const n = (await db.query(
      "SELECT count(*)::int n FROM public.cloud_print_jobs WHERE branch_id=$1 AND payload->>'order_id'=$2",
      [ids.branchB, ids.rows.orders.own],
    )).rows[0].n;
    expect(n).toBe(0);
  });


  it('rejects a missing or unconfigured station without silently losing that item', async () => {
    const order = ids.rows.orders.own;
    await db.query('SAVEPOINT missing_station');
    try {
      await expect(enqueue(ids.branchA, order, {
        ...sent, sent: [{ ...sent.sent[0], station_code: null }],
      })).rejects.toThrow(/KITCHEN_PRINT_STATION_MISSING/);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT missing_station');
    }
    await db.query('SAVEPOINT inactive_station');
    try {
      await expect(enqueue(ids.branchA, order, {
        ...sent, sent: [{ ...sent.sent[0], station_code: 'not-configured' }],
      })).rejects.toThrow(/KITCHEN_PRINT_STATION_BRANCH_OR_ACTIVE_MISMATCH/);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT inactive_station');
    }
  });

  it('makes one idempotent job for each new station without reusing another station ticket', async () => {
    const order = ids.rows.orders.own;
    const split = { ...sent, sent: [
      { ...sent.sent[0], station_code: 'kit' },
      { ...sent.sent[1], station_code: 'بار' },
    ] };
    expect(await enqueue(ids.branchA, order, split)).toBe(2);
    expect(await enqueue(ids.branchA, order, split)).toBe(2);
    const barKey = 'kitchen:بار:' + sendOne + ':2';
    const kitKey = 'kitchen:kit:' + sendTwo + ':1';
    const jobs = (await db.query(
      'SELECT idempotency_key,station_code,payload FROM public.cloud_print_jobs WHERE branch_id=$1 AND idempotency_key=ANY($2::text[]) ORDER BY station_code',
      [ids.branchA, [barKey, kitKey]],
    )).rows;
    expect(jobs).toHaveLength(2);
    expect(jobs.map((row) => row.idempotency_key).sort()).toEqual([barKey, kitKey].sort());
    expect(jobs.every((row) => row.payload.template.items.length === 1)).toBe(true);
  });

  it('does not expose the privileged helper to an authenticated caller', async () => {
    await db.query('SAVEPOINT direct_call');
    try {
      await db.query("SELECT set_config('app.user_id',$1,true)", [ids.users.cashier]);
      await db.query('SET LOCAL ROLE authenticated');
      await expect(db.query(
        'SELECT private._enqueue_kitchen_sent_delta($1,$2,$3,$4::jsonb)',
        [ids.branchA, ids.rows.orders.own, ids.users.cashier, JSON.stringify(sent)],
      )).rejects.toThrow(/permission denied/i);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT direct_call');
    }
  });


  it('the real send_to_kitchen RPC atomically creates one durable ticket and a repeat does not resubmit', async () => {
    await db.query('SAVEPOINT real_kitchen_send');
    try {
      const order = ids.rows.orders.own;
      const first = await runAsPersist(db, ids.users.cashier,
        'SELECT public.send_to_kitchen_with_print($1,NULL,true) r', [order]);
      expect(first.error).toBeUndefined();
      const result = first.rows[0].r as {
        success: boolean; error?: string; items_sent_count: number;
        sent: Array<{ send_id: string; current_quantity: number; station_code: string }>;
      };
      expect(result.success, JSON.stringify(result)).toBe(true);
      expect(result.items_sent_count).toBe(1);
      const exactKey = 'kitchen:' + result.sent[0].station_code + ':'
        + result.sent[0].send_id + ':' + Number(result.sent[0].current_quantity);
      const persisted = (await db.query(
        'SELECT kind,station_code,status,payload FROM public.cloud_print_jobs WHERE branch_id=$1 AND idempotency_key=$2',
        [ids.branchA, exactKey],
      )).rows;
      expect(persisted).toHaveLength(1);
      expect(persisted[0].kind).toBe('kitchen');
      expect(persisted[0].payload.order_id).toBe(order);
      const again = await runAsPersist(db, ids.users.cashier,
        'SELECT public.send_to_kitchen_with_print($1,NULL,true) r', [order]);
      expect(again.error).toBeUndefined();
      expect((again.rows[0].r as { items_sent_count: number }).items_sent_count).toBe(0);
      expect((await db.query(
        'SELECT count(*)::int n FROM public.cloud_print_jobs WHERE branch_id=$1 AND idempotency_key=$2',
        [ids.branchA, exactKey],
      )).rows[0].n).toBe(1);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT real_kitchen_send');
    }
  });

  it('a failed cloud enqueue rolls back the real kitchen send and does not deduct stock', async () => {
    await db.query('SAVEPOINT failed_print_handoff');
    try {
      await db.query(`CREATE FUNCTION pg_temp.fail_atomic_print_test()
        RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''SIMULATED_PRINT_QUEUE_FAILURE''; END'`);
      await db.query(`CREATE TRIGGER test_atomic_print_failure
        BEFORE INSERT ON public.cloud_print_jobs FOR EACH ROW
        EXECUTE FUNCTION pg_temp.fail_atomic_print_test()`);
      const order = ids.rows.orders.own;
      const send = await runAsPersist(db, ids.users.cashier,
        'SELECT public.send_to_kitchen_with_print($1,NULL,true) r', [order]);
      expect(send.error).toBeUndefined();
      const result = send.rows[0].r as {
        success: boolean; print_queue_state: string; print_queue_warning?: string;
      };
      expect(result.success).toBe(true);
      expect(result.print_queue_state).toBe('client_fallback');
      expect(result.print_queue_warning).toBe('DURABLE_KITCHEN_PRINT_ENQUEUE_FAILED');
      // The print failure is isolated: kitchen consumption still commits inside
      // this test savepoint and legacy browser dispatch is still available.
      expect((await db.query(
        'SELECT count(*)::int n FROM public.order_kitchen_sends WHERE order_id=$1',
        [order],
      )).rows[0].n).toBe(1);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT failed_print_handoff');
    }
    expect((await db.query(
      'SELECT count(*)::int n FROM public.order_kitchen_sends WHERE order_id=$1',
      [ids.rows.orders.own],
    )).rows[0].n).toBe(0);
    expect((await db.query(
      'SELECT count(*)::int n FROM public.order_kitchen_inventory_events WHERE order_id=$1',
      [ids.rows.orders.own],
    )).rows[0].n).toBe(0);
  });

  it('leaves the canonical send path untouched and English tickets on existing browser dispatch', async () => {
    await db.query('SAVEPOINT english_client_only');
    try {
      const order = ids.rows.orders.own;
      const priorCount = (await db.query(
        "SELECT count(*)::int n FROM public.cloud_print_jobs WHERE kind='kitchen' AND payload->>'order_id'=$1",
        [order],
      )).rows[0].n as number;
      const english = await runAsPersist(db, ids.users.cashier,
        'SELECT public.send_to_kitchen_with_print($1,NULL,false) r', [order]);
      expect(english.error).toBeUndefined();
      expect((english.rows[0].r as { success: boolean }).success).toBe(true);
      expect((english.rows[0].r as { print_queue_state: string }).print_queue_state).toBe('client_only');
      expect((await db.query(
        "SELECT count(*)::int n FROM public.cloud_print_jobs WHERE kind='kitchen' AND payload->>'order_id'=$1",
        [order],
      )).rows[0].n).toBe(priorCount);
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT english_client_only');
    }
  });

  it('does not enqueue for a no-delta retry or fabricate prints for empty sends', async () => {
    expect(await enqueue(ids.branchA, ids.rows.orders.own, {
      success: true, items_sent_count: 0, sent: [],
    })).toBe(0);
  });
});
