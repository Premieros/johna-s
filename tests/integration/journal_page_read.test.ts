import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

type Journal = { id: string; debit_total: number; credit_total: number; lines: unknown[] };
type Cursor = { entry_date: string; entry_number: string; id: string };
type Page = {
  rows: Journal[];
  summary: { total_count: number; debit_total: number; credit_total: number; balance: number };
  page_size: number;
  has_more: boolean;
  next_cursor: Cursor | null;
};
const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('bounded journal read with complete caller-visible totals', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;
  const prefix = `JP-${randomUUID().slice(0, 8)}-`;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    imp = await canImpersonate(client);
    // Never create fixtures unless the connection is the isolated CI auth stub.
    if (!imp) throw new Error('Journal pagination tests require isolated CI auth stub');
    ids = await seedRlsFixture(client);
    await client.query(
      `INSERT INTO public.journal_entries (entry_number, branch_id, entry_date, reference_type, reference_number)
       SELECT $1 || lpad(n::text, 3, '0'), $2, CURRENT_DATE, 'manual', 'PAGE-REFERENCE'
       FROM generate_series(1, 205) n`, [prefix, ids.branchA],
    );
    await client.query(
      `INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, note)
       SELECT id, $2, 12.34, 0, 'page detail' FROM public.journal_entries WHERE entry_number LIKE $1 || '%'`,
      [prefix, ids.coaCashA],
    );
    await client.query(
      `INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit)
       SELECT id, $2, 0, 12.34 FROM public.journal_entries WHERE entry_number LIKE $1 || '%'`,
      [prefix, ids.coaCashA],
    );
  });
  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  async function page(userId = ids.users.cashier, branch = ids.branchA, cursor: Cursor | null = null, size = 100, search = prefix): Promise<Page> {
    const result = await runAs(client, userId,
      `SELECT public.get_journals_page($1, NULL, NULL, NULL, $2, $3, $4, $5, $6) AS page`,
      [branch, search, size, cursor?.entry_date ?? null, cursor?.entry_number ?? null, cursor?.id ?? null]);
    expect(result.error).toBeUndefined();
    return result.rows[0].page as Page;
  }

  it('returns at most 100 nested entries while totals cover all 205 entries', async () => {
    const first = await page();
    expect(first.rows).toHaveLength(100);
    expect(first.rows.every(row => row.lines.length === 2)).toBe(true);
    expect(first.summary).toEqual({ total_count: 205, debit_total: 2529.70, credit_total: 2529.70, balance: 0 });
    expect(first.has_more).toBe(true);
    expect(first.next_cursor).not.toBeNull();
  });

  it('keyset pages exhaust the legacy result once without gaps or duplicate rows', async () => {
    const legacy = await runAs(client, ids.users.cashier,
      `SELECT public.get_journals($1, NULL, NULL, NULL, $2) AS rows`, [ids.branchA, prefix]);
    expect(legacy.error).toBeUndefined();
    const collected: Journal[] = [];
    let cursor: Cursor | null = null;
    const counts: number[] = [];
    do {
      const next = await page(ids.users.cashier, ids.branchA, cursor);
      counts.push(next.rows.length);
      collected.push(...next.rows);
      expect(next.summary.total_count).toBe(205);
      cursor = next.next_cursor;
      expect(next.has_more).toBe(cursor !== null);
    } while (cursor);
    expect(counts).toEqual([100, 100, 5]);
    expect(collected).toEqual(legacy.rows[0].rows);
    expect(new Set(collected.map(row => row.id)).size).toBe(205);
  });

  it('preserves branch isolation in both rows and aggregates even with a foreign cursor', async () => {
    const cursor = (await page()).next_cursor;
    const foreign = await page(ids.users.cashier_b, ids.branchA, cursor);
    expect(foreign.rows).toEqual([]);
    expect(foreign.summary).toEqual({ total_count: 0, debit_total: 0, credit_total: 0, balance: 0 });
    expect(foreign.has_more).toBe(false);
    expect(foreign.next_cursor).toBeNull();
  });

  it('keeps a complete zero snapshot for an empty filter and rejects invalid page/cursor inputs', async () => {
    expect((await page(ids.users.cashier, ids.branchA, null, 1, `${prefix}ABSENT`)).summary.total_count).toBe(0);
    for (const size of [null, 0, -1, 201]) {
      const result = await runAs(client, ids.users.cashier,
        `SELECT public.get_journals_page($1, p_page_size => $2)`, [ids.branchA, size]);
      expect(result.error).toContain('JOURNAL_PAGE_SIZE_INVALID');
    }
    const partial = await runAs(client, ids.users.cashier,
      `SELECT public.get_journals_page($1, p_after_id => $2)`, [ids.branchA, randomUUID()]);
    expect(partial.error).toContain('JOURNAL_CURSOR_INCOMPLETE');
    expect((await page(ids.users.cashier, ids.branchA, null, 200)).rows).toHaveLength(200);
  });

  it('retains historical range clamping and reference/search filter semantics', async () => {
    await client.query(
      `INSERT INTO public.journal_entries (entry_number, branch_id, entry_date, reference_type)
       VALUES ($1, $2, CURRENT_DATE - 30, 'manual')`, [`${prefix}OLD`, ids.branchA]);
    for (const userId of [ids.users.cashier, ids.users.super_admin]) {
      const result = await runAs(client, userId,
        `SELECT public.get_journals($1, CURRENT_DATE - 40, CURRENT_DATE, 'manual', $2) AS legacy,
                public.get_journals_page($1, CURRENT_DATE - 40, CURRENT_DATE, 'manual', $2, 200) AS page`,
        [ids.branchA, prefix]);
      expect(result.error).toBeUndefined();
      const old = result.rows[0].legacy as Journal[];
      const paged = result.rows[0].page as Page;
      expect(paged.summary.total_count).toBe(old.length);
      expect(paged.rows).toEqual(old.slice(0, 200));
      expect(old.length).toBe(userId === ids.users.cashier ? 205 : 206);
    }
    const noMatch = await runAs(client, ids.users.cashier,
      `SELECT public.get_journals_page($1, p_reference_type => 'sale', p_search => $2) AS page`, [ids.branchA, prefix]);
    expect((noMatch.rows[0].page as Page).summary.total_count).toBe(0);
  });

  it('does not include financially hidden linked-sale amounts in rows or summary', async () => {
    let hiddenSale: string;
    do { hiddenSale = randomUUID(); }
    while (Number(BigInt(`0x${createHash('md5').update(`${ids.branchA}:${hiddenSale}`).digest('hex').slice(0, 8)}`) % 100n) < 30);
    await client.query(
      `INSERT INTO public.sales (id, invoice_number, branch_id, warehouse_id, subtotal, total, paid_amount, payment_method, status, created_at)
       VALUES ($1, $2, $3, $4, 900, 900, 900, 'cash', 'completed', now() - interval '30 days')`,
      [hiddenSale, `${prefix}HIDDEN-SALE`, ids.branchA, ids.whA]);
    const hiddenEntry = (await client.query<{ id: string }>(
      `INSERT INTO public.journal_entries (entry_number, branch_id, entry_date, reference_type, reference_id, created_at)
       VALUES ($1, $2, CURRENT_DATE, 'sale', $3, now() - interval '30 days') RETURNING id`,
      [`${prefix}HIDDEN-JOURNAL`, ids.branchA, hiddenSale])).rows[0].id;
    await client.query(
      `INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit) VALUES ($1, $2, 900, 0)`,
      [hiddenEntry, ids.coaCashA]);
    const restricted = await page(ids.users.cashier, ids.branchA, null, 200, `${prefix}HIDDEN-JOURNAL`);
    expect(restricted.rows).toEqual([]);
    expect(restricted.summary).toEqual({ total_count: 0, debit_total: 0, credit_total: 0, balance: 0 });
    const admin = await page(ids.users.super_admin, ids.branchA, null, 200, `${prefix}HIDDEN-JOURNAL`);
    expect(admin.summary).toEqual({ total_count: 1, debit_total: 900, credit_total: 0, balance: 900 });
  });

  it('is a stable invoker API unavailable to anon/PUBLIC, without bypassing RLS', async () => {
    const result = await client.query(
      `SELECT p.prosecdef, p.provolatile,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
       FROM pg_proc p WHERE p.oid = 'public.get_journals_page(uuid,date,date,text,text,integer,date,text,uuid)'::regprocedure`);
    expect(result.rows).toEqual([{ prosecdef: false, provolatile: 's', anon_execute: false, authenticated_execute: true }]);
  });
});
