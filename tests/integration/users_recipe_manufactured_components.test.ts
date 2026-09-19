import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('branch-scoped users and manufactured recipe components', () => {
  let client: pg.Client;
  let ids: RlsIds;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    await client.query(
      `UPDATE public.roles
       SET permissions = permissions || '["recipes.manage"]'::jsonb
       WHERE role = 'branch_manager'`,
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  it('branch manager cannot read users from another branch', async () => {
    const result = await runAs(
      client,
      ids.users.branch_manager,
      'SELECT id, branch_id FROM public.users ORDER BY id',
    );
    expect(result.error).toBeUndefined();
    expect(result.rows.length).toBeGreaterThan(0);
    const visibleUsers = result.rows as Array<{ id: string; branch_id: string | null }>;
    expect(visibleUsers.every((row) => row.branch_id === ids.branchA)).toBe(true);
    expect(visibleUsers.some((row) => row.id === ids.users.cashier_b)).toBe(false);
  });

  it('recipe manager can atomically save manufactured composition only from the same branch', async () => {
    const readyUnit = randomUUID();
    const manufacturedA = randomUUID();
    const manufacturedB = randomUUID();

    await client.query(
      `INSERT INTO public.inventory_units
        (id, code, name, unit_type, branch_id, is_active, cost_price)
       VALUES
        ($1, $2, 'Ready A', 'ready', $3, true, 1),
        ($4, $5, 'Manufactured A', 'manufactured', $3, true, 5),
        ($6, $7, 'Manufactured B', 'manufactured', $8, true, 5)`,
      [
        readyUnit, `READY-${readyUnit.slice(0, 8)}`, ids.branchA,
        manufacturedA, `MFG-A-${manufacturedA.slice(0, 8)}`,
        manufacturedB, `MFG-B-${manufacturedB.slice(0, 8)}`, ids.branchB,
      ],
    );

    const recipe = await client.query<{ id: string; product_id: string }>(
      `SELECT id, product_id FROM public.recipes WHERE id = $1`,
      [ids.rows.recipes.own],
    );
    const productId = recipe.rows[0].product_id;

    await client.query(
      'INSERT INTO public.product_unit_links(product_id, unit_id, quantity) VALUES ($1, $2, 1)',
      [productId, readyUnit],
    );

    const ok = await runAsPersist(
      client,
      ids.users.branch_manager,
      `SELECT public.save_recipe_composition(
         $1::uuid, $2::uuid, $3::uuid, 'Mixed recipe', 2, '', true,
         '[]'::jsonb,
         jsonb_build_array(jsonb_build_object('unit_id', $4::uuid, 'quantity', 4))
       ) AS result`,
      [ids.rows.recipes.own, productId, ids.branchA, manufacturedA],
    );
    expect(ok.error).toBeUndefined();
    expect(ok.rows[0].result).toMatchObject({
      success: true,
      manufactured_components_count: 1,
      raw_items_count: 0,
    });

    const links = await client.query<{ unit_id: string; quantity: string }>(
      'SELECT unit_id, quantity FROM public.product_unit_links WHERE product_id = $1 ORDER BY unit_id',
      [productId],
    );
    expect(links.rows.some((row) => row.unit_id === readyUnit)).toBe(true);
    expect(links.rows.some((row) => row.unit_id === manufacturedA && Number(row.quantity) === 2)).toBe(true);

    const wrongBranch = await runAs(
      client,
      ids.users.branch_manager,
      `SELECT public.save_recipe_composition(
         $1::uuid, $2::uuid, $3::uuid, 'Mixed recipe', 2, '', true,
         '[]'::jsonb,
         jsonb_build_array(jsonb_build_object('unit_id', $4::uuid, 'quantity', 1))
       ) AS result`,
      [ids.rows.recipes.own, productId, ids.branchA, manufacturedB],
    );
    expect(wrongBranch.error).toBeUndefined();
    expect(wrongBranch.rows[0].result).toMatchObject({
      success: false,
      error: 'MANUFACTURED_COMPONENT_NOT_IN_BRANCH',
    });
  });

});
