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
  const itemJson = (items: Array<{ product_id: string; quantity: number; notes?: string | null; modifier_option_ids?: string[] }>) => JSON.stringify(items.map((it) => ({ product_id: it.product_id, unit_name: 'piece', quantity: it.quantity, unit_price: 100, discount_amount: 0, bonus_quantity: 0, total: it.quantity * 100, notes: it.notes ?? null, modifier_option_ids: it.modifier_option_ids ?? [] })));
  const makeTable = async (): Promise<string> => { const id = randomUUID(); await client.query(`INSERT INTO public.dining_tables (id, name, branch_id, capacity, status) VALUES ($1, $2, $3, 4, 'vacant')`, [id, `T-${id}`, branchId]); return id; };
  async function asUser<T>(fn: () => Promise<T>): Promise<T> { await client.query(`SELECT set_config('app.user_id', $1, true)`, [cashierId]); await client.query(`SET LOCAL ROLE authenticated`); try { return await fn(); } finally { await client.query('RESET ROLE').catch(() => {}); await client.query('RESET app.user_id').catch(() => {}); } }
  async function createOrder(items = itemJson([{ product_id: prodA, quantity: 1 }])) { const t = await makeTable(); return asUser(async () => { const res = await client.query(`SELECT public.create_order($1, 'dine_in', $2, NULL, 2, NULL, $3::jsonb, 100, 0, 'amount', 0, 100, $4) AS r`, [branchId, t, items, cashierId]); return res.rows[0].r; }); }
  async function batchQty(unitId = unitA): Promise<number> {
    return rawQtyForUnit(client, unitId, branchId, whId);
  }

  const orgId = randomUUID();
  beforeAll(async () => {
    if (skip) throw new Error('Disposable loopback database required');
    client = openDb(dbUrl!); await client.connect(); await client.query('BEGIN');
    // A migrated CI baseline uses live bindings. Benchmark the ORIGINAL body
    // only inside this rollback fixture; all other integration tests stay bound.
    const bound=(await client.query("SELECT to_regprocedure('public._kitchen_dispatch_component_plans(uuid,jsonb)') IS NOT NULL present")).rows[0].present;
    if(bound){
      await client.query("SET LOCAL app.kitchen_rollout_ack='johnas-kitchen-20261013-review-required'");
      const rollback=readFileSync('scripts/rollout/kitchen_dedup_rollback_review_20261013.sql','utf8').replace(/^BEGIN;\n/m,'').replace(/^COMMIT;\n/m,'');
      await client.query(rollback);
    }
    await client.query(readFileSync('scripts/experiments/kitchen_component_reuse_dispatch_candidate_20261012.sql','utf8')); await client.query(readFileSync('scripts/experiments/kitchen_component_price_reuse_dispatch_candidate_20261012.sql','utf8')); await client.query(readFileSync('scripts/experiments/kitchen_negative_reuse_dispatch_candidate_20261013.sql','utf8')); await client.query(`ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard`);
    await client.query(`INSERT INTO public.organizations (id, name, slug) VALUES ($1, $2, $3)`, [orgId, '048 Org', `048-${randomUUID().slice(0,8)}`]);
    await client.query(`INSERT INTO public.branches (id, name, organization_id) VALUES ($1, $2, $3)`, [branchId, '048 Branch', orgId]);
    await client.query(`INSERT INTO public.warehouses (id, name, branch_id, is_active) VALUES ($1, $2, $3, true)`, [whId, '048 WH', branchId]);
    for (const [prod, unit, name] of [[prodA, unitA, 'A'], [prodB, unitB, 'B']] as const) {
      await client.query(`INSERT INTO public.products (id, name, branch_id, sale_price, cost_price, is_active) VALUES ($1, $2, $3, 100, 50, true)`, [prod, `048 Product ${name}`, branchId]);
      await client.query(`INSERT INTO public.inventory_units (id, code, name, unit_type, branch_id, cost_price, sale_price, is_active) VALUES ($1, $2, $3, 'ready', $4, 50, 100, true)`, [unit, `048-${name}-${randomUUID()}`, `048 Unit ${name}`, branchId]);
      await client.query(`INSERT INTO public.product_unit_links (product_id, unit_id, quantity) VALUES ($1, $2, 1)`, [prod, unit]);
      await client.query(`INSERT INTO public.inventory_unit_batches (unit_id, branch_id, warehouse_id, quantity, unit_cost) VALUES ($1, $2, $3, 100, 50)`, [unit, branchId, whId]);
      const raw=await attachRawComponentToUnit(client, unit, branchId, whId, 100, 50);
      if (prod===prodA) await client.query(`INSERT INTO public.raw_material_price_events
        (raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
        VALUES($1,$2,7,'pricing','REUSE-PAST',now()-interval '1 day'),
              ($1,$2,99,'pricing','REUSE-FUTURE',now()+interval '1 day')`,[raw,branchId]);
    }
    await client.query(`INSERT INTO public.users (id, email, full_name, role, branch_id, is_active) VALUES ($1, $2, $3, 'cashier', $4, true)`, [cashierId, `k-${randomUUID()}@test.local`, 'Cashier', branchId]);
    await client.query(`INSERT INTO public.organization_members (organization_id, user_id, membership_role, is_active) VALUES ($1, $2, 'member', true)`, [orgId, cashierId]);
    await client.query(`INSERT INTO public.shifts (branch_id, cashier_id, opening_amount, status) VALUES ($1, $2, 0, 'open')`, [branchId, cashierId]);
    await client.query(`UPDATE public.settings SET tax_enabled = false`);
    await client.query('CREATE TEMP TABLE stock_summary_write_audit(branch_id uuid,raw_id uuid) ON COMMIT DROP');
    await client.query("CREATE FUNCTION pg_temp.stock_summary_write_audit() RETURNS trigger LANGUAGE plpgsql AS $audit$ BEGIN INSERT INTO pg_temp.stock_summary_write_audit VALUES(NEW.branch_id,NEW.raw_material_id); RETURN NEW; END $audit$");
    await client.query('CREATE TRIGGER stock_summary_write_audit AFTER INSERT OR UPDATE ON public.raw_material_inventory FOR EACH ROW EXECUTE FUNCTION pg_temp.stock_summary_write_audit()');
  });
  afterAll(async () => { if (client) { await client.query('ROLLBACK').catch(() => {}); await client.end(); } });


  type Variant = boolean | 'price' | 'stock';
  async function captureTrigger(price: boolean) {
    const fn=price?'_capture_kitchen_ingredient_prices_reuse_candidate':'_capture_kitchen_ingredient_prices';
    await client.query('CREATE OR REPLACE TRIGGER trg_capture_kitchen_ingredient_prices BEFORE INSERT ON public.order_kitchen_inventory_events FOR EACH ROW EXECUTE FUNCTION public.'+fn+'()');
  }
  function coreName(candidate:Variant) {
    return candidate==='stock'?'_send_to_kitchen_negative_reuse_candidate':candidate==='price'?'_send_to_kitchen_component_price_reuse_candidate':
      candidate?'_send_to_kitchen_component_reuse_candidate':'_send_to_kitchen_core_20260914';
  }
  async function sendCore(orderId: string, candidate: Variant) {
    await client.query("SELECT set_config('app.user_id',$1,true)",[cashierId]);
    if (candidate==='price'||candidate==='stock') await captureTrigger(true);
    try {
      return (await client.query('SELECT public.'+coreName(candidate)+'($1,$2) r',[orderId,cashierId])).rows[0].r;
    } finally {
      if (candidate==='price'||candidate==='stock') await captureTrigger(false);
    }
  }
  async function stockState() {
    const queries = [
      "SELECT raw_material_id,warehouse_id,source_type,unit_cost,sum(quantity)::text quantity,count(*)::int rows FROM public.raw_material_batches WHERE branch_id=$1 GROUP BY raw_material_id,warehouse_id,source_type,unit_cost ORDER BY raw_material_id,warehouse_id,source_type,unit_cost",
      "SELECT raw_material_id,to_jsonb(i)-'id'-'created_at'-'updated_at' state FROM public.raw_material_inventory i WHERE branch_id=$1 ORDER BY raw_material_id",
      "SELECT raw_material_id,warehouse_id,sum(quantity)::text quantity,sum(total_cost)::text total_cost,count(*)::int rows FROM public.inventory_ledger WHERE branch_id=$1 GROUP BY raw_material_id,warehouse_id ORDER BY raw_material_id,warehouse_id",
      "SELECT raw_material_id,warehouse_id,sum(debt_quantity)::text debt,sum(settled_quantity)::text settled,count(*)::int rows FROM public.raw_fifo_debts WHERE branch_id=$1 GROUP BY raw_material_id,warehouse_id ORDER BY raw_material_id,warehouse_id",
    ];
    const rows = [];
    for (const sql of queries) rows.push((await client.query(sql,[branchId])).rows);
    return rows;
  }
  async function compare(orderId: string) {
    const outcomes=[];
    for (const candidate of [false,true,'price','stock'] as const) {
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
        const snapshots=(await client.query('SELECT order_item_id,total_cost,component_snapshot FROM public.order_kitchen_inventory_events WHERE order_id=$1 ORDER BY order_item_id',[orderId])).rows;
        const effects=(await client.query(`SELECT e.order_item_id,f.target_id,f.quantity,f.total_cost
          FROM public.order_kitchen_inventory_effects f JOIN public.order_kitchen_inventory_events e ON e.id=f.event_id
          WHERE e.order_id=$1 ORDER BY e.order_item_id,f.target_id`,[orderId])).rows;
        const ledger=(await client.query(`SELECT e.order_item_id,l.raw_material_id,l.quantity,l.unit_cost,l.total_cost,l.before_qty,l.after_qty
          FROM public.inventory_ledger l JOIN public.order_kitchen_inventory_events e ON e.id=l.reference_id
          WHERE e.order_id=$1 ORDER BY e.order_item_id,l.raw_material_id,l.before_qty,l.after_qty`,[orderId])).rows;
        outcomes.push({effects,ledger,qty:beforeResend,sends,snapshots,stock:await stockState(),count:first.items_sent_count,
          tickets:first.sent.map((row: Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='send_id' && key!=='kitchen_send_id')))});
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT dispatch_variant');
        await client.query('RELEASE SAVEPOINT dispatch_variant');
      }
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
    expect(outcomes[3]).toEqual(outcomes[0]);
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
    const rawA=(await client.query("SELECT raw_material_id FROM public.inventory_unit_recipes WHERE unit_id=$1",[unitA])).rows[0].raw_material_id;
    const snapshots=result.snapshots.flatMap((row:{component_snapshot: Array<{raw_material_id:string;unit_cost:number|null}>})=>row.component_snapshot);
    expect(snapshots.filter((raw:{raw_material_id:string})=>raw.raw_material_id===rawA).every((raw:{unit_cost:number|null})=>raw.unit_cost===7)).toBe(true);
    expect(snapshots.filter((raw:{raw_material_id:string})=>raw.raw_material_id!==rawA).every((raw:{unit_cost:number|null})=>raw.unit_cost===null)).toBe(true);
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

  const extraGroup=randomUUID(), extraOption=randomUUID(), badOption=randomUUID();
  async function setupModifiers() {
    await client.query(`INSERT INTO public.product_modifier_groups
      (id,branch_id,product_id,name,min_selections,max_selections,is_active)
      VALUES($1,$2,$3,'Reuse extras',0,1,true)`,[extraGroup,branchId,prodA]);
    await client.query(`INSERT INTO public.product_modifier_group_products(group_id,product_id,branch_id)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[extraGroup,prodA,branchId]);
    for (const [option,name,delta] of [[extraOption,'Extra',1],[badOption,'Invalid removal',-3]] as const) {
      await client.query(`INSERT INTO public.product_modifier_options
        (id,branch_id,group_id,name,price_delta,is_active) VALUES($1,$2,$3,$4,0,true)`,
        [option,branchId,extraGroup,name]);
      await client.query(`INSERT INTO public.product_modifier_inventory_effects
        (branch_id,option_id,target_type,inventory_unit_id,quantity_delta)
        VALUES($1,$2,'inventory_unit',$3,$4)`,[branchId,option,unitA,delta]);
    }
  }
  it('keeps modifier configurations separate while reusing identical configurations',async()=>{
    await setupModifiers();
    const created=await createOrder(itemJson([
      {product_id:prodA,quantity:1,notes:'plain'},
      {product_id:prodA,quantity:2,notes:'extra 1',modifier_option_ids:[extraOption]},
      {product_id:prodA,quantity:3,notes:'extra 2',modifier_option_ids:[extraOption]},
    ]));
    expect(created.success,JSON.stringify(created)).toBe(true);
    const plan=(await client.query(`SELECT public._kitchen_component_plans_candidate($1,
      (SELECT jsonb_agg(jsonb_build_object('order_item_id',id,'product_id',product_id,'modifier_option_ids',to_jsonb(modifier_option_ids))) FROM public.order_items WHERE order_id=$2)) p`,
      [branchId,created.order_id])).rows[0].p;
    expect(plan.configuration_count).toBe(2);
    const result=await compare(created.order_id);
    expect(result.qty[0]).toBe(89);
  });
  it('an invalid later line rolls back every earlier deduction with canonical product attribution',async()=>{
    await client.query('SAVEPOINT negative_invalid_prefix');
    try {
      const raw=(await client.query('SELECT raw_material_id FROM public.inventory_unit_recipes WHERE unit_id=$1',[unitB])).rows[0].raw_material_id;
      await client.query('UPDATE public.raw_material_batches SET quantity=0 WHERE raw_material_id=$1 AND branch_id=$2',[raw,branchId]);
    const created=await createOrder(itemJson([
      {product_id:prodB,quantity:2,notes:'valid first'},
      {product_id:prodB,quantity:3,notes:'valid repeated before failure'},
      {product_id:prodA,quantity:1,notes:'invalid second',modifier_option_ids:[badOption]},
      {product_id:prodA,quantity:2,notes:'invalid repeated',modifier_option_ids:[badOption]},
    ]));
    expect(created.success,JSON.stringify(created)).toBe(true);
    await client.query("UPDATE public.order_items SET created_at=now()-interval '1 minute' WHERE order_id=$1 AND product_id=$2",[created.order_id,prodB]);
    const before=await stockState(), results=[];
    for (const candidate of [false,true,'price','stock'] as const) {
      const result=await sendCore(created.order_id,candidate);
      expect(result.success).toBe(false);
      expect(result.product_id).toBe(prodA);
      expect(await stockState()).toEqual(before);
      expect((await client.query("SELECT count(*)::int n FROM public.order_kitchen_inventory_events WHERE order_id=$1",[created.order_id])).rows[0].n).toBe(0);
      results.push(result);
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(results[3]).toEqual(results[0]);
    } finally {
      await client.query('ROLLBACK TO negative_invalid_prefix');await client.query('RELEASE negative_invalid_prefix');
    }
  });
  it('unconfigured product retains the canonical fallback and negative debt',async()=>{
    const product=randomUUID();
    await client.query("INSERT INTO public.products(id,name,branch_id,sale_price,is_active) VALUES($1,'Reuse fallback',$2,100,true)",[product,branchId]);
    // Resolve fallback once outside replay so both variants use the identical raw id.
    const raw=(await client.query("SELECT public._ensure_pos_fallback_product_raw($1,$2) id",[product,branchId])).rows[0].id;
    const created=await createOrder(itemJson([{product_id:product,quantity:3}]));
    expect(created.success,JSON.stringify(created)).toBe(true);
    const result=await compare(created.order_id);
    expect(result.stock[3].find((row: {raw_material_id:string})=>row.raw_material_id===raw)?.debt).toBe('3.000000');
    expect(result.snapshots[0].component_snapshot[0].raw_material_id).toBe(raw);
  });

  it('later modifier configurations see the recipe materialized by an earlier fallback line',async()=>{
    const product=randomUUID(),autoRaw=randomUUID(),group=randomUUID(),option=randomUUID();
    const extraRaw=(await client.query("SELECT raw_material_id FROM public.inventory_unit_recipes WHERE unit_id=$1",[unitB])).rows[0].raw_material_id;
    await client.query("INSERT INTO public.products(id,name,branch_id,sale_price,is_active) VALUES($1,'Dynamic fallback recipe',$2,100,true)",[product,branchId]);
    // Keep the same raw identity in all replays, but leave the recipe genuinely
    // unconfigured: the first canonical deduction must materialize it.
    await client.query(`INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active)
      VALUES($1,$2,'Dynamic fallback recipe',$3,0,true)`,[autoRaw,'AUTO-PROD-'+product.replace(/-/g,''),branchId]);
    await client.query(`INSERT INTO public.product_modifier_groups(id,branch_id,product_id,name,min_selections,max_selections,is_active)
      VALUES($1,$2,$3,'Dynamic extra',0,1,true)`,[group,branchId,product]);
    await client.query("INSERT INTO public.product_modifier_group_products(group_id,product_id,branch_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[group,product,branchId]);
    await client.query(`INSERT INTO public.product_modifier_options(id,branch_id,group_id,name,price_delta,is_active)
      VALUES($1,$2,$3,'Dynamic ingredient',0,true)`,[option,branchId,group]);
    await client.query(`INSERT INTO public.product_modifier_inventory_effects(branch_id,option_id,target_type,raw_material_id,quantity_delta)
      VALUES($1,$2,'raw_material',$3,1)`,[branchId,option,extraRaw]);
    const created=await createOrder(itemJson([
      {product_id:product,quantity:1,notes:'auto first'},
      {product_id:product,quantity:1,notes:'auto repeated'},
      {product_id:product,quantity:1,notes:'auto extra',modifier_option_ids:[option]},
    ]));
    expect(created.success,JSON.stringify(created)).toBe(true);
    expect((await client.query(`SELECT count(*)::int n FROM public.recipe_items ri
      JOIN public.recipes r ON r.id=ri.recipe_id WHERE r.product_id=$1`,[product])).rows[0].n).toBe(0);
    await client.query(`UPDATE public.order_items SET created_at=now()-
      CASE notes WHEN 'auto first' THEN interval '3 minutes'
                 WHEN 'auto repeated' THEN interval '2 minutes'
                 ELSE interval '1 minute' END WHERE order_id=$1`,[created.order_id]);
    const result=await compare(created.order_id);
    expect(result.stock[3].find((row:{raw_material_id:string})=>row.raw_material_id===autoRaw)?.debt).toBe('3.000000');
    expect(result.qty[1]).toBe(99);
    expect(result.snapshots.flatMap((event:{component_snapshot:Array<{raw_material_id:string}>})=>
      event.component_snapshot).filter((raw:{raw_material_id:string})=>raw.raw_material_id===autoRaw)).toHaveLength(3);
  });
  it('cross-branch dispatch and missing authentication are rejected before inventory work',async()=>{
    const foreign=randomUUID(),order=randomUUID();
    await client.query("INSERT INTO public.branches(id,name) VALUES($1,'Foreign reuse')",[foreign]);
    await client.query("INSERT INTO public.orders(id,order_number,branch_id,status) VALUES($1,$2,$3,'open')",[order,'FOREIGN-'+order,foreign]);
    const before=await stockState(),results=[];
    for (const candidate of [false,true,'price','stock'] as const) results.push(await sendCore(order,candidate));
    expect(results[0].success).toBe(false);
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
    expect(await stockState()).toEqual(before);
    await client.query("SELECT set_config('app.user_id','',true)");
    const result=(await client.query("SELECT public._send_to_kitchen_component_reuse_candidate($1,NULL) r",[order])).rows[0].r;
    expect(result.success).toBe(false);
    expect(await stockState()).toEqual(before);
  });

  it('a client-owned temporary namesake and forged price are ignored',async()=>{
    await client.query('SAVEPOINT hostile_price_context');
    try {
      await client.query("SET LOCAL ROLE authenticated");
      await client.query("CREATE TEMP TABLE pg_temp.kitchen_price_context_candidate(key text PRIMARY KEY,payload jsonb NOT NULL) ON COMMIT DROP");
      await client.query(`INSERT INTO pg_temp.kitchen_price_context_candidate(key,payload)
        VALUES('scope','{"actor_id":"forged"}'::jsonb)`);
      await client.query("RESET ROLE");
      const created=await createOrder(itemJson([
        {product_id:prodA,quantity:1,notes:'hostile 1'},
        {product_id:prodA,quantity:1,notes:'hostile 2'},
      ]));
      expect(created.success,JSON.stringify(created)).toBe(true);
      // Make every scope value and event id valid, and forge an approved-looking
      // price. Server ownership/ACL must reject it even for a known event.
      const event=randomUUID();
      const item=(await client.query("SELECT id FROM public.order_items WHERE order_id=$1 ORDER BY id LIMIT 1",[created.order_id])).rows[0].id;
      const raw=(await client.query("SELECT raw_material_id FROM public.inventory_unit_recipes WHERE unit_id=$1",[unitA])).rows[0].raw_material_id;
      await client.query(`UPDATE pg_temp.kitchen_price_context_candidate SET payload=jsonb_build_object(
        'branch_id',$1::uuid,'actor_id',$2::uuid,'as_of',now(),'txid',txid_current()::text,'event_ids',jsonb_build_array($3::text)) WHERE key='scope'`,
        [branchId,cashierId,event]);
      await client.query(`INSERT INTO pg_temp.kitchen_price_context_candidate(key,payload)
        VALUES('raw:'||$1::text,jsonb_build_object('unit_cost',999,'price_source','pricing','priced_at',now()-interval '1 minute'))`,[raw]);
      await client.query('SAVEPOINT forged_event');
      try {
        await client.query("SELECT set_config('app.user_id',$1,true)",[cashierId]);
        await captureTrigger(true);
        await client.query(`INSERT INTO public.order_kitchen_inventory_events
          (id,branch_id,warehouse_id,order_id,order_item_id,sent_quantity,total_cost,created_by,component_snapshot,snapshot_version)
          VALUES($1,$2,$3,$4,$5,1,0,$6,jsonb_build_array(jsonb_build_object('raw_material_id',$7::uuid,'raw_name','Forged price probe','quantity',1)),2)`,
          [event,branchId,whId,created.order_id,item,cashierId,raw]);
        const snapshot=(await client.query("SELECT component_snapshot FROM public.order_kitchen_inventory_events WHERE id=$1",[event])).rows[0].component_snapshot;
        expect(snapshot[0].unit_cost).toBe(7);
        expect(snapshot[0].unit_cost).not.toBe(999);
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT forged_event');
        await client.query('RELEASE SAVEPOINT forged_event');
      }
      const result=await compare(created.order_id);
      expect(result.snapshots.every((event:{component_snapshot:Array<{unit_cost:number|null}>})=>
        event.component_snapshot.every(raw=>raw.unit_cost===7))).toBe(true);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT hostile_price_context');
      await client.query('RELEASE SAVEPOINT hostile_price_context');
    }
  });
  it('the server-owned price context is unreadable by client roles and expires at rollback',async()=>{
    await client.query('SAVEPOINT trusted_price_context');
    try {
      const created=await createOrder(itemJson([
        {product_id:prodA,quantity:1,notes:'trusted 1'},
        {product_id:prodA,quantity:1,notes:'trusted 2'},
      ]));
      expect(created.success,JSON.stringify(created)).toBe(true);
      const result=await sendCore(created.order_id,'price');
      expect(result.success,JSON.stringify(result)).toBe(true);
      const rows=await client.query(`SELECT rolname,has_table_privilege(rolname,
        'pg_temp.kitchen_price_context_candidate','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed
        FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') ORDER BY rolname`);
      expect(rows.rows.every((row:{allowed:boolean})=>!row.allowed)).toBe(true);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT trusted_price_context');
      await client.query('RELEASE SAVEPOINT trusted_price_context');
    }
  });

  it('a new dispatch sees a new approved price while resend preserves the original snapshot',async()=>{
    await client.query('SAVEPOINT price_scope_lifecycle');
    try {
      const items=itemJson([{product_id:prodA,quantity:1,notes:'scope 1'},{product_id:prodA,quantity:1,notes:'scope 2'}]);
      const first=await createOrder(items);
      expect(first.success,JSON.stringify(first)).toBe(true);
      expect((await sendCore(first.order_id,'price')).success).toBe(true);
      const frozen=(await client.query("SELECT component_snapshot FROM public.order_kitchen_inventory_events WHERE order_id=$1 ORDER BY order_item_id",[first.order_id])).rows;
      const raw=(await client.query("SELECT raw_material_id FROM public.inventory_unit_recipes WHERE unit_id=$1",[unitA])).rows[0].raw_material_id;
      await client.query(`INSERT INTO public.raw_material_price_events(raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
        VALUES($1,$2,31,'pricing','REUSE-NEW',now()-interval '1 minute')`,[raw,branchId]);
      expect((await sendCore(first.order_id,'price')).items_sent_count).toBe(0);
      expect((await client.query("SELECT component_snapshot FROM public.order_kitchen_inventory_events WHERE order_id=$1 ORDER BY order_item_id",[first.order_id])).rows).toEqual(frozen);
      const next=await createOrder(items);
      expect(next.success,JSON.stringify(next)).toBe(true);
      expect((await sendCore(next.order_id,'price')).success).toBe(true);
      const fresh=(await client.query("SELECT component_snapshot FROM public.order_kitchen_inventory_events WHERE order_id=$1",[next.order_id])).rows;
      expect(fresh.every((event:{component_snapshot:Array<{unit_cost:number|null}>})=>
        event.component_snapshot.every(raw=>raw.unit_cost===31))).toBe(true);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT price_scope_lifecycle');
      await client.query('RELEASE SAVEPOINT price_scope_lifecycle');
    }
  });

  it('reuses fully nonpositive raw quantities while preserving each ledger boundary and the last positive average',async()=>{
    await client.query('SAVEPOINT negative_material_replay');
    try {
      const raw=(await client.query('SELECT raw_material_id FROM public.inventory_unit_recipes WHERE unit_id=$1',[unitA])).rows[0].raw_material_id;
      // Establish a real prior positive summary before removing fixture stock.
      await client.query('INSERT INTO public.raw_material_inventory(raw_material_id,branch_id,quantity,avg_cost) VALUES($1,$2,100,50) ON CONFLICT(raw_material_id,branch_id) DO UPDATE SET quantity=100,avg_cost=50',[raw,branchId]);
      await client.query('UPDATE public.raw_material_batches SET quantity=0 WHERE raw_material_id=$1 AND branch_id=$2',[raw,branchId]);
      const created=await createOrder(itemJson([{product_id:prodA,quantity:2,notes:'negative 1'},{product_id:prodA,quantity:3,notes:'negative 2'},{product_id:prodB,quantity:1,notes:'other raw'}]));
      expect(created.success,JSON.stringify(created)).toBe(true);
      await client.query('UPDATE public.orders SET inventory_warehouse_id=$2 WHERE id=$1',[created.order_id,whId]);
      await compare(created.order_id); // Includes individual before_qty/after_qty, debts, effects, snapshots and resend.
      const before=Number((await client.query('SELECT count(*) n FROM pg_temp.stock_summary_write_audit WHERE branch_id=$1',[branchId])).rows[0].n);
      const sent=await sendCore(created.order_id,'stock');
      expect(sent.success,JSON.stringify(sent)).toBe(true);
      const after=Number((await client.query('SELECT count(*) n FROM pg_temp.stock_summary_write_audit WHERE branch_id=$1',[branchId])).rows[0].n);
      expect(after-before).toBe(2); // Repeated negative raw once; the other positive raw remains canonical.
      const summary=(await client.query('SELECT quantity,avg_cost FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2',[raw,branchId])).rows[0];
      expect(Number(summary.quantity)).toBe(-5);expect(Number(summary.avg_cost)).toBe(50);
    } finally {
      await client.query('ROLLBACK TO negative_material_replay');await client.query('RELEASE negative_material_replay');
    }
  });

  it('keeps canonical deductions when another warehouse still has positive batches',async()=>{
    await client.query('SAVEPOINT positive_other_warehouse');
    try {
      const raw=(await client.query('SELECT raw_material_id FROM public.inventory_unit_recipes WHERE unit_id=$1',[unitA])).rows[0].raw_material_id;
      await client.query('UPDATE public.raw_material_batches SET quantity=0 WHERE raw_material_id=$1 AND branch_id=$2',[raw,branchId]);
      const other=randomUUID();
      await client.query("INSERT INTO public.warehouses(id,name,branch_id,is_active) VALUES($1,'Positive other WH',$2,true)",[other,branchId]);
      await client.query("INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,source_type) VALUES($1,$2,$3,'OTHER-POSITIVE',3,17,'opening')",[raw,branchId,other]);
      const created=await createOrder(itemJson([{product_id:prodA,quantity:2},{product_id:prodA,quantity:3}]));
      expect(created.success,JSON.stringify(created)).toBe(true);
      await client.query('UPDATE public.orders SET inventory_warehouse_id=$2 WHERE id=$1',[created.order_id,whId]);
      await compare(created.order_id);
      const before=Number((await client.query('SELECT count(*) n FROM pg_temp.stock_summary_write_audit WHERE branch_id=$1',[branchId])).rows[0].n);
      expect((await sendCore(created.order_id,'stock')).success).toBe(true);
      const after=Number((await client.query('SELECT count(*) n FROM pg_temp.stock_summary_write_audit WHERE branch_id=$1',[branchId])).rows[0].n);
      expect(after-before).toBe(2);
      expect(Number((await client.query('SELECT sum(quantity) q FROM public.raw_material_batches WHERE raw_material_id=$1 AND warehouse_id=$2',[raw,other])).rows[0].q)).toBe(3);
    } finally {
      await client.query('ROLLBACK TO positive_other_warehouse');await client.query('RELEASE positive_other_warehouse');
    }
  });


  it('keeps the canonical last positive average when a repeated raw runs out during the send',async()=>{
    await client.query('SAVEPOINT positive_exhaustion');
    try {
      const raw=(await client.query('SELECT raw_material_id FROM public.inventory_unit_recipes WHERE unit_id=$1',[unitA])).rows[0].raw_material_id;
      await client.query("UPDATE public.raw_material_batches SET quantity=1,unit_cost=2,expiry_date=current_date+1 WHERE raw_material_id=$1 AND branch_id=$2",[raw,branchId]);
      await client.query("INSERT INTO public.raw_material_batches(raw_material_id,branch_id,warehouse_id,batch_number,quantity,unit_cost,expiry_date,source_type) VALUES($1,$2,$3,'SECOND-AVERAGE',1,8,current_date+2,'opening')",[raw,branchId,whId]);
      const created=await createOrder(itemJson([{product_id:prodA,quantity:1,notes:'first FIFO'},{product_id:prodA,quantity:1,notes:'last FIFO'},{product_id:prodA,quantity:1,notes:'now negative'}]));
      expect(created.success,JSON.stringify(created)).toBe(true);
      await client.query('UPDATE public.orders SET inventory_warehouse_id=$2 WHERE id=$1',[created.order_id,whId]);
      await compare(created.order_id);
      expect((await sendCore(created.order_id,'stock')).success).toBe(true);
      const summary=(await client.query('SELECT quantity,avg_cost FROM public.raw_material_inventory WHERE raw_material_id=$1 AND branch_id=$2',[raw,branchId])).rows[0];
      expect(Number(summary.quantity)).toBe(-1);expect(Number(summary.avg_cost)).toBe(8);
    } finally {
      await client.query('ROLLBACK TO positive_exhaustion');await client.query('RELEASE positive_exhaustion');
    }
  });

  it('exposes no client execution or new privileged stock helper',async()=>{
    for(const signature of [
      '_send_to_kitchen_negative_reuse_candidate(uuid,uuid)',
      '_raw_remove_fifo_negative_reuse_candidate(uuid,uuid,uuid,numeric,text,text,uuid,text,uuid,boolean,numeric)',
      '_deduct_kitchen_raw_components_negative_reuse_candidate(uuid,uuid,uuid,numeric,jsonb,uuid,text,uuid,jsonb,jsonb)',
    ]){
      const row=(await client.query("SELECT p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') service FROM pg_proc p WHERE p.oid=$1::regprocedure",['public.'+signature])).rows[0];
      expect(row).toEqual({prosecdef:false,anon:false,authenticated:false,service:false});
    }
  });


  it('rehearses canonical binding through authenticated send_to_kitchen, lock exclusion and code rollback',async()=>{
    await client.query('SAVEPOINT public_binding_fixture');
    const signatures=[
      'public._send_to_kitchen_core_20260914(uuid,uuid)',
      'public._capture_kitchen_ingredient_prices()',
      'public.apply_stock_count(uuid)',
      'public._raw_fifo_settle_receipt(bigint,uuid,uuid)',
    ];
    const metadata=async()=>(await client.query("SELECT s.signature,p.oid,p.prosecdef,p.proconfig,p.proacl::text acl,pg_get_userbyid(p.proowner) owner FROM unnest($1::text[]) s(signature) JOIN pg_proc p ON p.oid=s.signature::regprocedure ORDER BY s.signature",[signatures])).rows;
    const definitions=async()=>(await client.query("SELECT s.signature,pg_get_functiondef(s.signature::regprocedure) definition FROM unnest($1::text[]) s(signature) ORDER BY s.signature",[signatures])).rows;
    const original=await definitions(),attrs=await metadata();
    const trigger=async()=>(await client.query("SELECT tgfoid,tgenabled,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgname='trg_capture_kitchen_ingredient_prices'")).rows;
    const originalTrigger=await trigger();
    const outcomes=[];
    try {
      const raw=(await client.query('SELECT raw_material_id FROM public.inventory_unit_recipes WHERE unit_id=$1',[unitA])).rows[0].raw_material_id;
      await client.query('UPDATE public.raw_material_batches SET quantity=0 WHERE raw_material_id=$1 AND branch_id=$2',[raw,branchId]);
      const created=await createOrder(itemJson([{product_id:prodA,quantity:2,notes:'public 1'},{product_id:prodA,quantity:3,notes:'public 2'},{product_id:prodB,quantity:1,notes:'public other'}]));
      expect(created.success,JSON.stringify(created)).toBe(true);
      await client.query('UPDATE public.orders SET inventory_warehouse_id=$2 WHERE id=$1',[created.order_id,whId]);
      for(const bound of [false,true]){
        await client.query('SAVEPOINT public_binding_variant');
        try {
          if(bound){
            await client.query(readFileSync('scripts/experiments/kitchen_stock_count_material_lock_candidate_20261012.sql','utf8'));
            await client.query(readFileSync('scripts/experiments/raw_fifo_receipt_reuse_candidate_20261013.sql','utf8'));
            await client.query(readFileSync('scripts/experiments/kitchen_canonical_binding_rehearsal_20261013.sql','utf8'));
            expect(await metadata()).toEqual(attrs);
            expect(await trigger()).toEqual(originalTrigger);
            const locker=openDb(dbUrl!);
            await locker.connect();await locker.query('BEGIN');
            try {
              expect((await locker.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1::text||':'||$2::text,0)) locked",[raw,branchId])).rows[0].locked).toBe(true);
              await client.query("SET LOCAL lock_timeout='150ms'");
              const before=await stockState();
              const blocked=await asUser(async()=>(await client.query('SELECT public.send_to_kitchen($1,$2) r',[created.order_id,cashierId])).rows[0].r);
              expect(blocked.success).toBe(false);expect(blocked.detail).toContain('lock timeout');
              expect(await stockState()).toEqual(before);
              expect((await client.query('SELECT count(*)::int n FROM public.order_kitchen_sends WHERE order_id=$1',[created.order_id])).rows[0].n).toBe(0);
            } finally {
              await client.query("SET LOCAL lock_timeout='0'");
              await locker.query('ROLLBACK');await locker.end();
            }
          }
          const first=await asUser(async()=>(await client.query('SELECT public.send_to_kitchen($1,$2) r',[created.order_id,cashierId])).rows[0].r);
          expect(first.success,JSON.stringify(first)).toBe(true);expect(first.items_sent_count).toBe(3);
          const frozen=(await client.query('SELECT order_item_id,total_cost,component_snapshot FROM public.order_kitchen_inventory_events WHERE order_id=$1 ORDER BY order_item_id',[created.order_id])).rows;
          const stock=await stockState();
          const retry=await asUser(async()=>(await client.query('SELECT public.send_to_kitchen($1,$2) r',[created.order_id,cashierId])).rows[0].r);
          expect(retry.success).toBe(true);expect(retry.items_sent_count).toBe(0);
          expect(await stockState()).toEqual(stock);
          expect((await client.query('SELECT order_item_id,total_cost,component_snapshot FROM public.order_kitchen_inventory_events WHERE order_id=$1 ORDER BY order_item_id',[created.order_id])).rows).toEqual(frozen);
          outcomes.push({stock,frozen,tickets:first.sent.map((row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>key!=='send_id'&&key!=='kitchen_send_id')))});
        } finally {
          await client.query('ROLLBACK TO public_binding_variant');await client.query('RELEASE public_binding_variant');
        }
        expect(await definitions()).toEqual(original);
        expect(await metadata()).toEqual(attrs);expect(await trigger()).toEqual(originalTrigger);
      }
      expect(outcomes[1]).toEqual(outcomes[0]);
    } finally {
      await client.query('ROLLBACK TO public_binding_fixture');await client.query('RELEASE public_binding_fixture');
    }
  });

  it('measures full dispatch work on identical replayed fixtures without a timing-only acceptance gate',async()=>{
    await client.query("SET LOCAL track_functions='all'");
    type Sample={ms:number;hits:number;reads:number;wal:number;resolverCalls:number;priceCalls:number;summaryWrites:number};
    const measurements: Record<string,{baseline:Sample[];candidate:Sample[];price:Sample[];stock:Sample[]}>={};
    const quantile=(values:number[],fraction:number)=>{
      const sorted=[...values].sort((a,b)=>a-b);
      return sorted[Math.max(0,Math.ceil(sorted.length*fraction)-1)];
    };
    const summaryWrites=async()=>Number((await client.query('SELECT count(*)::int n FROM pg_temp.stock_summary_write_audit WHERE branch_id=$1',[branchId])).rows[0].n);
    const resolverCalls=async()=>Number((await client.query(`SELECT COALESCE(sum(calls),0)::int n
      FROM pg_stat_xact_user_functions WHERE funcid='public.resolve_kitchen_item_raw_components(uuid,uuid,jsonb)'::regprocedure`)).rows[0].n);
    const priceCalls=async()=>Number((await client.query(`SELECT COALESCE(sum(calls),0)::int n
      FROM pg_stat_xact_user_functions WHERE funcid='public._kitchen_approved_price_candidate(uuid,uuid[],timestamp with time zone)'::regprocedure`)).rows[0].n);
    // First creation includes real catalog cost. Keep the object afterwards,
    // as a reused PostgREST backend would; both steady variants replay from
    // the same stock state. This does not hide the first-use result.
    const seed=await createOrder(itemJson([
      {product_id:prodA,quantity:1,notes:'first context 1'},
      {product_id:prodA,quantity:1,notes:'first context 2'},
    ]));
    expect(seed.success,JSON.stringify(seed)).toBe(true);
    await client.query("SELECT set_config('app.user_id',$1,true)",[cashierId]);
    const firstContext:Record<string,unknown>={};
    for (const candidate of [false,'price'] as const) {
      if (!candidate) await client.query('SAVEPOINT first_context_baseline');
      try {
        await captureTrigger(candidate==='price');
        const result=await client.query('EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) SELECT public.'+coreName(candidate)+'($1,$2)',[seed.order_id,cashierId]);
        const explain=result.rows[0]['QUERY PLAN'][0],plan=explain.Plan;
        expect((await client.query("SELECT count(*)::int n FROM public.order_kitchen_sends WHERE order_id=$1",[seed.order_id])).rows[0].n).toBe(2);
        firstContext[candidate==='price'?'price':'baseline']={
          ms:explain['Execution Time'],hits:plan['Shared Hit Blocks']||0,wal:plan['WAL Bytes']||0,
        };
      } finally {
        await captureTrigger(false);
        if (!candidate) {
          await client.query('ROLLBACK TO SAVEPOINT first_context_baseline');
          await client.query('RELEASE SAVEPOINT first_context_baseline');
        }
      }
    }
    console.info('KITCHEN_PRICE_CONTEXT_FIRST_CREATION '+JSON.stringify(firstContext));
    // ON COMMIT DELETE ROWS leaves this object empty on the next real RPC.
    await client.query('DELETE FROM pg_temp.kitchen_price_context_candidate');
    for (const negative of [false,true]) {
      if (negative) await client.query("UPDATE public.raw_material_batches SET quantity=0 WHERE branch_id=$1",[branchId]);
      for (const [distinct,uniqueRaw] of [[false,false],[true,false],[true,true]] as const) for (const count of [1,5,20,50]) {
      const products=[];
      for (let index=0;index<count;index+=1) {
        if (!distinct) { products.push(prodB); continue; }
        const product=randomUUID();
        await client.query("INSERT INTO public.products(id,name,branch_id,sale_price,is_active) VALUES($1,$2,$3,100,true)",[product,'Bench '+product,branchId]);
        const unit=uniqueRaw?randomUUID():unitB;
        if (uniqueRaw) {
          await client.query(`INSERT INTO public.inventory_units(id,code,name,unit_type,branch_id,cost_price,sale_price,is_active)
            VALUES($1,$2,'Unique benchmark raw unit','ready',$3,50,100,true)`,[unit,'UNIQUE-'+unit,branchId]);
          await attachRawComponentToUnit(client,unit,branchId,whId,negative?0:100,50);
        }
        await client.query("INSERT INTO public.product_unit_links(product_id,unit_id,quantity) VALUES($1,$2,1)",[product,unit]);
        products.push(product);
      }
      const created=await createOrder(itemJson(products.map((product,index)=>({product_id:product,quantity:1,notes:'bench-'+index}))));
      expect(created.success,JSON.stringify(created)).toBe(true);
      const name=(negative?'negative-':'positive-')+(uniqueRaw?'distinct-unique-raw':distinct?'distinct-shared-raw':'repeated')+'-'+count;
      measurements[name]={baseline:[],candidate:[],price:[],stock:[]};
      // Warmup plus seven alternated samples. Each starts from the same state;
      // canonical price capture and FIFO stay enabled for both variants.
      for (let round=0;round<8;round+=1) for (const candidate of (round%2 ? ['stock','price',true,false] as const:[false,true,'price','stock'] as const)) {
        await client.query('SAVEPOINT benchmark_variant');
        try {
          await client.query("SELECT set_config('app.user_id',$1,true)",[cashierId]);
          // Canonical working tables are ON COMMIT DROP in production.
          // Recreate them for BOTH variants to model the next RPC transaction,
          // while retaining only the backend-local private price context.
          await client.query('DROP TABLE IF EXISTS pg_temp.kns_delta');
          await client.query('DROP TABLE IF EXISTS pg_temp.kitchen_raw_need');
          const before=await resolverCalls(), beforePrice=await priceCalls(),beforeSummary=await summaryWrites();
          const fn=coreName(candidate);
          await captureTrigger(candidate==='price'||candidate==='stock');
          const result=await client.query('EXPLAIN (ANALYZE,BUFFERS,WAL,FORMAT JSON) SELECT public.'+fn+'($1,$2)',[created.order_id,cashierId]);
          const explain=result.rows[0]['QUERY PLAN'][0],plan=explain.Plan;
          const calls=(await resolverCalls())-before;
          const priceCount=(await priceCalls())-beforePrice;
          expect(priceCount).toBe(candidate==='price'||candidate==='stock'?1:count);
          const writes=(await summaryWrites())-beforeSummary;
          expect(writes).toBe(candidate==='stock'&&negative&&count>1&&!uniqueRaw?1:count);
          expect(calls).toBe(candidate && !distinct ? 1 : count);
          expect((await client.query("SELECT count(*)::int n FROM public.order_kitchen_sends WHERE order_id=$1",[created.order_id])).rows[0].n).toBe(count);
          if (round>0) measurements[name][candidate==='stock'?'stock':candidate==='price'?'price':candidate?'candidate':'baseline'].push({
            ms:explain['Execution Time'],hits:plan['Shared Hit Blocks']||0,reads:plan['Shared Read Blocks']||0,wal:plan['WAL Bytes']||0,resolverCalls:calls,priceCalls:priceCount,summaryWrites:writes,
          });
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT benchmark_variant');
          await client.query('RELEASE SAVEPOINT benchmark_variant');
        }
      }
    }
    }
    const summary=Object.fromEntries(Object.entries(measurements).map(([name,variants])=>[name,
      Object.fromEntries(Object.entries(variants).map(([variant,samples])=>[variant,{
        samples: samples.length,
        p50ms:quantile(samples.map(s=>s.ms),0.5),p95ms:quantile(samples.map(s=>s.ms),0.95),
        medianHits:quantile(samples.map(s=>s.hits),0.5),medianReads:quantile(samples.map(s=>s.reads),0.5),medianWal:quantile(samples.map(s=>s.wal),0.5),
        resolverCalls:samples[0].resolverCalls,priceCalls:samples[0].priceCalls,summaryWrites:samples[0].summaryWrites,
      }]))]));
    console.info('KITCHEN_COMPONENT_REUSE_FULL_CORE_BENCHMARK '+JSON.stringify(summary));
    // Seven samples are exploratory; production tail latency, CPU and
    // contention need separate evidence. Never assert noisy wall-time ratios.
  },180000);

});
