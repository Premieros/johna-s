import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('inventory ledger cached visibility context', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;

  const ledgerIds: Record<string, string> = {};

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);

    if (!imp) return;

    await client.query(
      `UPDATE public.roles
       SET permissions = permissions || '["inventory.ledger.view"]'::jsonb
       WHERE role = 'cashier'`,
    );
    await client.query(
      `UPDATE public.roles
       SET permissions = permissions || '["inventory.ledger.view","settings.manage","history.unlimited"]'::jsonb
       WHERE role = 'branch_manager'`,
    );

    const visibility = await runAsPersist(
      client,
      ids.users.branch_manager,
      'SELECT public.update_financial_visibility_settings(7, 0) AS result',
    );
    expect(visibility.error).toBeUndefined();
    expect(visibility.rows[0].result).toMatchObject({
      success: true,
      recent_days: 7,
      historical_percent: 0,
    });

    // Referenced visibility follows the referenced financial row's timestamp,
    // not merely the timestamp copied onto the inventory ledger row.
    await client.query(
      `UPDATE public.sales
       SET created_at = now() - interval '30 days'
       WHERE id = $1`,
      [ids.saleA],
    );

    const insertLedger = async (params: {
      key: string;
      branchId: string;
      productId: string;
      warehouseId: string;
      createdAt: string;
      referenceType?: string | null;
      referenceId?: string | null;
    }) => {
      const result = await client.query<{ id: string }>(
        `INSERT INTO public.inventory_ledger (
           product_id,
           branch_id,
           warehouse_id,
           quantity,
           unit_cost,
           total_cost,
           entry_type,
           reference_type,
           reference_id,
           reference_number,
           created_at
         )
         VALUES ($1,$2,$3,1,10,10,'adjustment',$4,$5,$6,$7::timestamptz)
         RETURNING id::text AS id`,
        [
          params.productId,
          params.branchId,
          params.warehouseId,
          params.referenceType ?? null,
          params.referenceId ?? null,
          `PERF-${params.key}-${randomUUID()}`,
          params.createdAt,
        ],
      );
      ledgerIds[params.key] = result.rows[0].id;
    };

    await insertLedger({
      key: 'recent_fallback_a',
      branchId: ids.branchA,
      productId: ids.prodA,
      warehouseId: ids.whA,
      createdAt: new Date().toISOString(),
      referenceType: 'adjustment',
    });
    await insertLedger({
      key: 'old_fallback_a',
      branchId: ids.branchA,
      productId: ids.prodA,
      warehouseId: ids.whA,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      referenceType: 'adjustment',
    });
    await insertLedger({
      key: 'recent_fallback_b',
      branchId: ids.branchB,
      productId: ids.prodB,
      warehouseId: ids.whB,
      createdAt: new Date().toISOString(),
      referenceType: 'adjustment',
    });
    await insertLedger({
      key: 'recent_ledger_old_sale',
      branchId: ids.branchA,
      productId: ids.prodA,
      warehouseId: ids.whA,
      createdAt: new Date().toISOString(),
      referenceType: 'sale',
      referenceId: ids.saleA,
    });
    await insertLedger({
      key: 'old_ledger_recent_sale',
      branchId: ids.branchA,
      productId: ids.prodA,
      warehouseId: ids.whA,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      referenceType: 'sale',
      referenceId: ids.rows.sales.own,
    });
    await insertLedger({
      key: 'branch_a_ledger_branch_b_sale',
      branchId: ids.branchA,
      productId: ids.prodA,
      warehouseId: ids.whA,
      createdAt: new Date().toISOString(),
      referenceType: 'sale',
      referenceId: ids.saleB,
    });
    await insertLedger({
      key: 'missing_sale_reference',
      branchId: ids.branchA,
      productId: ids.prodA,
      warehouseId: ids.whA,
      createdAt: new Date().toISOString(),
      referenceType: 'sale',
      referenceId: randomUUID(),
    });
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  const guarded = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx: { skip?: () => unknown }) => {
      if (!imp) return typeof ctx.skip === 'function' ? ctx.skip() : undefined;
      await fn();
    });

  const searchAs = async (userId: string) => {
    const result = await runAs(
      client,
      userId,
      `SELECT id::text AS id
       FROM public.search_inventory_ledger(
         $1::uuid,
         NULL,
         NULL,
         NULL,
         NULL,
         NULL,
         51
       )`,
      [ids.branchA],
    );
    expect(result.error).toBeUndefined();
    return new Set(result.rows.map((row) => String(row.id)));
  };

  guarded('keeps limited users branch-scoped with recent rows fully visible', async () => {
    const visible = await searchAs(ids.users.cashier);

    expect(visible.has(ledgerIds.recent_fallback_a)).toBe(true);
    expect(visible.has(ledgerIds.old_fallback_a)).toBe(false);
    expect(visible.has(ledgerIds.recent_fallback_b)).toBe(false);
  });

  guarded('uses referenced financial-row visibility instead of ledger timestamp', async () => {
    const visible = await searchAs(ids.users.cashier);

    // Recent ledger row pointing at an old hidden sale stays hidden.
    expect(visible.has(ledgerIds.recent_ledger_old_sale)).toBe(false);

    // Old ledger row pointing at a recent sale stays visible.
    expect(visible.has(ledgerIds.old_ledger_recent_sale)).toBe(true);

    // A reference outside the caller's branch and a missing reference remain hidden.
    expect(visible.has(ledgerIds.branch_a_ledger_branch_b_sale)).toBe(false);
    expect(visible.has(ledgerIds.missing_sale_reference)).toBe(false);
  });

  guarded('history.unlimited bypasses historical sampling but not branch isolation', async () => {
    const visible = await searchAs(ids.users.branch_manager);

    expect(visible.has(ledgerIds.recent_fallback_a)).toBe(true);
    expect(visible.has(ledgerIds.old_fallback_a)).toBe(true);
    expect(visible.has(ledgerIds.recent_ledger_old_sale)).toBe(true);
    expect(visible.has(ledgerIds.old_ledger_recent_sale)).toBe(true);
    expect(visible.has(ledgerIds.branch_a_ledger_branch_b_sale)).toBe(false);
    expect(visible.has(ledgerIds.missing_sale_reference)).toBe(false);
  });

  guarded('Super Admin keeps the implicit cross-branch bypass but missing references fail closed', async () => {
    const visible = await searchAs(ids.users.super_admin);

    expect(visible.has(ledgerIds.branch_a_ledger_branch_b_sale)).toBe(true);
    expect(visible.has(ledgerIds.missing_sale_reference)).toBe(false);
  });
});
