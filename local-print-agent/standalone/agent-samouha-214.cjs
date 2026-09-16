const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SERVICE_NAME = 'johns-print-agent-samouha';
const VERSION = '2.1.4-samouha';
const HOST = '127.0.0.1';
const PORT = Number(process.env.JOHNS_PRINT_PORT || 17654);
const DATA_DIR = process.env.JOHNS_PRINT_DATA_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'JohnsPrintAgentSamouha');
const CONFIG_PATH = path.join(DATA_DIR, 'printer-config.json');
const LOG_PATH = path.join(DATA_DIR, 'agent.log');
const STATIONS = ['cashier', 'main', 'drinks'];
const LABELS = { cashier: 'الكاشير', main: 'المطبخ', drinks: 'الباريستا / المشروبات' };
const MAX_BODY = 256 * 1024;
const POWERSHELL_TIMEOUT_MS = 20000;
const PRINTER_CACHE_TTL_MS = 5000;
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 500;
const DEDUPE_TTL_MS = 10 * 60 * 1000;
const MAX_DEDUPE_ENTRIES = 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
const printerQueues = new Map();
const inFlightJobs = new Map();
const completedJobs = new Map();
let printerCache = { value: [], expiresAt: 0 };

function log(message){try{fs.appendFileSync(LOG_PATH,`${new Date().toISOString()} ${message}\n`,'utf8');}catch{}}
function originAllowed(origin){if(!origin||origin==='https://premieros.github.io')return true;try{const u=new URL(origin);return['127.0.0.1','localhost'].includes(u.hostname)&&['http:','https:'].includes(u.protocol);}catch{return false;}}
function applyCors(req,res){const origin=req.headers.origin;if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');}
function json(res,status,value){const body=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});res.end(body);}
function html(res,body){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(body);}
function readConfig(){try{const p=JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8'));const routes={};for(const s of STATIONS)if(p.routes&&p.routes[s])routes[s]=String(p.routes[s]);return{routes};}catch{return{routes:{}};}}
function saveConfig(routes){const safe={};for(const s of STATIONS)if(routes[s])safe[s]=String(routes[s]);const tmp=`${CONFIG_PATH}.tmp`;fs.writeFileSync(tmp,JSON.stringify({routes:safe},null,2)+'\n','utf8');fs.renameSync(tmp,CONFIG_PATH);return safe;}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function ps(script,envOverrides={}){return new Promise((resolve,reject)=>{execFile('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{windowsHide:true,timeout:POWERSHELL_TIMEOUT_MS,maxBuffer:1024*1024,env:{...process.env,...envOverrides}},(err,stdout,stderr)=>{if(err){const d=String(stderr||err.message||'').trim();if(err.killed||err.signal)return reject(new Error(`POWERSHELL_TIMEOUT${d?`: ${d}`:''}`));return reject(new Error(d||'POWERSHELL_FAILED'));}resolve(stdout);});});}
async function listPrinters(force=false){const now=Date.now();if(!force&&printerCache.expiresAt>now)return printerCache.value;const out=await ps('Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress');const parsed=JSON.parse(String(out||'[]').trim()||'[]');const printers=Array.isArray(parsed)?parsed.map(String).sort():(parsed?[String(parsed)]:[]);printerCache={value:printers,expiresAt:now+PRINTER_CACHE_TTL_MS};return printers;}
function invalidatePrinterCache(){printerCache={value:[],expiresAt:0};}
async function assertPrinterInstalled(name){if(!(await listPrinters()).includes(name))throw new Error('PRINTER_NOT_INSTALLED');}

const PRINT_DOCUMENT_SCRIPT = String.raw`
Add-Type -AssemblyName System.Drawing
$p = $env:JOHNS_PRINTER
$f = $env:JOHNS_PRINT_FILE
$text = [System.IO.File]::ReadAllText($f, [System.Text.Encoding]::UTF8)
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $p
if (-not $doc.PrinterSettings.IsValid) { throw 'PRINTER_SETTINGS_INVALID' }
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.DocumentName = 'Johns Print Agent Samouha'
$font = New-Object System.Drawing.Font('Arial', 10)
$brush = [System.Drawing.Brushes]::Black
$handler = [System.Drawing.Printing.PrintPageEventHandler]{
  param($sender,$e)
  $rect = New-Object System.Drawing.RectangleF(4, 4, [Math]::Max(100, $e.PageBounds.Width - 8), [Math]::Max(100, $e.PageBounds.Height - 8))
  $format = New-Object System.Drawing.StringFormat
  $format.Trimming = [System.Drawing.StringTrimming]::Word
  $e.Graphics.DrawString($text, $font, $brush, $rect, $format)
  $e.HasMorePages = $false
  $format.Dispose()
}
$doc.add_PrintPage($handler)
try { $doc.Print() } finally { $doc.remove_PrintPage($handler); $font.Dispose(); $doc.Dispose() }
'PRINT_SUBMITTED'
`;

async function printTextOnce(printerName,text){await assertPrinterInstalled(printerName);const tmp=path.join(os.tmpdir(),`johns-samouha-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);fs.writeFileSync(tmp,text,'utf8');try{const out=await ps(PRINT_DOCUMENT_SCRIPT,{JOHNS_PRINTER:printerName,JOHNS_PRINT_FILE:tmp});if(!String(out).includes('PRINT_SUBMITTED'))throw new Error('PRINT_NOT_SUBMITTED');return{engine:'PrintDocument'};}finally{try{fs.unlinkSync(tmp);}catch{}}}
async function kickDrawerOnce(printerName){await assertPrinterInstalled(printerName);throw new Error('DRAWER_NOT_SUPPORTED_IN_PRINTDOCUMENT_MODE');}
async function withRetry(op,label){let last;for(let i=1;i<=RETRY_ATTEMPTS;i++){try{return await op();}catch(e){last=e;invalidatePrinterCache();log(`${label} attempt ${i}/${RETRY_ATTEMPTS} failed: ${e.message||e}`);if(i<RETRY_ATTEMPTS)await sleep(RETRY_BASE_DELAY_MS*i);}}throw last||new Error('PRINT_FAILED');}
function enqueuePrinter(name,op){const prev=printerQueues.get(name)||Promise.resolve();const cur=prev.catch(()=>{}).then(op);printerQueues.set(name,cur);cur.finally(()=>{if(printerQueues.get(name)===cur)printerQueues.delete(name);}).catch(()=>{});return cur;}
function cleanupDedupe(){const now=Date.now();for(const [id,exp] of completedJobs)if(exp<=now)completedJobs.delete(id);while(completedJobs.size>MAX_DEDUPE_ENTRIES)completedJobs.delete(completedJobs.keys().next().value);}
function normalizeJobId(body){const raw=body.jobId??body.job_id??null;if(raw==null||raw==='')return null;const id=String(raw).trim();if(!/^[a-zA-Z0-9._:-]{1,128}$/.test(id))throw new Error('INVALID_JOB_ID');return id;}
async function runPrintJob({jobId,printer,text}){cleanupDedupe();if(jobId&&completedJobs.has(jobId))return{deduplicated:true,engine:'PrintDocument'};if(jobId&&inFlightJobs.has(jobId)){await inFlightJobs.get(jobId);return{deduplicated:true,engine:'PrintDocument'};}const task=enqueuePrinter(printer,()=>withRetry(()=>printTextOnce(printer,text),`print:${printer}`));if(jobId)inFlightJobs.set(jobId,task);try{const result=await task;if(jobId)completedJobs.set(jobId,Date.now()+DEDUPE_TTL_MS);return{deduplicated:false,engine:result.engine};}finally{if(jobId&&inFlightJobs.get(jobId)===task)inFlightJobs.delete(jobId);}}
function readBody(req){return new Promise((resolve,reject)=>{let size=0;const chunks=[];req.on('data',c=>{size+=c.length;if(size>MAX_BODY){reject(new Error('PAYLOAD_TOO_LARGE'));req.destroy();return;}chunks.push(c);});req.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'));}catch{reject(new Error('INVALID_JSON'));}});req.on('error',reject);});}

function configPage(){return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>طباعة فرع سموحة</title><style>body{font-family:Segoe UI,Tahoma,sans-serif;max-width:760px;margin:32px auto;padding:0 18px;background:#f6f7f9;color:#171717}.card{background:#fff;border:1px solid #ddd;border-radius:14px;padding:18px;margin:16px 0}label{display:block;font-weight:700;margin:14px 0 5px}select,button{font:inherit;padding:10px;border-radius:9px;border:1px solid #bbb}select{min-width:340px}button{cursor:pointer;background:#111;color:#fff;border:0;margin:10px 4px}.ok{color:#087a37}.muted{color:#666;font-size:13px}</style><body><h1>Johns Print Agent — فرع سموحة</h1><div class="muted">الإصدار ${VERSION} — محرك Windows PrintDocument</div><div class="card"><div id="status">جاري قراءة الطابعات…</div><div id="routes"></div><button onclick="save()">حفظ</button><button onclick="testPrint()">طباعة اختبار</button></div><script>const stations=${JSON.stringify(STATIONS)},labels=${JSON.stringify(LABELS)};let printers=[],config={routes:{}};async function load(){const p=await fetch('/printers').then(r=>r.json());const c=await fetch('/config').then(r=>r.json());printers=p.printers||[];config=c;render();}function esc(s){return String(s).replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}function render(){status.innerHTML='<span class="ok">الخدمة متصلة</span> — '+printers.length+' طابعة';routes.innerHTML=stations.map(s=>'<label>'+labels[s]+'</label><select data-st="'+s+'"><option value="">بدون طابعة</option>'+printers.map(p=>'<option '+((config.routes||{})[s]===p?'selected':'')+'>'+esc(p)+'</option>').join('')+'</select>').join('');}async function save(){const rts={};document.querySelectorAll('select[data-st]').forEach(x=>{if(x.value)rts[x.dataset.st]=x.value});const r=await fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({routes:rts})});const b=await r.json();if(!r.ok)return alert(b.error||'فشل الحفظ');config=b;alert('تم الحفظ');}async function testPrint(){const s=[...document.querySelectorAll('select[data-st]')].find(x=>x.value);if(!s)return alert('اختر طابعة أولاً');const b=await fetch('/print',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:s.dataset.st,printer:s.value,jobId:'samouha-test-'+Date.now(),text:'SAMOUHA PRINT TEST\\n'+labels[s.dataset.st]+'\\nXP-80C compatibility\\n'+new Date().toLocaleString()+'\\n\\n'})}).then(r=>r.json());alert(b.success?'تم تسليم مهمة الطباعة لويندوز عبر '+(b.engine||'PrintDocument'):(b.error||'فشل الطباعة'));}load().catch(e=>status.textContent='خطأ: '+e.message);</script></body></html>`;}

const server=http.createServer(async(req,res)=>{if(!originAllowed(req.headers.origin)){res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Origin not allowed');}applyCors(req,res);if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}try{const url=new URL(req.url,`http://${HOST}:${PORT}`);if(req.method==='GET'&&url.pathname==='/')return html(res,configPage());if(req.method==='GET'&&url.pathname==='/health'){cleanupDedupe();return json(res,200,{ok:true,service:SERVICE_NAME,version:VERSION,branch:'Samouha',stations:STATIONS,printEngine:'PrintDocument',activePrinterQueues:printerQueues.size,inFlightJobs:inFlightJobs.size});}if(req.method==='GET'&&url.pathname==='/printers')return json(res,200,{printers:await listPrinters()});if(req.method==='GET'&&url.pathname==='/config')return json(res,200,readConfig());if(req.method==='POST'&&url.pathname==='/config'){const body=await readBody(req),installed=await listPrinters(true),routes={};for(const s of STATIONS){const p=body.routes&&body.routes[s];if(p&&!installed.includes(String(p)))return json(res,400,{success:false,error:'PRINTER_NOT_INSTALLED',station:s});if(p)routes[s]=String(p);}return json(res,200,{routes:saveConfig(routes)});}if(req.method==='POST'&&url.pathname==='/print'){const body=await readBody(req),station=String(body.station||'main'),text=String(body.text||'');if(!STATIONS.includes(station))return json(res,400,{success:false,error:'STATION_NOT_ALLOWED_FOR_SAMOUHA',station});if(!text||text.length>200000)return json(res,400,{success:false,error:'INVALID_TEXT'});let jobId;try{jobId=normalizeJobId(body);}catch(e){return json(res,400,{success:false,error:e.message});}const printer=body.printer?String(body.printer):readConfig().routes[station];if(!printer)return json(res,409,{success:false,error:'STATION_NOT_CONFIGURED',station});const result=await runPrintJob({jobId,printer,text});return json(res,200,{success:true,station,printer,jobId,deduplicated:result.deduplicated,engine:result.engine});}if(req.method==='POST'&&url.pathname==='/drawer'){return json(res,501,{success:false,error:'DRAWER_NOT_SUPPORTED_IN_PRINTDOCUMENT_MODE'});}return json(res,404,{error:'NOT_FOUND'});}catch(e){log(`request failed: ${e.message||e}`);return json(res,500,{success:false,error:e.message||'PRINT_AGENT_ERROR'});}});
server.on('error',e=>{log(`server error: ${e.message}`);process.exitCode=1;});
server.listen(PORT,HOST,()=>log(`Johns Print Agent Samouha ${VERSION}: http://${HOST}:${PORT}`));
