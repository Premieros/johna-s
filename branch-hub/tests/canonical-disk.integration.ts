import { it } from 'vitest';
import { runCanonicalDiskScenario } from './canonical-disk-scenario.mjs';
it('restores encrypted canonical backup into a fresh disk DB and recovers split sales/outbox across process kills',async()=>{
  await runCanonicalDiskScenario();
},180000);
