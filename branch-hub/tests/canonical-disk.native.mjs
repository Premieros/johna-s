import test from 'node:test';
import { writeFile } from 'node:fs/promises';
import { runCanonicalDiskScenario } from './canonical-disk-scenario.mjs';
test('native canonical encrypted restore and real split-sale process-kill recovery',{timeout:180000},async()=>{
  const report=await runCanonicalDiskScenario();
  if(process.env.JOHNAS_DISK_TEST_REPORT)await writeFile(process.env.JOHNAS_DISK_TEST_REPORT,JSON.stringify(report,null,2));
});
