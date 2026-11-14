import { it,expect } from 'vitest';
import { prepareCanonicalAtomicFixture } from './canonical-business-fixture';
it('commits canonical split tenders, stock and outbox together; rolls all effects back if outbox fails',async()=>{
  const {db,context,local,op,rows,quantity}=await prepareCanonicalAtomicFixture();
  try{
    const first=op(1);const response=await local.commit(context,first);expect(response.result.success).toBe(true);
    expect(await rows()).toEqual({sales:1,outbox:1,tenders:2});expect(await quantity()).toBe(9);
    expect((await local.commit(context,first)).duplicate).toBe(true);expect(await quantity()).toBe(9);
    const second=op(2);
    await db.exec(`CREATE FUNCTION public.fail_atomic_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ATOMIC_OUTBOX_FAILURE'; END $$;
      CREATE TRIGGER atomic_outbox_failure BEFORE INSERT ON branch_hub_v1.outbox FOR EACH ROW EXECUTE FUNCTION public.fail_atomic_outbox()`);
    await expect(local.commit(context,second)).rejects.toThrow('ATOMIC_OUTBOX_FAILURE');
    expect(await rows()).toEqual({sales:1,outbox:1,tenders:2});expect(await quantity()).toBe(9);
    await db.exec('DROP TRIGGER atomic_outbox_failure ON branch_hub_v1.outbox');
    await local.commit(context,second);expect(await rows()).toEqual({sales:2,outbox:2,tenders:4});expect(await quantity()).toBe(8);
  }finally{await db.close();}
},120000);
