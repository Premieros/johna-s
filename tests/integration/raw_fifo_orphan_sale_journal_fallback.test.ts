import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;
const num = (v: unknown): number => Number(v || 0);

describe.skipIf(skip)('FIFO orphan sale journal fallback', () => {
  let client: pg.Client;
  const branch = randomUUID();
  const warehouse = randomUUID();
  const orphanSale = randomUUID();

  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    (await client.query(sql, params)).rows as T[];

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await q("INSERT INTO public.branches(id,name) VALUES($1,'Orphan Sale FIFO Branch')", [branch]);
    await q(
      "INSERT INTO public.warehouses(id,name,branch_id,is_active,is_default) VALUES($1,'Orphan Sale WH',$2,true,true)",
      [warehouse, branch],
    );
    await q('SELECT public.ensure_chart_of_accounts($1)', [branch]);
    await q('SELECT public.seed_account_mappings($1)', [branch]);

    await q(
      `SELECT public._post_journal_entry(
        $1,'sale',$2,'ORPHAN-SALE-1','Historical orphan sale',
        jsonb_build_array(
          jsonb_build_object('account_key','cogs','debit',10,'credit',0),
          jsonb_build_object('account_key','inventory_fg','debit',0,'credit',10)
        )
      )`,
      [branch, orphanSale],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('posts and fully reverses orphan-sale COGS without mutating the base journal', async () => {
    const before = await q<{ cogs: string }>(
      `SELECT COALESCE(sum(jel.debit-jel.credit),0)::text cogs
       FROM public.journal_entries je
       JOIN public.account_mappings am
         ON am.branch_id=je.branch_id AND am.semantic_key='cogs'
       JOIN public.journal_entry_lines jel
         ON jel.journal_entry_id=je.id AND jel.account_id=am.account_id
       WHERE je.branch_id=$1 AND je.reference_type='sale' AND je.reference_id=$2`,
      [branch, orphanSale],
    );
    expect(num(before[0].cogs)).toBe(10);

    const applied = await q<{ r: Record<string, unknown> }>(
      `SELECT public._fifo_adjust_reference_delta(
        'sale',$1,$2,$3,'raw_material',$4,7.25,0
      ) r`,
      [orphanSale, branch, warehouse, randomUUID()],
    );
    expect(applied[0].r.success).toBe(true);
    expect(applied[0].r.orphan_sale_fallback).toBe(true);
    expect(num(applied[0].r.posted_delta)).toBe(7.25);

    const adjustment = await q<{ exact_delta: string; posted_delta: string }>(
      `SELECT exact_delta::text,posted_delta::text
       FROM public.raw_fifo_orphan_sale_cogs_adjustments
       WHERE sale_id=$1`,
      [orphanSale],
    );
    expect(num(adjustment[0].exact_delta)).toBe(7.25);
    expect(num(adjustment[0].posted_delta)).toBe(7.25);

    const reconciliation = await q<{ cogs: string; inventory: string }>(
      `SELECT
         COALESCE(sum(CASE WHEN am.semantic_key='cogs' THEN jel.debit-jel.credit ELSE 0 END),0)::text cogs,
         COALESCE(sum(CASE WHEN am.semantic_key='inventory_fg' THEN jel.debit-jel.credit ELSE 0 END),0)::text inventory
       FROM public.journal_entries je
       JOIN public.journal_entry_lines jel ON jel.journal_entry_id=je.id
       JOIN public.account_mappings am ON am.branch_id=je.branch_id AND am.account_id=jel.account_id
       WHERE je.branch_id=$1
         AND je.reference_type='fifo_cogs_reconcile'
         AND je.reference_id=$2`,
      [branch, orphanSale],
    );
    expect(num(reconciliation[0].cogs)).toBe(7.25);
    expect(num(reconciliation[0].inventory)).toBe(-7.25);

    const baseAfter = await q<{ cogs: string }>(
      `SELECT COALESCE(sum(jel.debit-jel.credit),0)::text cogs
       FROM public.journal_entries je
       JOIN public.account_mappings am
         ON am.branch_id=je.branch_id AND am.semantic_key='cogs'
       JOIN public.journal_entry_lines jel
         ON jel.journal_entry_id=je.id AND jel.account_id=am.account_id
       WHERE je.branch_id=$1 AND je.reference_type='sale' AND je.reference_id=$2`,
      [branch, orphanSale],
    );
    expect(num(baseAfter[0].cogs)).toBe(10);

    const reversed = await q<{ r: Record<string, unknown> }>(
      `SELECT public._fifo_adjust_reference_delta(
        'sale',$1,$2,$3,'raw_material',$4,-7.25,0
      ) r`,
      [orphanSale, branch, warehouse, randomUUID()],
    );
    expect(reversed[0].r.success).toBe(true);
    expect(num(reversed[0].r.posted_delta)).toBe(0);

    const remaining = await q<{ adjustments: string; reconciles: string }>(
      `SELECT
         (SELECT count(*)::text FROM public.raw_fifo_orphan_sale_cogs_adjustments WHERE sale_id=$1) adjustments,
         (SELECT count(*)::text FROM public.journal_entries
           WHERE branch_id=$2 AND reference_type='fifo_cogs_reconcile' AND reference_id=$1) reconciles`,
      [orphanSale, branch],
    );
    expect(num(remaining[0].adjustments)).toBe(0);
    expect(num(remaining[0].reconciles)).toBe(0);
  });
});
