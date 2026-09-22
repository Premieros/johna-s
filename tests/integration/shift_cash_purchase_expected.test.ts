import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();
const skip = !dbUrl;

describe.skipIf(skip)('shift expected cash includes canonical outflows', () => {
  let client: pg.Client;
  const branchId = randomUUID();
  const userId = randomUUID();
  const shiftId = randomUUID();
  const expenseId = randomUUID();
  const unlinkedExpenseId = randomUUID();
  const role = `qa_shift_cash_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO public.branches(id,name) VALUES ($1,'QA Shift Cash Outflows')`,
      [branchId],
    );
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,scope,is_active)
       VALUES ($1,'اختبار نقدية الشفت','Shift cash QA','[]'::jsonb,'global',true)`,
      [role],
    );
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
       VALUES ($1,$2,'Shift Cash QA',$3,$4,true)`,
      [userId, `${userId}@test.local`, role, branchId],
    );
    await client.query('ALTER TABLE public.users ENABLE TRIGGER trg_users_role_guard');

    await client.query(
      `INSERT INTO public.shifts(id,branch_id,cashier_id,opened_at,opening_amount,status)
       VALUES ($1,$2,$3,now()-interval '1 hour',100,'open')`,
      [shiftId, branchId, userId],
    );

    await client.query(
      `INSERT INTO public.shift_operations(shift_id,operation_type,amount,payment_method,created_by)
       VALUES ($1,'sale',200,'cash',$2)`,
      [shiftId, userId],
    );

    await client.query(
      `INSERT INTO public.expenses(
         id,category,description,amount,branch_id,payment_method,expense_date,
         created_by,created_at,shift_id,status
       ) VALUES
       ($1,'qa','Linked expense',30,$3,'cash',current_date,$4,now()-interval '20 minutes',$2,'posted'),
       ($5,'qa','Window expense',7,$3,'cash',current_date,$4,now()-interval '10 minutes',NULL,'posted')`,
      [expenseId, shiftId, branchId, userId, unlinkedExpenseId],
    );

    await client.query(
      `INSERT INTO public.shift_operations(
         shift_id,operation_type,amount,payment_method,reference_type,reference_id,created_by
       ) VALUES ($1,'expense',30,'cash','expense',$2,$3)`,
      [shiftId, expenseId, userId],
    );

    await client.query(
      `INSERT INTO public.purchases(
         invoice_number,branch_id,buyer_id,subtotal,total,paid_amount,payment_method,status,returned_amount,created_at
       ) VALUES
       ($1,$2,$3,40,40,40,'cash','completed',5,now()-interval '5 minutes'),
       ($4,$2,$3,50,50,50,'card','completed',0,now()-interval '5 minutes'),
       ($5,$2,$3,99,99,99,'cash','completed',0,now()-interval '2 hours')`,
      [
        `QA-CASH-${randomUUID()}`,
        branchId,
        userId,
        `QA-CARD-${randomUUID()}`,
        `QA-OLD-${randomUUID()}`,
      ],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('subtracts each posted cash expense once and subtracts in-window cash purchases net of returns', async () => {
    const result = await client.query<{ expected: string }>(
      'SELECT public._compute_shift_expected_cash($1)::text AS expected',
      [shiftId],
    );

    // 100 opening + 200 cash sale - 30 linked expense - 7 unlinked in-window expense
    // - (40 paid - 5 returned cash purchase) = 228.
    expect(Number(result.rows[0].expected)).toBe(228);
  });
});
