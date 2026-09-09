import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

type RpcResult = {
  success?: boolean;
  error?: string;
  detail?: string;
  order_id?: string;
  order_number?: string;
  service_details?: Record<string, unknown>;
};

describe.skipIf(skip)('Delivery / Drive-Thru structured service contract', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let impersonationAvailable = false;
  const productId = randomUUID();

  const rpc = async (userId: string, sql: string, params: unknown[] = []): Promise<RpcResult> => {
    const result = await runAsPersist(client, userId, sql, params);
    if (result.error) throw new Error(result.error);
    return (result.rows[0]?.r || {}) as RpcResult;
  };

  const itemRows = () => JSON.stringify([{
    product_id: productId,
    unit_name: 'piece',
    quantity: 1,
    unit_price: 20,
    discount_amount: 0,
    bonus_quantity: 0,
    total: 20,
  }]);

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    impersonationAvailable = await canImpersonate(client);

    await client.query(
      `INSERT INTO public.products (id, name, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, 'Service contract product', $2, 10, 20, true)`,
      [productId, ids.branchA],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });

  it('creates delivery with structured phone/address and keeps readable notes separate', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const details = { phone: '01000000000', address: 'Alexandria - Smouha', note: 'Call on arrival' };
    const created = await rpc(
      ids.users.cashier,
      `SELECT public.create_service_order(
        $1, 'delivery', NULL, NULL, NULL, $2, $3::jsonb,
        20, 0, 'amount', 0, 20, $4, $5::jsonb
      ) AS r`,
      [ids.branchA, 'Readable delivery note', itemRows(), ids.users.cashier, JSON.stringify(details)],
    );

    expect(created.success, JSON.stringify(created)).toBe(true);
    expect(created.order_id).toBeTruthy();

    const row = await client.query<{ order_type: string; notes: string | null; service_details: Record<string, string> }>(
      `SELECT order_type, notes, service_details FROM public.orders WHERE id = $1`,
      [created.order_id],
    );
    expect(row.rows[0].order_type).toBe('delivery');
    expect(row.rows[0].notes).toBe('Readable delivery note');
    expect(row.rows[0].service_details).toEqual(details);
  });

  it('preserves existing delivery details when a resumed order is updated without a new draft', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const details = { phone: '01111111111', address: 'Alexandria - Miami' };
    const created = await rpc(
      ids.users.cashier,
      `SELECT public.create_service_order(
        $1, 'delivery', NULL, NULL, NULL, NULL, $2::jsonb,
        20, 0, 'amount', 0, 20, $3, $4::jsonb
      ) AS r`,
      [ids.branchA, itemRows(), ids.users.cashier, JSON.stringify(details)],
    );
    expect(created.success, JSON.stringify(created)).toBe(true);

    const updated = await rpc(
      ids.users.cashier,
      `SELECT public.update_service_order(
        $1, 'delivery', NULL, NULL, NULL, 'resumed note', $2::jsonb,
        20, 0, 'amount', 0, 20, 'held', NULL
      ) AS r`,
      [created.order_id, itemRows()],
    );
    expect(updated.success, JSON.stringify(updated)).toBe(true);

    const row = await client.query<{ status: string; notes: string | null; service_details: Record<string, string> }>(
      `SELECT status, notes, service_details FROM public.orders WHERE id = $1`,
      [created.order_id],
    );
    expect(row.rows[0].status).toBe('held');
    expect(row.rows[0].notes).toBe('resumed note');
    expect(row.rows[0].service_details).toEqual(details);
  });

  it('creates drive-thru with a structured vehicle identifier', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const details = { vehicle_identifier: 'س ب ج 1234', customer_name: 'Ahmed' };
    const created = await rpc(
      ids.users.cashier,
      `SELECT public.create_service_order(
        $1, 'drive_thru', NULL, NULL, 2, $2, $3::jsonb,
        20, 0, 'amount', 0, 20, $4, $5::jsonb
      ) AS r`,
      [ids.branchA, 'Vehicle readable note', itemRows(), ids.users.cashier, JSON.stringify(details)],
    );
    expect(created.success, JSON.stringify(created)).toBe(true);

    const row = await client.query<{ order_type: string; guest_count: number | null; service_details: Record<string, string> }>(
      `SELECT order_type, guest_count, service_details FROM public.orders WHERE id = $1`,
      [created.order_id],
    );
    expect(row.rows[0].order_type).toBe('drive_thru');
    expect(row.rows[0].guest_count).toBe(2);
    expect(row.rows[0].service_details).toEqual(details);
  });

  it('rejects incomplete service metadata and cross-branch service creation', async (ctx) => {
    if (!impersonationAvailable) return ctx.skip();

    const missingAddress = await rpc(
      ids.users.cashier,
      `SELECT public.create_service_order(
        $1, 'delivery', NULL, NULL, NULL, NULL, $2::jsonb,
        20, 0, 'amount', 0, 20, $3, $4::jsonb
      ) AS r`,
      [ids.branchA, itemRows(), ids.users.cashier, JSON.stringify({ phone: '01222222222' })],
    );
    expect(missingAddress.success).toBe(false);
    expect(missingAddress.error).toBe('DELIVERY_ADDRESS_REQUIRED');

    const crossBranch = await rpc(
      ids.users.cashier,
      `SELECT public.create_service_order(
        $1, 'delivery', NULL, NULL, NULL, NULL, $2::jsonb,
        20, 0, 'amount', 0, 20, $3, $4::jsonb
      ) AS r`,
      [ids.branchB, itemRows(), ids.users.cashier, JSON.stringify({ phone: '01222222222', address: 'Other branch' })],
    );
    expect(crossBranch.success).toBe(false);
    expect(crossBranch.error).toBe('BRANCH_MISMATCH');
  });

  it('keeps service wrappers unavailable to anon', async () => {
    const privileges = await client.query<{ create_allowed: boolean; update_allowed: boolean }>(
      `SELECT
         has_function_privilege('anon', 'public.create_service_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,uuid,jsonb)', 'EXECUTE') AS create_allowed,
         has_function_privilege('anon', 'public.update_service_order(uuid,text,uuid,uuid,integer,text,jsonb,numeric,numeric,text,numeric,numeric,text,jsonb)', 'EXECUTE') AS update_allowed`,
    );
    expect(privileges.rows[0].create_allowed).toBe(false);
    expect(privileges.rows[0].update_allowed).toBe(false);
  });
});
