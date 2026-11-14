// Owned local fixture loader. No URLs, network DB clients or production data.
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function openOwnedPglite(packageRoot,{dataDir,loadDataDir}={}){
  if(!packageRoot||/:\/\//.test(packageRoot)||!dataDir||/:\/\//.test(dataDir))throw Error('OWNED_LOCAL_DIRECTORY_REQUIRED');
  const load=p=>import(pathToFileURL(join(resolve(packageRoot),'dist',p)).href);
  const {PGlite}=await load('index.js');
  const {pgcrypto}=await load('contrib/pgcrypto.js');
  const {uuid_ossp}=await load('contrib/uuid_ossp.js');
  const db=new PGlite({dataDir,...(loadDataDir?{loadDataDir}:{}),relaxedDurability:false,extensions:{pgcrypto,'uuid-ossp':uuid_ossp}});
  await db.waitReady;return db;
}
