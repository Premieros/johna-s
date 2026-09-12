import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

async function asUser(client: pg.Client, userId: string, sql: string, params: unknown[] = []) {
  const savepoint = `sp_${randomUUID().replace(/-/g, '')}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    return await client.query(sql, params);
  } finally {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
}

describe.skipIf(!dbUrl)('POS catalog Permission-First RLS', () => {
  let client: pg.Client;
  const orgId = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const posUser = randomUUID();
  const catalogUser = randomUUID();
  const unrelatedUser = randomUUID();
  const posRole = `qa_pos_only_${randomUUID().slice(0, 8)}`;
  const catalogRole = `qa_catalog_${randomUUID().slice(0, 8)}`;
  const unrelatedRole = `qa_unrelated_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    await client.query(`INSERT INTO public.organizations(id,name,slug) VALUES($1,'POS Catalog Org',$2)`, [orgId, `pos-catalog-${randomUUID()}`]);
    await client.query(`INSERT INTO public.branches(id,organization_id,name) VALUES($1,$3,'POS A'),($2,$3,'POS B')`, [branchA, branchB, orgId]);
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active) VALUES
       ($1,'POS فقط','POS only','["pos.view"]'::jsonb,'branch',true),
       ($2,'كتالوج','Catalog','["products.view"]'::jsonb,'branch',true),
       ($3,'غير مرتبط','Unrelated','["dashboard.view"]'::jsonb,'branch',true)`,
      [posRole, catalogRole, unrelatedRole],
    );
    await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active) VALUES
       ($1,$2,'POS Only',$3,$7,true),
       ($4,$5,'Catalog User',$6,$7,true),
       ($8,$9,'Unrelated User',$10,$7,true)`,
      [
        posUser, `${posUser}@example.test`, posRole,
        catalogUser, `${catalogUser}@example.test`, catalogRole,
        branchA,
        unrelatedUser, `${unrelatedUser}@example.test`, unrelatedRole,
      ],
    );
    await client.query(`ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard`);
    await client.query(
      `INSERT INTO public.organization_members(organization_id,user_id,membership_role,is_active) VALUES
       ($1,$2,'member',true),($1,$3,'member',true),($1,$4,'member',true)`,
      [orgId, posUser, catalogUser, unrelatedUser],
    );
    await client.query(
      `INSERT INTO public.products(name,branch_id,cost_price,sale_price,is_active) VALUES
       ('POS Active A',$1,1,2,true),('POS Inactive A',$1,1,2,false),('POS Active B',$2,1,2,true)`,
      [branchA, branchB],
    );
  });

  afterAll(async () => {
    await client?.query('ROLLBACK').catch(() => {});
    await client?.end().catch(() => {});
  });

  it('lets pos.view read only the active catalog in an allowed branch', async () => {
    const rows = await asUser(client, posUser, `SELECT name FROM public.products ORDER BY name`);
    expect(rows.rows.map((row) => row.name)).toEqual(['POS Active A']);
  });

  it('preserves full same-branch reads for products.view', async () => {
    const rows = await asUser(client, catalogUser, `SELECT name FROM public.products ORDER BY name`);
    expect(rows.rows.map((row) => row.name)).toEqual(['POS Active A', 'POS Inactive A']);
  });

  it('does not expose products to unrelated permissions', async () => {
    const rows = await asUser(client, unrelatedUser, `SELECT id FROM public.products`);
    expect(rows.rows).toEqual([]);
  });
});
