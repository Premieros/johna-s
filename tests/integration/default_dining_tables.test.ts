import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('default dining tables baseline', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  });

  it('creates 50 organized default tables and still allows additional tables', async () => {
    const branchId = randomUUID();
    await client.query(
      `INSERT INTO public.branches(id,name,is_active) VALUES($1,$2,true)`,
      [branchId, `QA Tables ${randomUUID()}`],
    );

    const baseline = await client.query<{
      total: string;
      active: string;
      named_defaults: string;
      areas: string;
    }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE is_active)::text AS active,
         COUNT(*) FILTER (WHERE name ~ '^Table [0-9]{2}
         COUNT(DISTINCT area_id)::text AS areas
       FROM public.dining_tables
       WHERE branch_id=$1`,
      [branchId],
    );

    expect(baseline.rows[0]).toMatchObject({
      total: '50',
      active: '50',
      named_defaults: '50',
      areas: '1',
    });

    const layout = await client.query<{ min_x: string; max_x: string; min_y: string; max_y: string }>(
      `SELECT
         MIN((layout->>'x')::numeric)::text AS min_x,
         MAX((layout->>'x')::numeric)::text AS max_x,
         MIN((layout->>'y')::numeric)::text AS min_y,
         MAX((layout->>'y')::numeric)::text AS max_y
       FROM public.dining_tables
       WHERE branch_id=$1`,
      [branchId],
    );
    expect(Number(layout.rows[0].max_x)).toBeGreaterThan(Number(layout.rows[0].min_x));
    expect(Number(layout.rows[0].max_y)).toBeGreaterThan(Number(layout.rows[0].min_y));

    const area = await client.query<{ id: string; name: string; is_default: boolean }>(
      `SELECT id,name,is_default FROM public.dining_areas WHERE branch_id=$1 AND is_default=true`,
      [branchId],
    );
    expect(area.rows).toHaveLength(1);
    expect(area.rows[0]).toMatchObject({ name: 'Main Area', is_default: true });

    const customArea = await client.query<{ id: string }>(
      `INSERT INTO public.dining_areas(branch_id,name,sort_order) VALUES($1,'Terrace',10) RETURNING id`,
      [branchId],
    );
    await client.query(
      `INSERT INTO public.dining_tables(branch_id,area_id,name,capacity,status,is_active)
       VALUES($1,$2,'VIP 51',6,'vacant',true)`,
      [branchId, customArea.rows[0].id],
    );

    const afterCustom = await client.query<{ total: string; main_total: string }>(
      `SELECT
         COUNT(*)::text AS total,
         COUNT(*) FILTER (WHERE area_id=$2)::text AS main_total
       FROM public.dining_tables
       WHERE branch_id=$1`,
      [branchId, area.rows[0].id],
    );
    expect(afterCustom.rows[0]).toMatchObject({ total: '51', main_total: '50' });
  });
});
)::text AS named_defaults,
         COUNT(DISTINCT area_id)::text AS areas
       FROM public.dining_tables
       WHERE branch_id=$1`,
      [branchId],
    );

    expect(baseline.rows[0]).toMatchObject({
      total: '50',
      active: '50',
      named_defaults: '50',
      areas: '1',
    });

    const layout = await client.query<{ min_x: string; max_x: string; min_y: string; max_y: string }>(
      `SELECT
         MIN((layout->>'x')::numeric)::text AS min_x,
         MAX((layout->>'x')::numeric)::text AS max_x,
         MIN((layout->>'y')::numeric)::text AS min_y,
         MAX((layout->>'y')::numeric)::text AS max_y
       FROM public.dining_tables
       WHERE branch_id=$1`,
      [branchId],
    );
    expect(Number(layout.rows[0].max_x)).toBeGreaterThan(Number(layout.rows[0].min_x));
    expect(Number(layout.rows[0].max_y)).toBeGreaterThan(Number(layout.rows[0].min_y));

    const area = await client.query<{ id: string }>(
      `SELECT id FROM public.dining_areas WHERE branch_id=$1 ORDER BY sort_order,created_at LIMIT 1`,
      [branchId],
    );

    await client.query(
      `INSERT INTO public.dining_tables(branch_id,area_id,name,capacity,status,is_active)
       VALUES($1,$2,'VIP 51',6,'vacant',true)`,
      [branchId, area.rows[0].id],
    );

    const afterCustom = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM public.dining_tables WHERE branch_id=$1`,
      [branchId],
    );
    expect(afterCustom.rows[0].total).toBe('51');
  });
});
