import pg from 'pg';
import { readFileSync } from 'node:fs';
const value=process.env.SUPABASE_DB_URL;
if(process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true'||!value)throw new Error('Owned CI binding only');
const url=new URL(value);
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Loopback CI binding only');
const db=new pg.Client({connectionString:value});
await db.connect();
try{
  const ack="SET LOCAL app.kitchen_rollout_ack='johnas-kitchen-20261013-review-required';";
  const barrier=readFileSync('scripts/rollout/kitchen_activation_barrier_20261013.sql','utf8');
  const forward=readFileSync('scripts/rollout/kitchen_dedup_forward_review_20261013.sql','utf8');
  const rollback=readFileSync('scripts/rollout/kitchen_dedup_rollback_review_20261013.sql','utf8');
  const exists=(await db.query("SELECT to_regprocedure('public._kitchen_dispatch_component_plans(uuid,jsonb)') IS NOT NULL present")).rows[0].present;
  if(!exists)await db.query(forward.replace('BEGIN;', ['BEGIN;',ack,barrier].join(String.fromCharCode(10))));
  else{
    const guard=rollback.match(/DO \$guard\$[\s\S]*?\$guard\$;/)?.[0];
    if(!guard)throw new Error('Missing deployed definition guard');
    await db.query('BEGIN;'+ack+guard+'COMMIT;');
  }
  console.info('Bound canonical kitchen/count/receipt definitions for full CI; no production connection');
}finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
