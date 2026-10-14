import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';

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
    // Rollback-only experiment. Never touch the production database.
    await db.query(readFileSync(sqlPath, 'utf8'));
  });
  afterAll(async () => {
    if (db) { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
  });

  async function enqueue(branch: string, order: string, body = sent) {
    return (await db.query(
      'SELECT private._enqueue_kitchen_sent_delta($1,$2,$3,$4::jsonb) n',
      [branch, order, ids.users.cashier, JSON.stringify(body)],
    )).rows[0].n as number;
  }

  it('preserves the production kitchen send signature and security metadata', async () => {
    const r = await db.query(
      "SELECT oid::regprocedure::text name,prosecdef,proconfig FROM pg_proc WHERE oid='public.send_to_kitchen(uuid,uuid)'::regprocedure",
    );
    expect(r.rows[0].prosecdef).toBe(true);
    expect(r.rows[0].name).toContain('send_to_kitchen(uuid,uuid)');
    expect(r.rows[0].proconfig).toContain('search_path=public, pg_temp');
    const body = (await db.query(
      "SELECT prosrc FROM pg_proc WHERE oid='public.send_to_kitchen(uuid,uuid)'::regprocedure",
    )).rows[0].prosrc as string;
    expect(body.indexOf('_send_to_kitchen_core_20260914')).toBeLessThan(
      body.indexOf('PERFORM private._enqueue_kitchen_sent_delta'),
    );
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

  it('does not enqueue for a no-delta retry or fabricate prints for empty sends', async () => {
    expect(await enqueue(ids.branchA, ids.rows.orders.own, {
      success: true, items_sent_count: 0, sent: [],
    } as typeof sent)).toBe(0);
  });
});
