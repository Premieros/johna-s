// Personal-PC update experiment. No Supabase, GitHub, printers or production URLs.
import { createServer } from 'node:http';
import { readFile, mkdir, rename, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { makeRelease, verifyRelease } from './release-contract.mjs';
const here=fileURLToPath(new URL('.',import.meta.url));
export async function startLab({dataDir=join(here,'.state'),host='127.0.0.1',port=58110,feedPort=58111,pollMs=2000}={}) {
  dataDir=resolve(dataDir);await mkdir(dataDir,{recursive:true});
  async function atomic(name,value) {
    const tmp=join(dataDir,`${name}.${randomUUID()}.tmp`);
    const f=await open(tmp,'wx',0o600);
    try{await f.writeFile(JSON.stringify(value));await f.sync();}finally{await f.close();}
    await rename(tmp,join(dataDir,name));
  }
  async function existing(name,fallback) {try{return JSON.parse(await readFile(join(dataDir,name),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return fallback();}}
  const keys=await existing('lab-only-signing-keys.json',()=>{const pair=generateKeyPairSync('ed25519');return {privateKey:pair.privateKey.export({format:'pem',type:'pkcs8'}),publicKey:pair.publicKey.export({format:'pem',type:'spki'})};});
  await atomic('lab-only-signing-keys.json',keys);
  let state=await existing('state.json',()=>({sequence:1,payload:{title:'الإصدار الأول',newScreen:false},draft:'',draftRevision:0,payments:0}));
  await atomic('state.json',state);
  let queue=Promise.resolve(),busy=false,staged=null,status='ready',lastError='',feedOnline=true;
  let published=makeRelease(state.sequence,state.payload,keys.privateKey);
  const edit=fn=>{const next=queue.then(async()=>{const candidate=structuredClone(state);await fn(candidate);await atomic('state.json',candidate);state=candidate;});queue=next.catch(()=>{});return next;};
  const view=()=>({...state,busy,stagedSequence:staged?.sequence||null,status,lastError,feedOnline,labOnly:true,productionContacted:false});
  const respond=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>20000)throw Error('REQUEST_TOO_LARGE');}return JSON.parse(text||'{}');}
  function allowed(req,actualPort){
    const expected=`http://127.0.0.1:${actualPort}`;
    return req.headers.host===`127.0.0.1:${actualPort}`&&(!req.headers.origin||req.headers.origin===expected)&&(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']));
  }
  const ui=createServer(async(req,res)=>{
    try{
      if(!allowed(req,port)){respond(res,403,{error:'LOCAL_ORIGIN_REQUIRED'});return;}
      if(req.method==='GET'&&req.url==='/'){
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'});
        res.end(await readFile(join(here,'index.html')));return;
      }
      if(req.method==='GET'&&req.url==='/api/state'){respond(res,200,view());return;}
      if(req.method!=='POST'||req.headers['content-type']!=='application/json'){respond(res,404,{error:'NOT_FOUND'});return;}
      const data=await body(req);
      if(req.url==='/api/draft'){
        if(typeof data.text!=='string'||data.text.length>4000||!Number.isSafeInteger(data.revision)||data.revision<1)throw Error('INVALID_DRAFT');
        await edit(s=>{if(data.revision>s.draftRevision){s.draft=data.text;s.draftRevision=data.revision;}});
      }else if(req.url==='/api/publish-demo'){
        const n=published.manifest.sequence+1;
        published=makeRelease(n,{title:`الإصدار التجريبي ${n}`,newScreen:true},keys.privateKey);
        if(data.corrupt===true)published.bytes=Buffer.from('{"tampered":true}');
      }else if(req.url==='/api/feed'){
        if(typeof data.online!=='boolean')throw Error('INVALID_FEED_STATE');feedOnline=data.online;
      }else if(req.url==='/api/payment-demo'){
        if(busy){respond(res,409,{error:'PAYMENT_BUSY'});return;}
        busy=true;
        try{await new Promise(r=>setTimeout(r,3000));await edit(s=>{s.payments++;});}finally{busy=false;}
      }else{respond(res,404,{error:'NOT_FOUND'});return;}
      respond(res,200,view());
    }catch(e){respond(res,400,{error:String(e.message)});}
  });
  const feed=createServer((req,res)=>{
    if(!allowed(req,feedPort)){respond(res,403,{error:'LOCAL_ORIGIN_REQUIRED'});return;}
    if(req.method!=='GET'||!['/manifest','/payload'].includes(req.url)){respond(res,404,{error:'NOT_FOUND'});return;}
    if(!feedOnline){respond(res,503,{error:'SIMULATED_FEED_OFFLINE'});return;}
    if(req.url==='/manifest')respond(res,200,published.manifest);
    else{res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store'});res.end(published.bytes);}
  });
  const listen=(server,p)=>new Promise((ok,no)=>{server.once('error',no);server.listen(p,host,ok);});
  await listen(ui,port);port=ui.address().port;
  try{await listen(feed,feedPort);}catch(e){await new Promise(r=>ui.close(r));throw e;}
  feedPort=feed.address().port;
  let checking=false,stopped=false;
  async function poll(){
    if(checking||stopped)return;checking=true;
    try{
      const m=await fetch(`http://127.0.0.1:${feedPort}/manifest`,{signal:AbortSignal.timeout(1500)});
      if(!m.ok)throw Error('FEED_UNAVAILABLE');
      const manifest=await m.json();
      if(manifest.sequence>state.sequence){
        const p=await fetch(`http://127.0.0.1:${feedPort}/payload`,{signal:AbortSignal.timeout(1500)});
        if(!p.ok)throw Error('PAYLOAD_UNAVAILABLE');
        staged=verifyRelease(manifest,Buffer.from(await p.arrayBuffer()),{publicKey:keys.publicKey,currentSequence:state.sequence,schemaVersion:1});
      }
      lastError='';
      if(staged&&!busy){const candidate=staged;await edit(s=>{if(candidate.sequence>s.sequence){s.sequence=candidate.sequence;s.payload=candidate.payload;}});staged=null;status='updated';}
      else status=staged?'waiting-for-payment':'ready';
    }catch(e){lastError=String(e.message);status='offline-or-rejected';}
    finally{checking=false;}
  }
  const timer=setInterval(()=>void poll(),pollMs);timer.unref();
  return {port,feedPort,view,poll,close:async()=>{stopped=true;clearInterval(timer);while(checking)await new Promise(r=>setTimeout(r,10));await queue;await Promise.all([new Promise(r=>ui.close(r)),new Promise(r=>feed.close(r))]);}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const lab=await startLab({dataDir:process.env.JOHNAS_UPDATE_LAB_DATA||join(here,'.state'),host:process.env.JOHNAS_UPDATE_LAB_CONTAINER==='1'?'0.0.0.0':'127.0.0.1'});
  console.log(`UPDATE LAB ONLY: http://127.0.0.1:${lab.port} — no production connection. Ctrl+C stops.`);
  const stop=async()=>{await lab.close();process.exit(0);};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
