import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('raw-material COGS accounting routing', () => {
  let client: pg.Client;
  const branchId = randomUUID();

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      "INSERT INTO public.branches(id,name) VALUES($1,'Raw COGS Accounting Test')",
      [branchId],
    );
    await client.query('SELECT public.ensure_chart_of_accounts($1)', [branchId]);
    await client.query('SELECT public.seed_account_mappings($1)', [branchId]);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  async function semanticLines(referenceType: string, referenceId: string) {
    return (await client.query<{ semantic_key: string; debit: string; credit: string }>(
      `SELECT am.semantic_key,
              jel.debit::text,
              jel.credit::text
       FROM public.journal_entries je
       JOIN public.journal_entry_lines jel ON jel.journal_entry_id=je.id
       JOIN public.account_mappings am
         ON am.branch_id=je.branch_id
        AND am.account_id=jel.account_id
       WHERE je.reference_type=$1
         AND je.reference_id=$2
       ORDER BY am.semantic_key`,
      [referenceType, referenceId],
    )).rows;
  }

  it('routes a future sale COGS inventory leg from finished goods to raw materials', async () => {
    const saleId = randomUUID();

    await client.query(
      `SELECT public._post_journal_entry(
         $1,'sale',$2,'RAW-COGS-SALE','Raw COGS sale',
         jsonb_build_array(
           jsonb_build_object('account_key','cogs','debit',10,'credit',0),
           jsonb_build_object('account_key','inventory_fg','debit',0,'credit',10)
         )
       )`,
      [branchId, saleId],
    );

    const lines = await semanticLines('sale', saleId);
    expect(lines).toEqual([
      { semantic_key: 'cogs', debit: '10.00', credit: '0.00' },
      { semantic_key: 'inventory_rm', debit: '0.00', credit: '10.00' },
    ]);
  });

  it('also remaps legacy direct account code 1200 for a sale', async () => {
    const saleId = randomUUID();

    await client.query(
      `SELECT public._post_journal_entry(
         $1,'sale',$2,'RAW-COGS-CODE','Raw COGS code sale',
         jsonb_build_array(
           jsonb_build_object('account_key','cogs','debit',7,'credit',0),
           jsonb_build_object('account_code','1200','debit',0,'credit',7)
         )
       )`,
      [branchId, saleId],
    );

    const lines = await semanticLines('sale', saleId);
    expect(lines.map((line) => line.semantic_key)).toEqual(['cogs', 'inventory_rm']);
  });

  it('does not remap finished-goods accounting for purchases', async () => {
    const purchaseId = randomUUID();

    await client.query(
      `SELECT public._post_journal_entry(
         $1,'purchase',$2,'RAW-COGS-PURCHASE','Finished goods purchase control',
         jsonb_build_array(
           jsonb_build_object('account_key','inventory_fg','debit',12,'credit',0),
           jsonb_build_object('account_key','ap','debit',0,'credit',12)
         )
       )`,
      [branchId, purchaseId],
    );

    const lines = await semanticLines('purchase', purchaseId);
    expect(lines.map((line) => line.semantic_key)).toEqual(['ap', 'inventory_fg']);
  });
});
