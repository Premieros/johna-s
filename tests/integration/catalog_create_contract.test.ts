import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('catalog create contract (PR3 6A)', () => {
  let client: pg.Client;
  const orgId = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const managerUser = randomUUID();
  const viewerUser = randomUUID();
  const unitId = randomUUID();
  let kgUnit = '';
  let inventoryUnitId = '';

  async function asManager<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [managerUser]);
    await client.query(`SET LOCAL ROLE authenticated`);
    try {
      return await fn();
    } finally {
      await client.query('RESET ROLE').catch(() => {});
      await client.query('RESET app.user_id').catch(() => {});
    }
  }
  async function asViewer<T>(fn: () => Promise<T>): Promise<T> {
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [viewerUser]);
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
      [orgId, 'Catalog Create Org', `cat-${randomUUID().slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3), ($4, $5, $3)`,
      [branchA, 'Branch A', orgId, branchB, 'Branch B'],
    );

    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, is_active)
       VALUES ('cat_manager', 'CAT Mgr', 'Catalog Manager', $1::jsonb, true)
       ON CONFLICT (role) DO UPDATE SET permissions = EXCLUDED.permissions, is_active = true`,
      [JSON.stringify(['products.create', 'raw_materials.manage'])],
    );
    await client.query(
      `INSERT INTO public.roles (role, name_ar, name_en, permissions, is_active)
       VALUES ('cat_viewer', 'CAT Viewer', 'Catalog Viewer', '[]'::jsonb, true)
       ON CONFLICT (role) DO UPDATE SET permissions = '[]'::jsonb, is_active = true`,
    );

    await client.query(
      `INSERT INTO public.users (id, email, full_name, role, branch_id, is_active)
       VALUES ($1, $2, 'Catalog Manager', 'cat_manager', $3, true),
              ($4, $5, 'Catalog Viewer', 'cat_viewer', $6, true)`,
      [
        managerUser,
        `${randomUUID()}@test.local`,
        branchA,
        viewerUser,
        `${randomUUID()}@test.local`,
        branchA,
      ],
    );

    const kg = await client.query<{ id: string }>(
      `SELECT id FROM public.measurement_units WHERE code = 'KG' LIMIT 1`,
    );
    kgUnit = kg.rows[0]?.id ?? '';
    expect(kgUnit).toBeTruthy();

    await client.query(
      `INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active)
       VALUES ($1, $2, 'Catalog Made Unit', 'manufactured', $3, 50, 100, true)`,
      [unitId, `CAT-${randomUUID().slice(0, 6)}`, branchA],
    );
    inventoryUnitId = unitId;
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('creates a raw material with a required measurement unit (manager, own branch)', async () => {
    const res = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_raw_material($1, $2, $3, $4) AS r`,
        ['RM-1', 'خامة اختبار', kgUnit, branchA],
      );
      return r.rows[0].r;
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(res.raw_material_id).toBeTruthy();
    const row = await client.query(
      `SELECT code, name, unit_id, branch_id FROM public.raw_materials WHERE id = $1`,
      [res.raw_material_id],
    );
    expect(row.rows[0].code).toBe('RM-1');
    expect(row.rows[0].unit_id).toBe(kgUnit);
    expect(row.rows[0].branch_id).toBe(branchA);
  });

  it('rejects a raw material without a measurement unit', async () => {
    const res = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_raw_material($1, $2, NULL, $3) AS r`,
        ['RM-NOUNIT', 'No Unit', branchA],
      );
      return r.rows[0].r;
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('UNIT_REQUIRED');
  });

  it('rejects a raw material with an unknown measurement unit', async () => {
    const res = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_raw_material($1, $2, $3::uuid, $4) AS r`,
        ['RM-BADUNIT', 'Bad Unit', randomUUID(), branchA],
      );
      return r.rows[0].r;
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('UNIT_NOT_FOUND');
  });

  it('rejects a raw material for a branch the user cannot access', async () => {
    const res = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_raw_material($1, $2, $3, $4) AS r`,
        ['RM-XBRANCH', 'Wrong Branch', kgUnit, branchB],
      );
      return r.rows[0].r;
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('BRANCH_MISMATCH');
  });

  it('rejects a raw material without raw_materials.manage permission', async () => {
    const res = await asViewer(async () => {
      const r = await client.query(
        `SELECT public.create_raw_material($1, $2, $3, $4) AS r`,
        ['RM-NOPERM', 'No Perm', kgUnit, branchA],
      );
      return r.rows[0].r;
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('PERMISSION_DENIED');
    expect(res.permission).toBe('raw_materials.manage');
  });

  it('rejects a duplicate raw material code', async () => {
    const res = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_raw_material($1, $2, $3, $4) AS r`,
        ['RM-DUP', 'Duplicate Code', kgUnit, branchA],
      );
      return r.rows[0].r;
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    const dup = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_raw_material($1, $2, $3, $4) AS r`,
        ['RM-DUP', 'Duplicate Code 2', kgUnit, branchA],
      );
      return r.rows[0].r;
    });
    expect(dup.success).toBe(false);
    expect(dup.error).toBe('DUPLICATE_CODE');
  });

  it('requires a valid session (AUTH_REQUIRED)', async () => {
    const res = await client.query(
      `SELECT public.create_raw_material($1, $2, $3, $4) AS r`,
      ['RM-ANON', 'Anonymous', kgUnit, branchA],
    );
    expect(res.rows[0].r.success).toBe(false);
    expect(res.rows[0].r.error).toBe('AUTH_REQUIRED');
  });

  it('creates a product with base unit and canonical unit link, atomically', async () => {
    const res = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_product(
           $1, $2,
           $3, $4, $5,
           p_units => $6::jsonb,
           p_unit_links => $7::jsonb
         ) AS r`,
        [
          'منتج اختبار',
          branchA,
          'Test Product EN',
          'BAR-1',
          'SKU-1',
          JSON.stringify([{ unit_name: 'قطعة', unit_name_en: 'piece', conversion_factor: 1, sale_price: 100, cost_price: 50, is_base: true }]),
          JSON.stringify([{ unit_id: inventoryUnitId, quantity: 2 }]),
        ],
      );
      return r.rows[0].r;
    });
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(res.product_id).toBeTruthy();

    const prod = await client.query(
      `SELECT name, product_type, branch_id FROM public.products WHERE id = $1`,
      [res.product_id],
    );
    expect(prod.rows[0].product_type).toBe('ready');
    expect(prod.rows[0].branch_id).toBe(branchA);

    const links = await client.query(
      `SELECT unit_id, quantity FROM public.product_unit_links WHERE product_id = $1`,
      [res.product_id],
    );
    expect(links.rows.length).toBe(1);
    expect(links.rows[0].unit_id).toBe(inventoryUnitId);
  });

  it('rejects a product_units array without a base unit (NO_BASE_UNIT)', async () => {
    const res = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_product($1, $2, p_units => $3::jsonb) AS r`,
        [
          'No Base',
          branchA,
          JSON.stringify([{ unit_name: 'box', conversion_factor: 10, is_base: false }]),
        ],
      );
      return r.rows[0].r;
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('NO_BASE_UNIT');
  });

  it('rejects a product for another branch', async () => {
    const res = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_product($1, $2) AS r`,
        ['Wrong Branch Product', branchB],
      );
      return r.rows[0].r;
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('BRANCH_MISMATCH');
  });

  it('rejects a product with an invalid product_type', async () => {
    const res = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_product($1, $2, p_product_type => $3) AS r`,
        ['Bad Type', branchA, 'ghost'],
      );
      return r.rows[0].r;
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('INVALID_PRODUCT_TYPE');
  });

  it('rejects duplicate unit links for the same product', async () => {
    const res = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_product($1, $2, p_unit_links => $3::jsonb) AS r`,
        [
          'Dup Links',
          branchA,
          JSON.stringify([
            { unit_id: inventoryUnitId, quantity: 1 },
            { unit_id: inventoryUnitId, quantity: 2 },
          ]),
        ],
      );
      return r.rows[0].r;
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('DUPLICATE_UNIT_LINK');
  });

  it('rejects a product without products.create permission', async () => {
    const res = await asViewer(async () => {
      const r = await client.query(
        `SELECT public.create_product($1, $2) AS r`,
        ['No Perm Product', branchA],
      );
      return r.rows[0].r;
    });
    expect(res.success).toBe(false);
    expect(res.error).toBe('PERMISSION_DENIED');
    expect(res.permission).toBe('products.create');
  });

  it('writes an authoritative audit row for each created entity', async () => {
    const mat = await asManager(async () => {
      const r = await client.query(
        `SELECT public.create_raw_material($1, $2, $3, $4) AS r`,
        ['RM-AUDIT', 'Audited', kgUnit, branchA],
      );
      return r.rows[0].r;
    });
    expect(mat.success).toBe(true);
    const audit = await client.query(
      `SELECT action, entity, entity_id FROM public.audit_log
       WHERE entity_id = $1 AND action = 'RAW_MATERIAL_CREATED'`,
      [mat.raw_material_id],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].entity).toBe('raw_material');
  });
});