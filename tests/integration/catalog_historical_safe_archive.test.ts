import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('catalog historical-safe archive', () => {
  let client: pg.Client;
  const orgId = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const managerUser = randomUUID();
  const branchBUser = randomUUID();
  const productUsed = randomUUID();
  const productUnused = randomUUID();
  const rawTarget = randomUUID();
  const rawKeep = randomUUID();
  const rawUnused = randomUUID();
  const rawBranchB = randomUUID();
  const recipeV1 = randomUUID();
  const saleId = randomUUID();
  const purchaseId = randomUUID();
  const rawMovementId = randomUUID();

  async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);

    await client.query(
      `INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`,
      [orgId, 'Archive Regression Org', `archive-${randomUUID().slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.branches (id, name, organization_id) VALUES ($1, 'Archive A', $3), ($2, 'Archive B', $3)`,
      [branchA, branchB, orgId],
    );
    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, is_active)
       VALUES ('archive_manager', 'Archive Manager', 'Archive Manager', $1::jsonb, true)
       ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions, is_active = true`,
      [JSON.stringify(['raw_materials.manage', 'products.delete', 'recipes.manage'])],
    );
    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Archive Manager A', 'archive_manager', $3, true),
              ($4, $5, 'Archive Manager B', 'archive_manager', $6, true)`,
      [
        managerUser,
        `${randomUUID()}@test.local`,
        branchA,
        branchBUser,
        `${randomUUID()}@test.local`,
        branchB,
      ],
    );

    await client.query(
      `INSERT INTO public.products (id, name, branch_id, is_active, product_type, sale_price)
       VALUES ($1, 'Used Product', $3, true, 'ready', 25),
              ($2, 'Unused Product', $3, true, 'ready', 10)`,
      [productUsed, productUnused, branchA],
    );
    await client.query(
      `INSERT INTO public.raw_materials (id, code, name, branch_id, is_active)
       VALUES ($1, $2, 'Target Raw', $5, true),
              ($3, $4, 'Keep Raw', $5, true),
              ($6, $7, 'Unused Raw', $5, true),
              ($8, $9, 'Other Branch Raw', $10, true)`,
      [
        rawTarget, `AR-${randomUUID().slice(0, 8)}`,
        rawKeep, `AR-${randomUUID().slice(0, 8)}`,
        branchA,
        rawUnused, `AR-${randomUUID().slice(0, 8)}`,
        rawBranchB, `AR-${randomUUID().slice(0, 8)}`, branchB,
      ],
    );
    await client.query(
      `INSERT INTO public.recipes (id, product_id, branch_id, name, yield_quantity, is_active, version)
       VALUES ($1, $2, $3, 'Recipe v1', 1, true, 1)`,
      [recipeV1, productUsed, branchA],
    );
    await client.query(
      `INSERT INTO public.recipe_items (recipe_id, raw_material_id, quantity, wastage_percent)
       VALUES ($1, $2, 2, 0), ($1, $3, 3, 0)`,
      [recipeV1, rawTarget, rawKeep],
    );

    await client.query(
      `INSERT INTO public.purchases (id, invoice_number, branch_id, subtotal, total, paid_amount, status)
       VALUES ($1, $2, $3, 5, 5, 5, 'completed')`,
      [purchaseId, `PUR-${randomUUID().slice(0, 8)}`, branchA],
    );
    await client.query(
      `INSERT INTO public.purchase_items (purchase_id, raw_material_id, unit_name, quantity, unit_cost, total, received_quantity)
       VALUES ($1, $2, 'piece', 1, 5, 5, 1)`,
      [purchaseId, rawTarget],
    );
    await client.query(
      `INSERT INTO public.raw_material_movements (id, material_id, movement_type, quantity, reference_id, branch_id)
       VALUES ($1, $2, 'KITCHEN_CONSUMPTION', -1, $3, $4)`,
      [rawMovementId, rawTarget, saleId, branchA],
    );

    await client.query(
      `INSERT INTO public.sales (id, invoice_number, branch_id, subtotal, total, paid_amount, status, order_type)
       VALUES ($1, $2, $3, 25, 25, 25, 'completed', 'takeaway')`,
      [saleId, `SALE-${randomUUID().slice(0, 8)}`, branchA],
    );
    await client.query(
      `INSERT INTO public.sale_items (sale_id, product_id, unit_name, quantity, unit_price, total)
       VALUES ($1, $2, 'piece', 1, 25, 25)`,
      [saleId, productUsed],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('hard-deletes a never-used raw material and is idempotent', async () => {
    const first = await asUser(managerUser, async () => {
      const r = await client.query(`SELECT public.archive_raw_material($1) AS r`, [rawUnused]);
      return r.rows[0].r;
    });
    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(first.mode).toBe('deleted');
    expect((await client.query(`SELECT count(*)::int AS c FROM public.raw_materials WHERE id=$1`, [rawUnused])).rows[0].c).toBe(0);

    const second = await asUser(managerUser, async () => {
      const r = await client.query(`SELECT public.archive_raw_material($1) AS r`, [rawUnused]);
      return r.rows[0].r;
    });
    expect(second.success).toBe(true);
    expect(second.mode).toBe('already_absent');
  });

  it('archives a historically used raw material and creates only a future recipe version', async () => {
    const result = await asUser(managerUser, async () => {
      const r = await client.query(`SELECT public.archive_raw_material($1) AS r`, [rawTarget]);
      return r.rows[0].r;
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.mode).toBe('archived');

    const target = await client.query(`SELECT is_active FROM public.raw_materials WHERE id=$1`, [rawTarget]);
    expect(target.rows[0].is_active).toBe(false);

    const oldRecipe = await client.query(`SELECT is_active, version FROM public.recipes WHERE id=$1`, [recipeV1]);
    expect(oldRecipe.rows[0]).toMatchObject({ is_active: false, version: 1 });
    const oldItems = await client.query(
      `SELECT raw_material_id, quantity::numeric FROM public.recipe_items WHERE recipe_id=$1 ORDER BY raw_material_id`,
      [recipeV1],
    );
    expect(oldItems.rows).toHaveLength(2);
    expect(oldItems.rows.some((row) => row.raw_material_id === rawTarget)).toBe(true);

    const activeRecipe = await client.query(
      `SELECT id, version FROM public.recipes WHERE product_id=$1 AND branch_id=$2 AND is_active=true`,
      [productUsed, branchA],
    );
    expect(activeRecipe.rows).toHaveLength(1);
    expect(activeRecipe.rows[0].version).toBe(2);
    const newItems = await client.query(
      `SELECT raw_material_id FROM public.recipe_items WHERE recipe_id=$1`,
      [activeRecipe.rows[0].id],
    );
    expect(newItems.rows).toEqual([{ raw_material_id: rawKeep }]);
  });

  it('preserves purchase, consumption/movement and sales history', async () => {
    const purchase = await client.query(
      `SELECT raw_material_id, quantity::numeric, unit_cost::numeric FROM public.purchase_items WHERE purchase_id=$1`,
      [purchaseId],
    );
    expect(purchase.rows[0].raw_material_id).toBe(rawTarget);
    expect(Number(purchase.rows[0].quantity)).toBe(1);
    expect(Number(purchase.rows[0].unit_cost)).toBe(5);

    const movement = await client.query(
      `SELECT material_id, movement_type, quantity::numeric FROM public.raw_material_movements WHERE id=$1`,
      [rawMovementId],
    );
    expect(movement.rows[0].material_id).toBe(rawTarget);
    expect(movement.rows[0].movement_type).toBe('KITCHEN_CONSUMPTION');
    expect(Number(movement.rows[0].quantity)).toBe(-1);

    const sale = await client.query(`SELECT product_id, total::numeric FROM public.sale_items WHERE sale_id=$1`, [saleId]);
    expect(sale.rows[0].product_id).toBe(productUsed);
    expect(Number(sale.rows[0].total)).toBe(25);
  });

  it('does not create another recipe version when raw archive is repeated', async () => {
    const before = await client.query(
      `SELECT count(*)::int AS c FROM public.recipes WHERE product_id=$1 AND branch_id=$2`,
      [productUsed, branchA],
    );
    const result = await asUser(managerUser, async () => {
      const r = await client.query(`SELECT public.archive_raw_material($1) AS r`, [rawTarget]);
      return r.rows[0].r;
    });
    expect(result.success).toBe(true);
    expect(result.already_archived).toBe(true);
    const after = await client.query(
      `SELECT count(*)::int AS c FROM public.recipes WHERE product_id=$1 AND branch_id=$2`,
      [productUsed, branchA],
    );
    expect(after.rows[0].c).toBe(before.rows[0].c);
  });

  it('enforces branch isolation for raw material archive', async () => {
    const result = await asUser(managerUser, async () => {
      const r = await client.query(`SELECT public.archive_raw_material($1) AS r`, [rawBranchB]);
      return r.rows[0].r;
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('BRANCH_MISMATCH');
    const row = await client.query(`SELECT is_active FROM public.raw_materials WHERE id=$1`, [rawBranchB]);
    expect(row.rows[0].is_active).toBe(true);
  });

  it('archives a historically sold product without deleting its sale or historical recipes', async () => {
    const result = await asUser(managerUser, async () => {
      const r = await client.query(`SELECT public.archive_product($1) AS r`, [productUsed]);
      return r.rows[0].r;
    });
    expect(result.success, JSON.stringify(result)).toBe(true);
    expect(result.mode).toBe('archived');

    const product = await client.query(`SELECT is_active FROM public.products WHERE id=$1`, [productUsed]);
    expect(product.rows[0].is_active).toBe(false);
    const saleItem = await client.query(`SELECT product_id, total::numeric FROM public.sale_items WHERE sale_id=$1`, [saleId]);
    expect(saleItem.rows[0].product_id).toBe(productUsed);
    expect(Number(saleItem.rows[0].total)).toBe(25);
    const recipeHistory = await client.query(`SELECT count(*)::int AS c FROM public.recipes WHERE product_id=$1`, [productUsed]);
    expect(recipeHistory.rows[0].c).toBeGreaterThanOrEqual(2);
  });

  it('hard-deletes a never-used product and repeats safely', async () => {
    const first = await asUser(managerUser, async () => {
      const r = await client.query(`SELECT public.archive_product($1) AS r`, [productUnused]);
      return r.rows[0].r;
    });
    expect(first.success, JSON.stringify(first)).toBe(true);
    expect(first.mode).toBe('deleted');
    expect((await client.query(`SELECT count(*)::int AS c FROM public.products WHERE id=$1`, [productUnused])).rows[0].c).toBe(0);

    const second = await asUser(managerUser, async () => {
      const r = await client.query(`SELECT public.archive_product($1) AS r`, [productUnused]);
      return r.rows[0].r;
    });
    expect(second.success).toBe(true);
    expect(second.mode).toBe('already_absent');
  });

  it('keeps archived raw materials out of active recipe validation', async () => {
    const invalidRecipe = randomUUID();
    await client.query(
      `INSERT INTO public.recipes (id, product_id, branch_id, name, yield_quantity, is_active, version)
       VALUES ($1, $2, $3, 'Invalid future use', 1, false, 99)`,
      [invalidRecipe, productUsed, branchA],
    );
    await expect(
      client.query(
        `INSERT INTO public.recipe_items (recipe_id, raw_material_id, quantity, wastage_percent)
         VALUES ($1, $2, 1, 0)`,
        [invalidRecipe, rawTarget],
      ),
    ).rejects.toThrow(/RAW_MATERIAL_BRANCH_MISMATCH/);
  });
});
