import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('returned sales archive and daily discount database contract', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('installs archive columns and hardened archive rpc', async () => {
    const columns = await client.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='sales'
         AND column_name = ANY($1::text[])
       ORDER BY column_name`,
      [['archived_at','archived_by','is_archived']],
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(['archived_at','archived_by','is_archived']);

    const fn = await client.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='archive_returned_sale'`,
    );
    expect(fn.rows).toHaveLength(1);
    expect(fn.rows[0].def).toContain('FULL_REFUND_REQUIRED');
    expect(fn.rows[0].def).toContain('sales.manage');
    expect(fn.rows[0].def).toContain('refunds.approve');
    expect(fn.rows[0].def).toContain("SET search_path TO 'public', 'pg_temp'");
  });

  it('uses refund-adjusted discount in the authoritative day report', async () => {
    const fn = await client.query<{ def: string }>(
      `SELECT pg_get_functiondef(p.oid) AS def
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='_build_day_closing_report'`,
    );
    expect(fn.rows).toHaveLength(1);
    expect(fn.rows[0].def).toContain('GREATEST(COALESCE(s.total, 0::numeric) - COALESCE(s.refunded_amount, 0::numeric), 0::numeric)');
    expect(fn.rows[0].def).not.toContain("'discount_amount', s.discount_amount, 'tax_amount'");
  });
});
