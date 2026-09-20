import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('employee-only credit sale guard', () => {
  let client: pg.Client;
  let ids: RlsIds;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);
    await client.query(
      `UPDATE public.customers SET customer_type='customer' WHERE id IN ($1,$2)`,
      [ids.custA, ids.custB],
    );
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end();
    }
  });

  async function insertSale(params: {
    customerId: string;
    branchId: string;
    warehouseId: string;
    method: string;
  }) {
    const saleId = randomUUID();
    return client.query(
      `INSERT INTO public.sales
        (id, invoice_number, customer_id, branch_id, warehouse_id, subtotal,
         discount_amount, tax_amount, total, paid_amount, payment_method, status, created_at)
       VALUES ($1,$2,$3,$4,$5,100,0,0,100,$6,$7,'completed',now())`,
      [
        saleId,
        `EMP-CREDIT-GUARD-${saleId.slice(0, 8)}`,
        params.customerId,
        params.branchId,
        params.warehouseId,
        params.method === 'credit' ? 0 : 100,
        params.method,
      ],
    );
  }

  async function expectCreditRejected(params: {
    customerId: string;
    branchId: string;
    warehouseId: string;
  }) {
    const savepoint = `sp_${randomUUID().replaceAll('-', '')}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    try {
      await insertSale({ ...params, method: 'credit' });
      throw new Error('expected CREDIT_EMPLOYEE_ONLY rejection');
    } catch (error) {
      expect(String((error as Error).message)).toContain('CREDIT_EMPLOYEE_ONLY');
      await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    } finally {
      await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    }
  }

  it('rejects credit for a normal customer and allows non-credit payment', async () => {
    await expectCreditRejected({
      customerId: ids.custA,
      branchId: ids.branchA,
      warehouseId: ids.whA,
    });

    await expect(insertSale({
      customerId: ids.custA,
      branchId: ids.branchA,
      warehouseId: ids.whA,
      method: 'cash',
    })).resolves.toBeTruthy();
  });

  it('allows credit only after the customer is classified as employee', async () => {
    await client.query(
      `UPDATE public.customers SET customer_type='employee' WHERE id=$1`,
      [ids.custA],
    );

    await expect(insertSale({
      customerId: ids.custA,
      branchId: ids.branchA,
      warehouseId: ids.whA,
      method: 'credit',
    })).resolves.toBeTruthy();
  });

  it('rejects an employee customer from another branch', async () => {
    await client.query(
      `UPDATE public.customers SET customer_type='employee' WHERE id=$1`,
      [ids.custB],
    );

    await expectCreditRejected({
      customerId: ids.custB,
      branchId: ids.branchA,
      warehouseId: ids.whA,
    });
  });
});
