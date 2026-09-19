import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

function idsOf(rows: Array<Record<string, unknown>>): string[] {
  return rows.map((row) => String(row.id)).sort();
}

describe.skipIf(skip)('related financial visibility reads', () => {
  let client: pg.Client;
  let ids: RlsIds;
  let imp = false;
  const oldPurchaseIds: string[] = [];
  const recentPurchaseIds: string[] = [];
  const oldExpenseIds: string[] = [];
  let visibleOldSaleId = '';
  let hiddenOldSaleId = '';
  let visiblePurchaseItemId = '';
  let hiddenPurchaseItemId = '';
  let visibleJournalEntryId = '';
  let hiddenJournalEntryId = '';

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    imp = await canImpersonate(client);
    if (!imp) return;

    for (let i = 0; i < 50; i += 1) {
      const purchaseId = randomUUID();
      oldPurchaseIds.push(purchaseId);
      await client.query(
        `INSERT INTO public.purchases
          (id, invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 25, 0, 0, 25, 0, 'cash', 'completed', now() - interval '30 days')`,
        [purchaseId, `FV-P-${i}-${purchaseId.slice(0, 8)}`, ids.suppA, ids.branchA, ids.whA],
      );
    }
    for (let i = 0; i < 3; i += 1) {
      const purchaseId = randomUUID();
      recentPurchaseIds.push(purchaseId);
      await client.query(
        `INSERT INTO public.purchases
          (id, invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 25, 0, 0, 25, 0, 'cash', 'completed', now() - interval '1 day')`,
        [purchaseId, `FV-PR-${i}-${purchaseId.slice(0, 8)}`, ids.suppA, ids.branchA, ids.whA],
      );
    }

    visiblePurchaseItemId = randomUUID();
    hiddenPurchaseItemId = randomUUID();
    await client.query(
      `INSERT INTO public.purchase_items (id, purchase_id, product_id, unit_name, quantity, unit_cost, total)
       VALUES ($1, $2, $3, 'piece', 1, 25, 25), ($4, $5, $3, 'piece', 1, 25, 25)`,
      [visiblePurchaseItemId, oldPurchaseIds[0], ids.prodA, hiddenPurchaseItemId, oldPurchaseIds[1]],
    );

    for (let i = 0; i < 40; i += 1) {
      const expenseId = randomUUID();
      oldExpenseIds.push(expenseId);
      await client.query(
        `INSERT INTO public.expenses
          (id, category, description, amount, branch_id, expense_date, payment_method, created_at)
         VALUES ($1, 'ops', 'financial visibility', 10, $2, CURRENT_DATE - 30, 'cash', now() - interval '30 days')`,
        [expenseId, ids.branchA],
      );
    }
    visibleOldSaleId = randomUUID();
    hiddenOldSaleId = randomUUID();
    await client.query(
      `INSERT INTO public.sales
        (id, invoice_number, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
       VALUES
        ($1, $2, $3, $4, 30, 0, 0, 30, 30, 'cash', 'completed', now() - interval '30 days'),
        ($5, $6, $3, $4, 30, 0, 0, 30, 30, 'cash', 'completed', now() - interval '30 days')`,
      [visibleOldSaleId, `FV-SV-${visibleOldSaleId.slice(0, 8)}`, ids.branchA, ids.whA,
       hiddenOldSaleId, `FV-SH-${hiddenOldSaleId.slice(0, 8)}`],
    );

    await client.query(
      `INSERT INTO public.stock_transactions
        (product_id, warehouse_id, branch_id, transaction_type, reference_type, reference_id, quantity, before_quantity, after_quantity, unit_cost)
       VALUES
        ($1, $2, $3, 'sale', 'sale', $4, -1, 2, 1, 5),
        ($1, $2, $3, 'sale', 'sale', $5, -1, 2, 1, 5)`,
      [ids.prodA, ids.whA, ids.branchA, visibleOldSaleId, hiddenOldSaleId],
    );

    await client.query(
      `INSERT INTO public.inventory_ledger
        (product_id, branch_id, warehouse_id, quantity, unit_cost, total_cost, entry_type, reference_type, reference_id, reference_number)
       VALUES
        ($1, $2, $3, -1, 5, -5, 'sale', 'sale', $4, 'FV-VISIBLE'),
        ($1, $2, $3, -1, 5, -5, 'sale', 'sale', $5, 'FV-HIDDEN')`,
      [ids.prodA, ids.branchA, ids.whA, visibleOldSaleId, hiddenOldSaleId],
    );

    visibleJournalEntryId = randomUUID();
    hiddenJournalEntryId = randomUUID();
    await client.query(
      `INSERT INTO public.journal_entries
        (id, entry_number, branch_id, entry_date, reference_type, reference_id, description, created_at)
       VALUES
        ($1, $2, $3, CURRENT_DATE - 30, 'sale', $4, 'visible sale journal', now() - interval '30 days'),
        ($5, $6, $3, CURRENT_DATE - 30, 'sale', $7, 'hidden sale journal', now() - interval '30 days')`,
      [visibleJournalEntryId, `FV-JV-${visibleJournalEntryId.slice(0, 8)}`, ids.branchA, visibleOldSaleId,
       hiddenJournalEntryId, `FV-JH-${hiddenJournalEntryId.slice(0, 8)}`, hiddenOldSaleId],
    );
    await client.query(
      `INSERT INTO public.journal_entry_lines (journal_entry_id, account_id, debit, credit, note)
       VALUES ($1, $3, 10, 0, 'visible'), ($2, $3, 10, 0, 'hidden')`,
      [visibleJournalEntryId, hiddenJournalEntryId, ids.coaCashA],
    );

    await client.query(
      `INSERT INTO public.customer_payments
        (customer_id, branch_id, amount, payment_method, sale_id, reference_number, created_at)
       VALUES
        ($1, $2, 10, 'cash', $3, 'FV-CP-V', now() - interval '30 days'),
        ($1, $2, 10, 'cash', $4, 'FV-CP-H', now() - interval '30 days')`,
      [ids.custA, ids.branchA, visibleOldSaleId, hiddenOldSaleId],
    );
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

  guarded('authorized branch users see complete old purchase history', async () => {
    const owner = await runAs(client, ids.users.owner,
      'SELECT id FROM public.purchases WHERE id = ANY($1::uuid[]) ORDER BY id', [oldPurchaseIds]);
    const cashier = await runAs(client, ids.users.cashier,
      'SELECT id FROM public.purchases WHERE id = ANY($1::uuid[]) ORDER BY id', [oldPurchaseIds]);
    const manager = await runAs(client, ids.users.branch_manager,
      'SELECT id FROM public.purchases WHERE id = ANY($1::uuid[]) ORDER BY id', [oldPurchaseIds]);

    expect(owner.error).toBeUndefined();
    expect(idsOf(owner.rows)).toEqual([...oldPurchaseIds].sort());
    expect(idsOf(cashier.rows)).toEqual([...oldPurchaseIds].sort());
    expect(idsOf(manager.rows)).toEqual([...oldPurchaseIds].sort());
  });

  guarded('all recent purchases remain visible to non-owner users', async () => {
    const result = await runAs(client, ids.users.cashier,
      'SELECT id FROM public.purchases WHERE id = ANY($1::uuid[]) ORDER BY id', [recentPurchaseIds]);
    expect(result.error).toBeUndefined();
    expect(idsOf(result.rows)).toEqual([...recentPurchaseIds].sort());
  });

  guarded('purchase items remain visible with their authorized parent purchases', async () => {
    const restricted = await runAs(client, ids.users.cashier,
      'SELECT id FROM public.purchase_items WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[visiblePurchaseItemId, hiddenPurchaseItemId]]);
    const owner = await runAs(client, ids.users.owner,
      'SELECT id FROM public.purchase_items WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[visiblePurchaseItemId, hiddenPurchaseItemId]]);

    expect(idsOf(restricted.rows)).toEqual([hiddenPurchaseItemId, visiblePurchaseItemId].sort());
    expect(idsOf(owner.rows)).toEqual([hiddenPurchaseItemId, visiblePurchaseItemId].sort());
  });

  guarded('authorized branch users see complete old expense history', async () => {
    const restricted = await runAs(client, ids.users.accountant,
      'SELECT id FROM public.expenses WHERE id = ANY($1::uuid[]) ORDER BY id', [oldExpenseIds]);
    const owner = await runAs(client, ids.users.owner,
      'SELECT id FROM public.expenses WHERE id = ANY($1::uuid[]) ORDER BY id', [oldExpenseIds]);

    expect(idsOf(restricted.rows)).toEqual([...oldExpenseIds].sort());
    expect(idsOf(owner.rows)).toEqual([...oldExpenseIds].sort());
  });

  guarded('sale-linked movement history stays complete within an authorized branch', async () => {
    const stock = await runAs(client, ids.users.cashier,
      `SELECT reference_id AS id FROM public.stock_transactions
       WHERE reference_id = ANY($1::uuid[]) ORDER BY reference_id`,
      [[visibleOldSaleId, hiddenOldSaleId]]);
    const ledger = await runAs(client, ids.users.cashier,
      `SELECT reference_id AS id FROM public.inventory_ledger
       WHERE reference_id = ANY($1::uuid[]) ORDER BY reference_id`,
      [[visibleOldSaleId, hiddenOldSaleId]]);

    expect(idsOf(stock.rows)).toEqual([hiddenOldSaleId, visibleOldSaleId].sort());
    expect(idsOf(ledger.rows)).toEqual([hiddenOldSaleId, visibleOldSaleId].sort());
  });

  guarded('journal headers and lines stay complete within an authorized branch', async () => {
    const headers = await runAs(client, ids.users.accountant,
      'SELECT id FROM public.journal_entries WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[visibleJournalEntryId, hiddenJournalEntryId]]);
    const lines = await runAs(client, ids.users.accountant,
      `SELECT journal_entry_id AS id FROM public.journal_entry_lines
       WHERE journal_entry_id = ANY($1::uuid[]) ORDER BY journal_entry_id`,
      [[visibleJournalEntryId, hiddenJournalEntryId]]);

    expect(idsOf(headers.rows)).toEqual([hiddenJournalEntryId, visibleJournalEntryId].sort());
    expect(idsOf(lines.rows)).toEqual([hiddenJournalEntryId, visibleJournalEntryId].sort());
  });

  guarded('customer payments linked to old sales stay complete within an authorized branch', async () => {
    const restricted = await runAs(client, ids.users.accountant,
      `SELECT sale_id AS id FROM public.customer_payments
       WHERE sale_id = ANY($1::uuid[]) ORDER BY sale_id`,
      [[visibleOldSaleId, hiddenOldSaleId]]);
    expect(idsOf(restricted.rows)).toEqual([hiddenOldSaleId, visibleOldSaleId].sort());
  });

  guarded('current inventory truth is not sampled or reduced', async () => {
    const result = await runAs(client, ids.users.cashier,
      'SELECT id FROM public.inventory WHERE branch_id = $1 ORDER BY id', [ids.branchA]);
    expect(result.error).toBeUndefined();
    expect(result.rowCount).toBeGreaterThan(0);
  });

  guarded('all new financial visibility policies are restrictive', async () => {
    const result = await client.query<{ policyname: string; permissive: string }>(
      `SELECT policyname, permissive
       FROM pg_policies
       WHERE schemaname = 'public'
         AND policyname LIKE 'financial_visibility_%'
       ORDER BY policyname`,
    );
    expect(result.rows.length).toBeGreaterThanOrEqual(14);
    expect(result.rows.every((row) => row.permissive === 'RESTRICTIVE')).toBe(true);
  });
});
