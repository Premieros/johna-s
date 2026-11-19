import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

let client: pg.Client;
let canRun = false;

beforeAll(async () => {
  const dbUrl = getDbUrl();
  if (!dbUrl) return;
  try {
    client = openDb(dbUrl);
    await client.connect();
    canRun = true;
  } catch {
    canRun = false;
  }
}, 30_000);

afterAll(async () => {
  if (client) await client.end().catch(() => {});
});

describe('change sale payment method approval flow', () => {
  it('installs an atomic server-side correction function', async () => {
    if (!canRun) return;
    const r = await client.query(`
      SELECT pg_get_functiondef('public.change_sale_payment_method(uuid,text,text)'::regprocedure) AS def
    `);
    expect(r.rowCount).toBe(1);
    const def = String(r.rows[0].def || '');
    expect(def).toContain("action_type = 'change_payment_method'");
    expect(def).toContain("entity_type = 'sale'");
    expect(def).toContain("payload->>'new_method'");
    expect(def).toContain('UPDATE public.sales');
    expect(def).toContain('UPDATE public.shift_operations');
    expect(def).toContain('UPDATE public.journal_entry_lines');
    expect(def).toContain("status = 'consumed'");
    expect(def).toContain('CHANGE_PAYMENT_APPROVAL_CONSUME_FAILED');
  });

  it('honors explicit secondary-branch grants without weakening approval and journal checks', async () => {
    if (!canRun) return;
    const r = await client.query(`
      SELECT pg_get_functiondef('public.change_sale_payment_method(uuid,text,text)'::regprocedure) AS def
    `);
    const def = String(r.rows[0].def || '');
    expect(def).toContain('public.user_may_access_branch(v_sale.branch_id)');
    expect(def).not.toContain('v_user_branch <> v_sale.branch_id');
    expect(def).toContain('APPROVAL_REQUIRED');
    expect(def).toContain('CHANGE_PAYMENT_APPROVAL_CONSUME_FAILED');
    expect(def).toContain('UPDATE public.shift_operations');
    expect(def).toContain('UPDATE public.journal_entry_lines');
  });

  it('allows only post-sale methods that map safely to cash/bank accounts', async () => {
    if (!canRun) return;
    const r = await client.query(`
      SELECT pg_get_functiondef('public.change_sale_payment_method(uuid,text,text)'::regprocedure) AS def
    `);
    const def = String(r.rows[0].def || '');
    expect(def).toContain("p_new_method NOT IN ('cash', 'card', 'transfer')");
    expect(def).toContain('UNSUPPORTED_PAYMENT_METHOD');
    expect(def).toContain('Credit requires a receivables workflow');
  });
});
