import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { getDbUrl, openDb } from './db';
import type pg from 'pg';
import { attachRawComponentToUnit, rawQtyForUnit } from './componentTestFixtures';

const dbUrl = getDbUrl();
const skip = !dbUrl || !['localhost','127.0.0.1','[::1]'].includes(new URL(dbUrl).hostname);

describe.skipIf(skip)('isolated component reuse dispatch candidate', () => {
  let client: pg.Client;
  const branchId = randomUUID(); const whId = randomUUID(); const prodA = randomUUID(); const prodB = randomUUID(); const unitA = randomUUID(); const unitB = randomUUID(); const cashierId = randomUUID();
  const itemJson = (items: Array<{ product_id: string; quantity: number; notes?: string | null }>) => JSON.stringify(items.map((it) => ({ product_id: it.product_id, unit_name: 'piece', quantity: it.quantity, unit_price: 100, discount_amount: 0, bonus_quantity: 0, total: it.quantity * 100, notes: it.notes ?? null })));
  const makeTable = async (): Promise<string> => { const id = randomUUID(); await client.query(`INSERT INTO public.dining_tables (id, name, branch_id, capacity, status) VALUES ($1, $2, $3, 4, 'vacant')`, [id, `T-${id.slice(0,4)}`, branchId]); return id; };
  async function asUser<T>(fn: () => Promise<T>): Promise<T> { await client.query(`SELECT set_config('app.user_id', $1, true)`, [cashierId]); await client.query(`SET LOCAL ROLE authenticated`); try { return await fn(); } finally { await client.query('RESET ROLE').catch(() => {}); await client.query('RESET app.user_id').catch(() => {}); } }
  async function createOrder(items = itemJson([{ product_id: prodA, quantity: 1 }])) { const t = await makeTable(); return asUser(async () => { const res = await client.query(`SELECT public.create_order($1, 'dine_in', $2, NULL, 2, NULL, $3::jsonb, 100, 0, 'amount', 0, 100, $4) AS r`, [branchId, t, items, cashierId]); return res.rows[0].r; }); }
  async function sendRows(orderId: string): Promise<number> { return (await client.query(`SELECT count(*)::int AS c FROM public.order_kitchen_sends WHERE order_id = $1`, [orderId])).rows[0].c; }
  async function batchQty(unitId = unitA): Promise<number> {
    return rawQtyForUnit(client, unitId, branchId, whId);
  }

  const orgId = randomUUID();
  beforeAll(async () => {
    if (skip) throw new Error('Disposable loopback database required');
    client = openDb(dbUrl!); await client.connect(); await client.query('BEGIN'); await client.query(readFileSync('scripts/experiments/kitchen_component_reuse_dispatch_candidate_20261012.sql','utf8')); await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`, [orgId, '048 Org', `048-${randomUUID().slice(0,8)}`]);
    await client.query(`INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3)`, [branchId, '048 Branch', orgId]);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`, [whId, '048 WH', branchId]);
    for (const [prod, unit, name] of [[prodA, unitA, 'A'], [prodB, unitB, 'B']] as const) {
      await client.query(`INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 100, 50, true)`, [prod, `048 Product ${name}`, branchId]);
      await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active) VALUES ($1, $2, $3, 'ready', $4, 50, 100, true)`, [unit, `048-${name}-${randomUUID()}`, `048 Unit ${name}`, branchId]);
      await client.query(`INSERT INTO public.product_unit_links (product_id, unit_id, quantity) VALUES ($1, $2, 1)`, [prod, unit]);
      await client.query(`INSERT INTO public.inventory_unit_batches (unit_id, branch_id, warehouse_id, quantity, unit_cost) VALUES ($1, $2, $3, 100, 50)`, [unit, branchId, whId]);
      await attachRawComponentToUnit(client, unit, branchId, whId, 100, 50);
    }
    await client.query(`INSERT INTO public.users (id, email, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, 'cashier', $4, true)`, [cashierId, `k-${randomUUID()}@test.local`, 'Cashier', branchId]);
    await client.query(`INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active) VALUES ($1, $2, 'member', true)`, [orgId, cashierId]);
    await client.query(`INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, status) VALUES ($1, $2, 0, 'open')`, [branchId, cashierId]);
    await client.query(`UPDATE public.settings SET tax_enabled = false`);
  });
  afterAll(async () => { if (client) { await client.query('ROLLBACK').catch(() => {}); await client.end(); } });


  async function sendCore(orderId: string, candidate: boolean) {
    await client.query("SELECT set_config('app.user_id',$1,true)",[cashierId]);
    const fn=candidate ? '_send_to_kitchen_component_reuse_candidate' : '_send_to_kitchen_core_20260914';
    return (await client.query('SELECT public.'+fn+'($1,$2) r',[orderId,cashierId])).rows[0].r;
  }
  async function compare(orderId: string) {
    const outcomes=[];
    for (const candidate of [false,true]) {
      await client.query('SAVEPOINT dispatch_variant');
      try {
        const first=await sendCore(orderId,candidate);
        expect(first.success,JSON.stringify(first)).toBe(true);
        const beforeResend=[await batchQty(unitA),await batchQty(unitB)];
        const second=await sendCore(orderId,candidate);
        expect(second.success,JSON.stringify(second)).toBe(true);
        expect(second.items_sent_count).toBe(0);
        expect([await batchQty(unitA),await batchQty(unitB)]).toEqual(beforeResend);
        const sends=(await client.query('SELECT order_item_id,sent_quantity FROM public.order_kitchen_sends WHERE order_id=$1 ORDER BY order_item_id',[orderId])).rows;
        const snapshots=(await client.query('SELECT order_item_id,component_snapshot FROM public.order_kitchen_inventory_events WHERE order_id=$1 ORDER BY order_item_id',[orderId])).rows;
        outcomes.push({qty:beforeResend,sends,snapshots,count:first.items_sent_count,
          tickets:first.sent.map((row: Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='send_id' && key!=='kitchen_send_id')))});
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT dispatch_variant');
        await client.query('RELEASE SAVEPOINT dispatch_variant');
      }
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    return outcomes[1];
  }
  it('reuses one configuration while preserving separate item identities and canonical snapshots',async()=>{
    const created=await createOrder(itemJson([{product_id:prodA,quantity:2,notes:'first'},{product_id:prodA,quantity:3,notes:'second'},{product_id:prodB,quantity:4}]));
    expect(created.success,JSON.stringify(created)).toBe(true);
    const plan=(await client.query(`SELECT public._kitchen_component_plans_candidate($1,
      (SELECT jsonb_agg(jsonb_build_object('order_item_id',id,'product_id',product_id,'modifier_option_ids',to_jsonb(modifier_option_ids))) FROM public.order_items WHERE order_id=$2)) p`,[branchId,created.order_id])).rows[0].p;
    expect(plan.configuration_count).toBe(2);
    expect(Object.keys(plan.plans)).toHaveLength(3);
    const result=await compare(created.order_id);
    expect(result.count).toBe(3);
    expect(result.sends).toHaveLength(3);
  });
  it('negative-first sales remain successful and resend does not create another deduction',async()=>{
    const created=await createOrder(itemJson([{product_id:prodA,quantity:150,notes:'negative stock'}]));
    expect(created.success,JSON.stringify(created)).toBe(true);
    const result=await compare(created.order_id);
    expect(result.qty[0]).toBe(-50);
  });
  it('candidate helpers cannot be executed by client roles',async()=>{
    const result=await client.query(`SELECT has_function_privilege('authenticated',
      'public._send_to_kitchen_component_reuse_candidate(uuid,uuid)','EXECUTE') allowed`);
    expect(result.rows[0].allowed).toBe(false);
  });
});
