import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('purchase branch relationship guards', () => {
  let client: pg.Client;
  let ids: RlsIds;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  async function expectInsertFailure(sql: string, params: unknown[], message: string) {
    await client.query('SAVEPOINT purchase_guard_case');
    try {
      await client.query(sql, params);
      throw new Error('expected purchase relationship insert to fail');
    } catch (error) {
      expect(String(error)).toContain(message);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT purchase_guard_case');
      await client.query('RELEASE SAVEPOINT purchase_guard_case');
    }
  }

  it('allows supplier and warehouse from the purchase branch', async () => {
    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO public.purchases
        (id, invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, 10, 0, 0, 10, 10, 'cash', 'completed')
       RETURNING id`,
      [id, `PG-OK-${id.slice(0, 8)}`, ids.suppA, ids.branchA, ids.whA],
    );
    expect(result.rows[0].id).toBe(id);
  });

  it('rejects a warehouse from a different branch', async () => {
    const id = randomUUID();
    await expectInsertFailure(
      `INSERT INTO public.purchases
        (id, invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, 10, 0, 0, 10, 10, 'cash', 'completed')`,
      [id, `PG-WH-${id.slice(0, 8)}`, ids.suppA, ids.branchA, ids.whB],
      'WAREHOUSE_BRANCH_MISMATCH',
    );
  });

  it('rejects a supplier from a different branch', async () => {
    const id = randomUUID();
    await expectInsertFailure(
      `INSERT INTO public.purchases
        (id, invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, 10, 0, 0, 10, 10, 'cash', 'completed')`,
      [id, `PG-SUP-${id.slice(0, 8)}`, ids.suppB, ids.branchA, ids.whA],
      'SUPPLIER_BRANCH_MISMATCH',
    );
  });

  it('does not block unrelated updates to untouched legacy mismatches', async () => {
    const id = randomUUID();
    await client.query('ALTER TABLE public.purchases DISABLE TRIGGER trg_enforce_purchase_branch_relationships');
    await client.query(
      `INSERT INTO public.purchases
        (id, invoice_number, supplier_id, branch_id, warehouse_id, subtotal, discount_amount, tax_amount, total, paid_amount, payment_method, status)
       VALUES ($1, $2, $3, $4, $5, 10, 0, 0, 10, 10, 'cash', 'completed')`,
      [id, `PG-LEGACY-${id.slice(0, 8)}`, ids.suppA, ids.branchA, ids.whB],
    );
    await client.query('ALTER TABLE public.purchases ENABLE TRIGGER trg_enforce_purchase_branch_relationships');

    const result = await client.query(
      'UPDATE public.purchases SET notes = $2 WHERE id = $1 RETURNING notes',
      [id, 'legacy metadata-only edit'],
    );
    expect(result.rows[0].notes).toBe('legacy metadata-only edit');
  });
});
