// Isolated PostgreSQL fixture only. Never connects to a hosted database.
// Supply PGLITE_MODULE with an installed @electric-sql/pglite entry point.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const read = path => readFileSync(path, 'utf8');
const forward = read('supabase/migrations/20261113131737_product_read_permission_initplans.sql');
const rollback = read('scripts/rollback/product_read_initplans_20261113.sql');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const old = "public.is_platform_admin() OR (public.user_may_access_branch(branch_id) AND (public.can_permission('products.view') OR (is_active = true AND public.can_permission('pos.view'))))";
try {
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE users(id uuid PRIMARY KEY,role text,branch_id uuid,is_active boolean);
    CREATE TABLE roles(role text PRIMARY KEY,is_active boolean,permissions jsonb);
    CREATE TABLE user_branch_access(user_id uuid,branch_id uuid);
    CREATE TABLE products(id integer PRIMARY KEY,branch_id uuid,is_active boolean);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (NULLIF(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    CREATE FUNCTION is_pos_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=auth.uid() AND u.is_active=true AND u.role='super_admin') $$;
    CREATE FUNCTION is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT EXISTS(SELECT 1 FROM users WHERE users.id=auth.uid() AND users.is_active AND users.role='super_admin') $$;
    CREATE FUNCTION can_permission(p_permission text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT is_pos_admin() OR EXISTS(SELECT 1 FROM users u JOIN roles r ON r.role=u.role AND r.is_active=true
        WHERE u.id=auth.uid() AND u.is_active=true AND COALESCE(r.permissions,'[]'::jsonb)?p_permission) $$;
    CREATE FUNCTION user_may_access_branch(p_branch_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT is_pos_admin() OR EXISTS(SELECT 1 FROM user_branch_access uba WHERE uba.user_id=auth.uid() AND uba.branch_id=p_branch_id)
      OR EXISTS(SELECT 1 FROM users u WHERE u.id=auth.uid() AND u.is_active=true AND u.branch_id=p_branch_id) $$;
    ALTER TABLE products ENABLE ROW LEVEL SECURITY;
    GRANT USAGE ON SCHEMA public,auth TO authenticated;
    GRANT SELECT,INSERT,UPDATE,DELETE ON products TO authenticated;
    CREATE POLICY auth_select_products ON products FOR SELECT TO authenticated USING (${old});
    CREATE POLICY fixture_insert ON products FOR INSERT TO authenticated WITH CHECK (can_permission('products.create') AND user_may_access_branch(branch_id));
    CREATE POLICY fixture_update ON products FOR UPDATE TO authenticated USING (can_permission('products.edit') AND user_may_access_branch(branch_id));
    CREATE POLICY fixture_delete ON products FOR DELETE TO authenticated USING (can_permission('products.delete') AND user_may_access_branch(branch_id));
    INSERT INTO roles VALUES ('super_admin',true,'[]'),('cashier',true,'["pos.view"]'),('viewer',true,'["products.view"]'),('none',true,'[]'),('disabled_role',false,'["products.view"]');
  `);
  for (const [n,role,active] of [[1,'super_admin',true],[2,'cashier',true],[3,'viewer',true],[4,'none',true],[5,'cashier',false],[6,'disabled_role',true]]) {
    await db.query('INSERT INTO users VALUES ($1,$2,$3,$4)',[id(n),role,id(101),active]);
  }
  await db.query('INSERT INTO user_branch_access VALUES ($1,$2)',[id(2),id(102)]);
  for (const [n,branch,active] of [[1,id(101),true],[2,id(101),false],[3,id(102),true],[4,id(102),false],[5,null,true],[6,null,false]]) {
    await db.query('INSERT INTO products VALUES ($1,$2,$3)',[n,branch,active]);
  }
  const metadata = async () => (await db.query(`SELECT polname,polcmd,polpermissive,polroles::text,
    pg_get_expr(polqual,polrelid) AS predicate,pg_get_expr(polwithcheck,polrelid) AS with_check
    FROM pg_policy WHERE polrelid='products'::regclass ORDER BY polname`)).rows;
  const visible = async user => {
    await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify(user ? {sub:id(user),role:'authenticated'} : {role:'authenticated'})]);
    await db.exec('SET ROLE authenticated');
    try { return (await db.query('SELECT id FROM products ORDER BY id')).rows.map(row=>row.id); }
    finally { await db.exec('RESET ROLE'); }
  };
  const expected = new Map([[1,[1,2,3,4,5,6]],[2,[1,3]],[3,[1,2]],[4,[]],[5,[]],[6,[]],[null,[]],[999,[]]]);
  const original = await metadata();
  for (const [user,rows] of expected) assert.deepEqual(await visible(user),rows);
  await db.exec(forward);
  for (const [user,rows] of expected) assert.deepEqual(await visible(user),rows);
  const optimized = await metadata();
  assert.deepEqual(optimized.filter(p=>p.polcmd!=='r'),original.filter(p=>p.polcmd!=='r'));
  assert.deepEqual(optimized.map(p=>[p.polname,p.polcmd,p.polpermissive,p.polroles]),original.map(p=>[p.polname,p.polcmd,p.polpermissive,p.polroles]));
  // Verify the plan evaluates invariant helpers once, with a real RLS read.
  await visible(2);
  await db.exec('SET ROLE authenticated');
  const plan = (await db.query('EXPLAIN (ANALYZE,FORMAT JSON) SELECT id FROM products')).rows[0]['QUERY PLAN'][0];
  await db.exec('RESET ROLE');
  const initPlans=[];
  const visit=node=>{if(node['Parent Relationship']==='InitPlan')initPlans.push(node); for(const child of node.Plans||[])visit(child);};
  visit(plan.Plan);
  assert.equal(initPlans.length,3);
  assert.ok(initPlans.every(p=>p['Actual Loops']<=1));
  await db.exec(rollback);
  assert.deepEqual(await metadata(),original);
  for (const [user,rows] of expected) assert.deepEqual(await visible(user),rows);
  await db.exec('ALTER POLICY auth_select_products ON products USING (true)');
  await assert.rejects(db.exec(forward),/PRODUCT_READ_POLICY_SOURCE_DRIFT/);
  await db.exec('ROLLBACK');
  console.log('PASS: 8 identities before/after/rollback, cross-branch and active filtering, unchanged write policies/roles, 3 one-shot RLS InitPlans, exact rollback digest, source-drift rejection.');
} finally { await db.close(); }
