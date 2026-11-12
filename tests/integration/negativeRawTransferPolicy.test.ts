import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';

// Only against owned local/CI PostgreSQL after canonical migrations.
// Never write to, or run approval RPCs against, production.
const url = getDbUrl();
let local = false;
try { local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname); }
catch { /* no CI database configured */ }

describe.skipIf(!local)('negative raw transfer policy installed on disposable PostgreSQL', () => {
  let client: pg.Client;
  beforeAll(async () => { client = openDb(url); await client.connect(); });
  afterAll(async () => { if (client) await client.end(); });

  it('the installed approval RPC accepts negative raw-source balance via FIFO debt', async () => {
    const { rows } = await client.query<{ definition: string }>(
      "SELECT pg_get_functiondef('public.approve_warehouse_transfer(uuid)'::regprocedure) AS definition",
    );
    const def = rows[0]?.definition || '';
    expect(def).toContain('TRANSFER_ALLOW_NEGATIVE_RAW_V1');
    expect(def).not.toContain("'INSUFFICIENT_RAW_STOCK'");
    const negativeCalls = def.match(/v_res := public\._raw_remove_fifo\([^;]+auth\.uid\(\), true\);/g) || [];
    expect(negativeCalls).toHaveLength(2);
    expect(negativeCalls.every(call => call.includes('v_transfer.from_warehouse_id'))).toBe(true);
    expect(def).toContain("'INSUFFICIENT_STOCK'"); // product policy unchanged
    expect(def).toContain("v_transfer.status <> 'pending'");
    expect(def).toContain('FOR UPDATE');
  });

  it('retains existing FIFO debt and receipt settlement definitions', async () => {
    const { rows } = await client.query<{ debt_table: string | null; fifo_function: string | null; settle_function: string | null }>(`
      SELECT to_regclass('public.raw_fifo_debts')::text debt_table,
             to_regprocedure('public._raw_remove_fifo(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean)')::text fifo_function,
             to_regprocedure('public._raw_fifo_settle_receipt(bigint,uuid,uuid)')::text settle_function
    `);
    expect(rows[0]?.debt_table).toBe('raw_fifo_debts');
    expect(rows[0]?.fifo_function).toBeTruthy();
    expect(rows[0]?.settle_function).toBeTruthy();
  });
});
