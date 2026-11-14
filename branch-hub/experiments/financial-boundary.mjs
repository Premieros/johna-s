// Synthetic fixture for the existing canonical reconcile_offline_sale RPC.
// No SQL implementation is replaced; no real branch/user/sale data is accepted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export async function testFinancialBoundary(db) {
  const branch = randomUUID(), otherBranch = randomUUID(), cashier = randomUUID(), sale = randomUUID();
  const invoice = `INV-OFF-LAB-${randomUUID()}`;
  const checks = [];
  await db.exec('BEGIN');
  try {
    await db.exec('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await db.query('INSERT INTO public.branches(id,name) VALUES ($1,$2),($3,$4)', [branch,'SYNTHETIC LAB A',otherBranch,'SYNTHETIC LAB B']);
    await db.query(`INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
      VALUES($1,$2,'Synthetic Lab Cashier','cashier',$3,true)`, [cashier,`${cashier}@test.invalid`,branch]);
    await db.exec(`UPDATE public.roles SET permissions = CASE
      WHEN jsonb_typeof(COALESCE(permissions,'[]'::jsonb))='array'
      THEN (COALESCE(permissions,'[]'::jsonb)-'pos.payment.take') || '["pos.payment.take"]'::jsonb
      ELSE jsonb_set(COALESCE(permissions,'{}'::jsonb),'{pos.payment.take}','true'::jsonb,true) END
      WHERE role='cashier'`);
    await db.query(`INSERT INTO public.sales(id,invoice_number,branch_id,cashier_id,total,paid_amount,payment_method)
      VALUES($1,$2,$3,$4,100,100,'cash')`, [sale,invoice,branch,cashier]);
    await db.query("SELECT set_config('app.user_id',$1,true)",[cashier]);
    await db.exec('SET LOCAL ROLE authenticated');
    const reconcile = async (amount='100',method='cash',target=branch,number=invoice) =>
      (await db.query('SELECT public.reconcile_offline_sale($1::text,$2::uuid,$3::numeric,$4::text) AS value', [number,target,amount,method])).rows[0].value;
    const result = await reconcile();
    assert.equal(result.success,true); assert.equal(result.reconciled,true); assert.equal(result.sale_id,sale);
    checks.push('exact committed action acknowledged');
    const retry = await reconcile();
    assert.equal(retry.sale_id,sale); assert.equal(retry.reconciled,true);
    checks.push('lost ACK retry resolves to the same sale');
    for (const [amount,method] of [['99','cash'],['100','card']]) {
      const conflict=await reconcile(amount,method);
      assert.equal(conflict.success,false); assert.equal(conflict.error,'OFFLINE_RECONCILIATION_CONFLICT');
    }
    checks.push('amount and tender conflicts rejected');
    assert.equal((await reconcile('100','cash',otherBranch)).error,'BRANCH_MISMATCH');
    checks.push('cross-branch recovery rejected');
    assert.equal((await reconcile('100','cash',branch,'INV-LAB-ONLINE')).error,'INVALID_OFFLINE_INVOICE');
    checks.push('ordinary invoice cannot enter offline recovery');
    await db.exec('RESET ROLE');
    const totals=(await db.query('SELECT count(*)::int AS n,sum(paid_amount)::text AS paid FROM public.sales WHERE id=$1',[sale])).rows[0];
    assert.equal(totals.n,1); assert.equal(Number(totals.paid),100);
    checks.push('retries leave one unchanged settlement');
    const acl=(await db.query(`SELECT has_function_privilege('anon',
      'public.reconcile_offline_sale(text,uuid,numeric,text)','EXECUTE') AS allowed`)).rows[0];
    assert.equal(acl.allowed,false); checks.push('anonymous RPC execution denied');
    return { syntheticDataOnly:true, checks, createsNewOfflineSale:false,
      saleCommitSplitRefundKitchenTested:false };
  } finally {
    await db.exec('ROLLBACK');
  }
}
