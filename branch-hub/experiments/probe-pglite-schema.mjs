// Disposable A0 compatibility probe; no network/database connection string.
import { createCanonicalMemoryDatabase } from './canonical-memory-db.mjs';
const packageRoot=process.argv[2];
if (!packageRoot || (process.argv.length !== 3 && !(process.argv.length === 4 && process.argv[3] === '--financial-boundary'))) {
  throw new Error('Supply an installed PGlite package directory and optional --financial-boundary');
}
let db;
let report;
try {
  ({db,report}=await createCanonicalMemoryDatabase(packageRoot));
  report.businessParityTested=false;
  report.durabilityTested=false;
  if(process.argv[3]==='--financial-boundary') {
    report.stage='financial-boundary';
    const {testFinancialBoundary}=await import('./financial-boundary.mjs');
    report.financialBoundary=await testFinancialBoundary(db);
  }
} catch(error) {
  report=error.probeReport || {...report,error:String(error.message).slice(0,250),sqlstate:error.code};
  process.exitCode=1;
} finally {
  console.log(JSON.stringify(report,null,2));
  if(db) await db.close();
}
