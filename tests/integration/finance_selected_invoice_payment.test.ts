import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { canImpersonate, runAs, runAsPersist, seedRlsFixture, type RlsIds } from './rls';
const dbUrl = getDbUrl();
const owned = !!dbUrl && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(dbUrl).hostname);
describe.skipIf(!owned)('selected invoice collection on owned canonical database', () => {
  let client: pg.Client; let ids: RlsIds; let impersonation = false;
  beforeAll(async () => {
    client = openDb(dbUrl!); await client.connect(); await client.query('BEGIN');
    ids = await seedRlsFixture(client); impersonation = await canImpersonate(client);
    if (!impersonation) return;
    await client.query(`UPDATE public.roles SET permissions=permissions || '["accounts.view","sales.payment.receive"]'::jsonb WHERE role='branch_manager'`);
    await client.query(`UPDATE public.customers SET customer_type='employee' WHERE id=$1`, [ids.custA]);
  });
  afterAll(async () => { if (client) { await client.query('ROLLBACK').catch(() => {}); await client.end(); } });
  it('uses named invoice fields, rejects overpayment and posts one balanced real journal', async ctx => {
    if (!impersonation) return ctx.skip();
    const saleId = randomUUID();
    await client.query(`INSERT INTO public.sales(id,invoice_number,customer_id,branch_id,warehouse_id,subtotal,discount_amount,tax_amount,total,paid_amount,refunded_amount,payment_method,status)
      VALUES($1,$2,$3,$4,$5,100,0,0,100,0,10,'credit','completed')`, [saleId, 'FINANCE-'+saleId, ids.custA, ids.branchA, ids.whA]);
    const over = await runAs(client, ids.users.branch_manager, `SELECT public.receive_payment($1,$2,91,'cash',$3,NULL) result`, [ids.custA, ids.branchA, saleId]);
    expect(over.error).toBeUndefined(); expect(over.rows[0].result).toMatchObject({success:false,error:'PAYMENT_EXCEEDS_INVOICE',open:90});
    const missing = await runAs(client, ids.users.branch_manager, `SELECT public.receive_payment($1,$2,25,'cash',$3,NULL) result`, [ids.custA, ids.branchA, randomUUID()]);
    expect(missing.error).toBeUndefined(); expect(missing.rows[0].result).toMatchObject({success:false,error:'SALE_NOT_FOUND'});
    const paid = await runAsPersist(client, ids.users.branch_manager, `SELECT public.receive_payment($1,$2,25,'cash',$3,'owned regression') result`, [ids.custA, ids.branchA, saleId]);
    expect(paid.error).toBeUndefined(); expect(paid.rows[0].result).toMatchObject({success:true,unapplied:0});
    const paymentId = (paid.rows[0].result as { payment_id: string }).payment_id;
    expect(Number((await client.query('SELECT paid_amount FROM public.sales WHERE id=$1', [saleId])).rows[0].paid_amount)).toBe(25);
    expect((await client.query('SELECT count(*)::int n FROM public.customer_payments WHERE sale_id=$1', [saleId])).rows[0].n).toBe(1);
    const journal = await client.query(`SELECT count(DISTINCT j.id)::int entries,sum(l.debit) debit,sum(l.credit) credit FROM public.journal_entries j JOIN public.journal_entry_lines l ON l.journal_entry_id=j.id WHERE j.reference_type='payment' AND j.reference_id=$1`, [paymentId]);
    expect(journal.rows[0].entries).toBe(1); expect(Number(journal.rows[0].debit)).toBe(25); expect(Number(journal.rows[0].credit)).toBe(25);
  });
});
