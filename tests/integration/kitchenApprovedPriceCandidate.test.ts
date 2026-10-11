import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

// This suite must run against disposable CI/staging DB only. It creates the
// experimental function and fixtures inside BEGIN/ROLLBACK. It never enables
// the disabled production price-capture trigger or changes real orders.
const dbUrl = getDbUrl();
describe.skipIf(!dbUrl)('bounded approved ingredient prices (experimental, #486)', () => {
  let client: pg.Client;
  const org = randomUUID();
  const branchA = randomUUID();
  const branchB = randomUUID();
  const warehouseA = randomUUID();
  const material = randomUUID();
  const noApprovedPrice = randomUUID();
  const foreignMaterial = randomUUID();
  const purchasedMaterial = randomUUID();
  const legacyMaterial = randomUUID();
  const tiedMaterial = randomUUID();
  const kgStockUnit = randomUUID();
  const deniedBranchUser = randomUUID();
  const manager = randomUUID();
  const purchase = randomUUID();
  const asOf = new Date();
  const t0 = new Date(asOf.getTime() - 3 * 60 * 60_000);
  const t1 = new Date(asOf.getTime() - 2 * 60 * 60_000);
  const t2 = new Date(asOf.getTime() - 60 * 60_000);
  const future = new Date(asOf.getTime() + 60 * 60_000);
  const afterFuture = new Date(asOf.getTime() + 2 * 60 * 60_000);

  async function prices(branch: string, ids: string[], time: Date) {
    const r = await client.query(
      `SELECT raw_material_id::text, branch_id::text, unit_cost::numeric(18,6)::text,
              price_source, priced_at::text, reference_number
       FROM public._kitchen_approved_price_candidate($1,$2::uuid[],$3)
       ORDER BY raw_material_id`,
      [branch, ids, time.toISOString()],
    );
    return r.rows as Array<{
      raw_material_id: string;
      branch_id: string;
      unit_cost: string;
      price_source: string;
      priced_at: string;
      reference_number: string | null;
    }>;
  }

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    // Function DDL is rolled back along with all fixtures.
    await client.query(readFileSync(
      'scripts/experiments/kitchen_approved_price_bounded_candidate_20261011.sql', 'utf8',
    ));
    await client.query('ALTER TABLE public.users DISABLE TRIGGER trg_users_role_guard');
    await client.query(
      `INSERT INTO public.organizations(id,name,slug)
       VALUES ($1,'Kitchen Candidate Org',$2)`,
      [org, `kitchen-price-${randomUUID().slice(0,10)}`],
    );
    await client.query(
      `INSERT INTO public.branches(id,name,organization_id) VALUES
       ($1,'Candidate Branch A',$3),($2,'Candidate Branch B',$3)`,
      [branchA, branchB, org],
    );
    await client.query(
      `INSERT INTO public.warehouses(id,name,branch_id,is_active)
       VALUES($1,'Candidate Warehouse',$2,true)`,
      [warehouseA, branchA],
    );
    await client.query(
      `INSERT INTO public.raw_materials(id,code,name,branch_id,default_cost,is_active)
       VALUES
       ($1,$5,'Priced raw', $6,999,true),
       ($2,$7,'No-approved raw', $6,999,true),
       ($3,$8,'Other-branch raw', $9,999,true),
       ($4,$10,'Purchased raw', $6,999,true)`,
      [
        material, noApprovedPrice, foreignMaterial, purchasedMaterial,
        `price-${material.slice(0,8)}`, branchA,
        `noprice-${noApprovedPrice.slice(0,8)}`,
        `other-${foreignMaterial.slice(0,8)}`, branchB,
        `purchase-${purchasedMaterial.slice(0,8)}`,
      ],
    );
    // Real normalization helper uses public.units, not measurement_units.
    await client.query(
      `INSERT INTO public.units(id,code,name,symbol,is_active)
       VALUES($1,$2,'Candidate kilogram','كجم',true)`,
      [kgStockUnit, `candidate-kg-${randomUUID().slice(0,8)}`],
    );
    await client.query(
      `INSERT INTO public.raw_materials
          (id,code,name,branch_id,unit_id,default_cost,is_active)
       VALUES ($1,$3,'Legacy purchase material',$5,$6,777,true),
              ($2,$4,'Tie resolution material',$5,$6,777,true)`,
      [
        legacyMaterial, tiedMaterial,
        `legacy-${legacyMaterial.slice(0,8)}`,
        `tie-${tiedMaterial.slice(0,8)}`,
        branchA, kgStockUnit,
      ],
    );
    for (const [id, raw, branch, price, ref, at] of [
      [randomUUID(), material, branchA, 10, 'FIRST', t0],
      [randomUUID(), material, branchA, 20, 'LATEST', t2],
      [randomUUID(), material, branchA, 30, 'FUTURE', future],
      [randomUUID(), foreignMaterial, branchB, 77, 'CROSS-BRANCH', t2],
      [randomUUID(), tiedMaterial, branchA, 55, 'PRICE-A', t1],
      [randomUUID(), tiedMaterial, branchA, 66, 'PRICE-Z', t1],
    ] as const) {
      await client.query(
        `INSERT INTO public.raw_material_price_events
           (id,raw_material_id,branch_id,unit_cost,source,reference_number,priced_at)
         VALUES($1,$2,$3,$4,'pricing',$5,$6)`,
        [id, raw, branch, price, ref, at],
      );
    }
    await client.query(
      `INSERT INTO public.stock_counts(id,branch_id,warehouse_id,status,applied_at,count_number)
       VALUES($1,$2,$3,'applied',$4,'COUNT-CANDIDATE')`,
      [randomUUID(), branchA, warehouseA, t1],
    );
    // A second stock-count fixture has the same material and sits between
    // FIRST and LATEST; it must win for an as-of date in that interval.
    const stock = await client.query<{ id: string }>(
      "SELECT id FROM public.stock_counts WHERE branch_id=$1 AND count_number='COUNT-CANDIDATE' LIMIT 1",
      [branchA],
    );
    await client.query(
      `INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,unit_cost)
       VALUES($1,$2,15)`,
      [stock.rows[0].id, material],
    );
    await client.query(
      `INSERT INTO public.stock_count_items(stock_count_id,raw_material_id,unit_cost)
       VALUES($1,$2,99)`,
      [stock.rows[0].id, tiedMaterial],
    );

    await client.query(
      `INSERT INTO public.purchases(id,invoice_number,branch_id,subtotal,total,paid_amount,status,created_at)
       VALUES($1,'CANDIDATE-RECEIPT',$2,45,45,45,'completed',$3)`,
      [purchase, branchA, t2],
    );
    await client.query(
      `INSERT INTO public.inventory_ledger
         (raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,
          entry_type,reference_type,reference_id,reference_number,created_at)
       VALUES($1,$2,$3,1,45,45,'purchase','purchase',$4,'CANDIDATE-RECEIPT',$5)`,
      [purchasedMaterial, branchA, warehouseA, purchase, t2],
    );

    // When purchase ledger exists, the legacy item MUST be suppressed even
    // if its later approval timestamp and amount would otherwise win.
    await client.query(
      `INSERT INTO public.purchase_items
         (purchase_id,raw_material_id,unit_name,quantity,unit_cost,total,created_at)
       VALUES($1,$2,'kg',1,999,999,$3)`,
      [purchase, purchasedMaterial, future],
    );

    const legacyPurchaseId = randomUUID();
    await client.query(
      `INSERT INTO public.purchases
        (id,invoice_number,branch_id,subtotal,total,paid_amount,status,created_at,approved_at)
       VALUES($1,$2,$3,24,24,24,'completed',$4,$5)`,
      [legacyPurchaseId, `LEGACY-${randomUUID().slice(0,7)}`, branchA, t0, t1],
    );
    await client.query(
      `INSERT INTO public.purchase_items
         (purchase_id,raw_material_id,unit_name,quantity,unit_cost,total,created_at)
       VALUES($1,$2,'g',1500,0.016,24,$3)`,
      [legacyPurchaseId, legacyMaterial, t0],
    );

    // Use a role with real explicit costing/ingredient-read permissions so
    // parity tests cannot pass vacuously when RLS hides all price events.
    await client.query(
      `INSERT INTO public.roles(role,name_ar,name_en,permissions,is_active)
       VALUES('kitchen_candidate_reader','قارئ أسعار التجربة','Kitchen Candidate Reader',
              $1::jsonb,true)
       ON CONFLICT(role) DO UPDATE
         SET permissions=EXCLUDED.permissions,is_active=true`,
      [JSON.stringify(['raw_materials.view','reports.costing','history.unlimited'])],
    );

    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
       VALUES($1,$2,'Candidate Manager','kitchen_candidate_reader',$3,true)`,
      [manager, `${randomUUID()}@test.local`, branchA],
    );
    await client.query(
      `INSERT INTO public.users(id,email,full_name,role,branch_id,is_active)
       VALUES($1,$2,'Different Branch Manager','kitchen_candidate_reader',$3,true)`,
      [deniedBranchUser, `${randomUUID()}@test.local`, branchB],
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('keeps historical prices at the precise dispatch time, never taking later prices', async () => {
    const beforeCount = await prices(branchA, [material], new Date(t0.getTime() + 10_000));
    expect(beforeCount).toHaveLength(1);
    expect(Number(beforeCount[0].unit_cost)).toBe(10);
    const afterCount = await prices(branchA, [material], new Date(t1.getTime() + 10_000));
    expect(Number(afterCount[0].unit_cost)).toBe(15);
    expect(afterCount[0].price_source).toBe('stock_count');
    const current = await prices(branchA, [material], asOf);
    expect(Number(current[0].unit_cost)).toBe(20);
    expect(current[0].price_source).toBe('pricing');
    const later = await prices(branchA, [material], afterFuture);
    expect(Number(later[0].unit_cost)).toBe(30);
  });

  it('preserves approval whitelist and never substitutes a default/FIFO cost', async () => {
    expect(await prices(branchA, [noApprovedPrice], asOf)).toEqual([]);
    expect(await prices(branchA, [material, foreignMaterial], asOf))
      .toHaveLength(1);
    expect(await prices(branchB, [material, foreignMaterial], asOf))
      .toMatchObject([{ raw_material_id: foreignMaterial, price_source: 'pricing' }]);
  });

  it('reads only a completed, qualified purchase as a candidate', async () => {
    const result = await prices(branchA, [purchasedMaterial], asOf);
    expect(result).toHaveLength(1);
    expect(result[0].price_source).toBe('purchase');
    expect(Number(result[0].unit_cost)).toBe(45);
    expect(result[0].reference_number).toBe('CANDIDATE-RECEIPT');
  });

  it('matches canonical visible current prices for the same branch and role', async () => {
    const expected = await client.query(
      `SELECT raw_material_id::text,unit_cost::numeric(18,6)::text,price_source
       FROM public.get_raw_material_current_prices($1,$2::uuid[])
       WHERE price_source IN ('purchase','pricing','stock_count')
       ORDER BY raw_material_id`,
      [branchA, [material, purchasedMaterial]],
    );
    // Canonical returns the future PRICING winner for material, which is
    // correct only for the later as-of; do NOT copy it into past snapshots.
    const actual = await prices(branchA, [material, purchasedMaterial], afterFuture);
    expect(actual.map(x => ({
      raw_material_id: x.raw_material_id, unit_cost: x.unit_cost, price_source: x.price_source,
    }))).toEqual(expected.rows);

    await client.query("SELECT set_config('app.user_id',$1,true)", [manager]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      const visible = await client.query(
        `SELECT raw_material_id::text,unit_cost::numeric(18,6)::text,price_source
         FROM public.get_raw_material_current_prices($1,$2::uuid[])
         WHERE price_source IN ('purchase','pricing','stock_count')
         ORDER BY raw_material_id`,
        [branchA, [material, purchasedMaterial]],
      );
      expect(visible.rows).toHaveLength(2); // no vacuous parity on hidden data
      const candidate = await prices(branchA, [material, purchasedMaterial], afterFuture);
      expect(candidate).toHaveLength(2);
      expect(candidate.map(x => ({
        raw_material_id: x.raw_material_id, unit_cost: x.unit_cost, price_source: x.price_source,
      }))).toEqual(visible.rows);
    } finally {
      await client.query('RESET ROLE');
      await client.query('RESET app.user_id');
    }
  });


  it('honors explicit function EXECUTE grants instead of the PostgreSQL PUBLIC default', async () => {
    const r = await client.query(`
      SELECT
        has_function_privilege('anon',
          'public._kitchen_approved_price_candidate(uuid,uuid[],timestamptz)',
          'EXECUTE') AS anon_can_execute,
        has_function_privilege('authenticated',
          'public._kitchen_approved_price_candidate(uuid,uuid[],timestamptz)',
          'EXECUTE') AS authenticated_can_execute,
        has_function_privilege('service_role',
          'public._kitchen_approved_price_candidate(uuid,uuid[],timestamptz)',
          'EXECUTE') AS service_can_execute
    `);
    expect(r.rows[0]).toEqual({
      anon_can_execute: false,
      authenticated_can_execute: true,
      service_can_execute: true,
    });
  });

  it('normalizes legacy purchase unit costs and prevents ledger/legacy duplication', async () => {
    const legacy = await prices(branchA, [legacyMaterial], asOf);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].price_source).toBe('purchase');
    expect(Number(legacy[0].unit_cost)).toBe(16);
    // A same-purchase legacy item is present with a conflicting 999 cost but
    // must not override the qualified ledger receipt of 45.
    const ledger = await prices(branchA, [purchasedMaterial], afterFuture);
    expect(Number(ledger[0].unit_cost)).toBe(45);
    const canonical = await client.query(
      `SELECT raw_material_id::text,unit_cost::numeric(18,6)::text,price_source
       FROM public.get_raw_material_current_prices($1,$2::uuid[])
       ORDER BY raw_material_id`,
      [branchA, [legacyMaterial, purchasedMaterial]],
    );
    expect(
      [...legacy, ...ledger].sort((a,b) => a.raw_material_id.localeCompare(b.raw_material_id))
        .map(x => ({raw_material_id:x.raw_material_id,unit_cost:x.unit_cost,price_source:x.price_source}))
    ).toEqual(canonical.rows);
  });

  it('uses source priority and reference descending ties, not arbitrary insertion order', async () => {
    const r = await prices(branchA, [tiedMaterial], new Date(t1.getTime()+1_000));
    expect(r).toHaveLength(1);
    expect(r[0].price_source).toBe('pricing'); // outranks tied stock_count
    expect(r[0].reference_number).toBe('PRICE-Z');
    expect(Number(r[0].unit_cost)).toBe(66);
  });

  it('rejects wrong-branch price access under an authenticated branch manager', async () => {
    await client.query("SELECT set_config('app.user_id',$1,true)", [deniedBranchUser]);
    await client.query('SET LOCAL ROLE authenticated');
    try {
      const r = await prices(branchA, [material, purchasedMaterial], asOf);
      expect(r).toEqual([]);
      const local = await prices(branchB, [foreignMaterial], asOf);
      expect(local).toHaveLength(1);
      expect(local[0].raw_material_id).toBe(foreignMaterial);
      const canonicalLocal = await client.query(
        `SELECT raw_material_id::text,unit_cost::numeric(18,6)::text,price_source
         FROM public.get_raw_material_current_prices($1,$2::uuid[])
         WHERE price_source IN ('purchase','pricing','stock_count')`,
        [branchB, [foreignMaterial]],
      );
      expect(canonicalLocal.rows).toHaveLength(1);
      expect(local.map(x => ({
        raw_material_id: x.raw_material_id,unit_cost:x.unit_cost,price_source:x.price_source,
      }))).toEqual(canonicalLocal.rows);
    } finally {
      await client.query('RESET ROLE');
      await client.query('RESET app.user_id');
    }
  });

  it('returns no price with a null dispatch cutoff or missing material ids', async () => {
    const r = await client.query(
      `SELECT raw_material_id FROM public._kitchen_approved_price_candidate
        ($1,$2::uuid[],$3::timestamptz)`,
      [branchA,[material],null],
    );
    expect(r.rows).toEqual([]);
    expect(await prices(branchA, [], asOf)).toEqual([]);
  });

  it('does not enable or change the kitchen trigger in the sandbox', async () => {
    const r = await client.query(
      `SELECT t.tgenabled FROM pg_trigger t
       WHERE t.tgrelid='public.order_kitchen_inventory_events'::regclass
         AND t.tgname='trg_capture_kitchen_ingredient_prices'`,
    );
    expect(r.rows).toEqual([{ tgenabled: 'D' }]);
  });


  it('proposed Stage A SQL installs an inert function and preserves both trigger flags', async () => {
    // Executed ONLY inside this disposable transaction. Never run Stage B in CI.
    await client.query(readFileSync(
      'scripts/experiments/kitchen_approved_price_stage_a_sql_PROPOSAL_20261011.sql','utf8',
    ));
    const r=await client.query(
      "SELECT pg_get_functiondef('public._capture_kitchen_ingredient_prices()'::regprocedure) AS body",
    );
    expect(r.rows[0].body).toContain('_kitchen_approved_price_candidate');
    const flags=await client.query(
      "SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid='public.order_kitchen_inventory_events'::regclass AND tgname IN ('trg_capture_kitchen_ingredient_prices','trg_sync_sale_source_order_from_kitchen_event') ORDER BY tgname",
    );
    expect(flags.rows).toEqual([
      {tgname:'trg_capture_kitchen_ingredient_prices',tgenabled:'D'},
      {tgname:'trg_sync_sale_source_order_from_kitchen_event',tgenabled:'O'},
    ]);
  });

  // Local-only workload: transactional synthetic records, never real orders.
  // Matches recent production ledger count (36,581) but NOT source/branch skew.
  it.skipIf(!dbUrl || !/^(localhost|127\\.0\\.0\\.1|::1)$/.test(new URL(dbUrl).hostname))(
    'logs local paired EXPLAIN ANALYZE plans/median/p95 without asserting live speed',
    async () => {
      await client.query("SELECT set_config('statement_timeout','45000',true)");
      await client.query(
        "INSERT INTO public.inventory_ledger (raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,reference_number,created_at) SELECT $1::uuid,$2::uuid,$3::uuid,1,2,2,'adjustment','benchmark',NULL,'SYNTH-NOT-REAL',$4::timestamptz - interval '4 hours' FROM generate_series(1,35247)",
        [purchasedMaterial,branchA,warehouseA,t0.toISOString()],
      );
      await client.query(
        "INSERT INTO public.inventory_ledger (raw_material_id,branch_id,warehouse_id,quantity,unit_cost,total_cost,entry_type,reference_type,reference_id,reference_number,created_at) SELECT $1::uuid,$2::uuid,$3::uuid,1,2,2,'purchase','purchase',$4::uuid,'SYNTH-OLDER-RECEIPT',$5::timestamptz - interval '4 hours' FROM generate_series(1,1334)",
        [purchasedMaterial,branchA,warehouseA,purchase,t0.toISOString()],
      );
      await client.query(
        "INSERT INTO public.raw_material_price_events(id,raw_material_id,branch_id,unit_cost,source,reference_number,priced_at) SELECT gen_random_uuid(),$1::uuid,$2::uuid,3,'pricing','SYNTH-PRICE-'||s::text,$3::timestamptz - interval '1 day' - (s::text||' seconds')::interval FROM generate_series(1,296) AS s",
        [material,branchA,t0.toISOString()],
      );
      await client.query('ANALYZE public.inventory_ledger');
      await client.query('ANALYZE public.raw_material_price_events');
      const ids=[material,purchasedMaterial,legacyMaterial,tiedMaterial];
      const queries={
        canonical:"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT raw_material_id,unit_cost,price_source FROM public.get_raw_material_current_prices($1::uuid,$2::uuid[]) WHERE price_source IN ('purchase','pricing','stock_count') ORDER BY raw_material_id",
        candidate:"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT raw_material_id,unit_cost,price_source FROM public._kitchen_approved_price_candidate($1::uuid,$2::uuid[],$3::timestamptz) ORDER BY raw_material_id",
      };
      const samples:Record<'canonical'|'candidate',number[]>={canonical:[],candidate:[]};
      const nodes:Record<'canonical'|'candidate',string>={canonical:'',candidate:''};
      for(let round=0;round<9;round++){
        const order: Array<'canonical'|'candidate'>=round%2?['candidate','canonical']:['canonical','candidate'];
        for(const name of order){
          const res=await client.query(queries[name],name==='canonical'?[branchA,ids]:[branchA,ids,afterFuture.toISOString()]);
          const val=res.rows[0]['QUERY PLAN'];
          const parsed=typeof val==='string'?JSON.parse(val):val;
          const root=parsed[0] as {'Execution Time':number;Plan:{'Node Type':string}};
          expect(root['Execution Time']).toBeGreaterThanOrEqual(0);
          samples[name].push(Number(root['Execution Time']));
          nodes[name]=root.Plan['Node Type'];
        }
      }
      const canonical=await client.query(
        "SELECT raw_material_id::text,unit_cost::numeric(18,6)::text,price_source FROM public.get_raw_material_current_prices($1,$2::uuid[]) WHERE price_source IN ('purchase','pricing','stock_count') ORDER BY raw_material_id",
        [branchA,ids],
      );
      const candidate=await client.query(
        "SELECT raw_material_id::text,unit_cost::numeric(18,6)::text,price_source FROM public._kitchen_approved_price_candidate($1,$2::uuid[],$3::timestamptz) ORDER BY raw_material_id",
        [branchA,ids,afterFuture.toISOString()],
      );
      expect(candidate.rows).toEqual(canonical.rows);
      const stats=(a:number[])=>{const s=[...a].sort((x,y)=>x-y);return {median_ms:s[4],p95_ms:s[8]};};
      console.info('KITCHEN_APPROVED_PRICE_LOCAL_BENCHMARK '+JSON.stringify({
        source:'LOCAL CI TRANSACTION, synthetic source distribution, not live latency',
        generated_non_purchase:35247,generated_purchase:1334,generated_price_events:296,
        materials_queried:ids.length,samples_per_reader:9,
        canonical:stats(samples.canonical),candidate:stats(samples.candidate),plan_nodes:nodes,
      }));
    },
  );
});
