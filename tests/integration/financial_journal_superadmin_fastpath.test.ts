import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('financial journal Super Admin fast-path RLS semantics', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
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

  guarded('keeps Super Admin implicit cross-branch visibility on journal headers', async () => {
    const result = await runAs(
      client,
      ids.users.super_admin,
      'SELECT id::text AS id FROM public.journal_entries WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[ids.jeA, ids.jeB]],
    );

    expect(result.error).toBeUndefined();
    expect(new Set(result.rows.map((row) => String(row.id)))).toEqual(
      new Set([ids.jeA, ids.jeB]),
    );
  });

  guarded('keeps ordinary users limited to their own branch on journal headers', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      'SELECT id::text AS id FROM public.journal_entries WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[ids.jeA, ids.jeB]],
    );

    expect(result.error).toBeUndefined();
    expect(result.rows.map((row) => String(row.id))).toEqual([ids.jeA]);
  });

  guarded('keeps Super Admin implicit cross-branch visibility on journal lines', async () => {
    const result = await runAs(
      client,
      ids.users.super_admin,
      `SELECT journal_entry_id::text AS journal_entry_id
       FROM public.journal_entry_lines
       WHERE journal_entry_id = ANY($1::uuid[])
       ORDER BY journal_entry_id`,
      [[ids.jeA, ids.jeB]],
    );

    expect(result.error).toBeUndefined();
    expect(new Set(result.rows.map((row) => String(row.journal_entry_id)))).toEqual(
      new Set([ids.jeA, ids.jeB]),
    );
  });

  guarded('keeps ordinary users limited to their own branch on journal lines', async () => {
    const result = await runAs(
      client,
      ids.users.cashier,
      `SELECT journal_entry_id::text AS journal_entry_id
       FROM public.journal_entry_lines
       WHERE journal_entry_id = ANY($1::uuid[])
       ORDER BY journal_entry_id`,
      [[ids.jeA, ids.jeB]],
    );

    expect(result.error).toBeUndefined();
    expect(new Set(result.rows.map((row) => String(row.journal_entry_id)))).toEqual(
      new Set([ids.jeA]),
    );
  });

  guarded('retains restrictive financial visibility policies after the rewrite', async () => {
    const result = await runAs(
      client,
      ids.users.super_admin,
      `SELECT tablename, policyname, permissive
       FROM pg_policies
       WHERE schemaname='public'
         AND policyname IN (
           'financial_visibility_journal_entries',
           'financial_visibility_journal_entry_lines'
         )
       ORDER BY policyname`,
    );

    expect(result.error).toBeUndefined();
    expect(result.rows).toEqual([
      {
        tablename: 'journal_entries',
        policyname: 'financial_visibility_journal_entries',
        permissive: 'RESTRICTIVE',
      },
      {
        tablename: 'journal_entry_lines',
        policyname: 'financial_visibility_journal_entry_lines',
        permissive: 'RESTRICTIVE',
      },
    ]);
  });
});
