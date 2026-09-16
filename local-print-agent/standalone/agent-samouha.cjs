const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const SERVICE_NAME = 'johns-print-agent-samouha';
const VERSION = '2.1.1-samouha';
const HOST = '127.0.0.1';
const PORT = Number(process.env.JOHNS_PRINT_PORT || 17654);
const DATA_DIR = process.env.JOHNS_PRINT_DATA_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'JohnsPrintAgent');
const CONFIG_PATH = path.join(DATA_DIR, 'printer-config.json');
const LOG_PATH = path.join(DATA_DIR, 'agent.log');
const STATIONS = ['cashier', 'main', 'drinks'];
const LABELS = { cashier: 'الكاشير', main: 'المطبخ', drinks: 'الباريستا / المشروبات' };
const MAX_BODY = 256 * 1024;
const POWERSHELL_TIMEOUT_MS = Number(process.env.JOHNS_PRINT_PS_TIMEOUT_MS || 15000);
const PRINTER_CACHE_TTL_MS = Number(process.env.JOHNS_PRINT_PRINTER_CACHE_TTL_MS || 5000);
const RETRY_ATTEMPTS = Math.max(1, Number(process.env.JOHNS_PRINT_RETRY_ATTEMPTS || 3));
const RETRY_BASE_DELAY_MS = Math.max(50, Number(process.env.JOHNS_PRINT_RETRY_DELAY_MS || 350));
const DEDUPE_TTL_MS = Math.max(60000, Number(process.env.JOHNS_PRINT_DEDUPE_TTL_MS || 10 * 60 * 1000));
const MAX_DEDUPE_ENTRIES = 1000;

fs.mkdirSync(DATA_DIR, { recursive: true });
const printerQueues = new Map();
const inFlightJobs = new Map();
const completedJobs = new Map();
let printerCache = { value: [], expiresAt: 0 };

function log(message) {
  try { fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}\n`, 'utf8'); } catch {}
  console.log(message);
}
function originAllowed(origin) {
  if (!origin || origin === 'https://premieros.github.io') return true;
  try {
    const url = new URL(origin);
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
  } catch { return false; }
}
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}
function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const routes = {};
    for (const station of STATIONS) if (parsed.routes && parsed.routes[station]) routes[station] = String(parsed.routes[station]);
    return { routes };
  } catch { return { routes: {} }; }
}
function saveConfig(routes) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const safe = {};
  for (const station of STATIONS) if (routes[station]) safe[station] = String(routes[station]);
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ routes: safe }, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, CONFIG_PATH);
  return safe;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function ps(script, args = []) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args], { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr || err.message || '').trim();
        if (err.killed || err.signal) return reject(new Error(`POWERSHELL_TIMEOUT${detail ? `: ${detail}` : ''}`));
        return reject(new Error(detail || 'POWERSHELL_FAILED'));
      }
      resolve(stdout);
    });
  });
}
async function listPrinters(force = false) {
  const now = Date.now();
  if (!force && printerCache.expiresAt > now) return printerCache.value;
  const out = await ps('Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress');
  const parsed = JSON.parse(String(out || '[]').trim() || '[]');
  const printers = Array.isArray(parsed) ? parsed.map(String).sort() : (parsed ? [String(parsed)] : []);
  printerCache = { value: printers, expiresAt: now + PRINTER_CACHE_TTL_MS };
  return printers;
}
function invalidatePrinterCache() { printerCache = { value: [], expiresAt: 0 }; }
async function assertPrinterInstalled(printerName) {
  if (!(await listPrinters()).includes(printerName)) throw new Error('PRINTER_NOT_INSTALLED');
}
async function printTextOnce(printerName, text) {
  await assertPrinterInstalled(printerName);
  const tmp = path.join(os.tmpdir(), `johns-samouha-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    await ps('$p=$args[0];$f=$args[1];Get-Content -LiteralPath $f -Raw -Encoding UTF8 | Out-Printer -Name $p', [printerName, tmp]);
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}
async function kickDrawerOnce(printerName) {
  await assertPrinterInstalled(printerName);
  const tmp = path.join(os.tmpdir(), `johns-drawer-${process.pid}-${Date.now()}.bin`);
  fs.writeFileSync(tmp, Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  try {
    await ps('$p=$args[0];$f=$args[1];Get-Content -LiteralPath $f -Encoding Byte -Raw | Out-Printer -Name $p', [printerName, tmp]);
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}
async function withRetry(operation, label) {
  let lastError;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
    try { return await operation(); }
    catch (err) {
      lastError = err; invalidatePrinterCache(); log(`${label} attempt ${attempt}/${RETRY_ATTEMPTS} failed: ${err.message || err}`);
      if (attempt < RETRY_ATTEMPTS) await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw lastError || new Error('PRINT_FAILED');
}
function enqueuePrinter(printerName, operation) {
  const previous = printerQueues.get(printerName) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  printerQueues.set(printerName, current);
  current.finally(() => { if (printerQueues.get(printerName) === current) printerQueues.delete(printerName); }).catch(() => {});
  return current;
}
function cleanupDedupe() {
  const now = Date.now();
  for (const [jobId, expiresAt] of completedJobs.entries()) if (expiresAt <= now) completedJobs.delete(jobId);
  while (completedJobs.size > MAX_DEDUPE_ENTRIES) completedJobs.delete(completedJobs.keys().next().value);
}
function normalizeJobId(body) {
  const raw = body.jobId ?? body.job_id ?? null;
  if (raw == null || raw === '') return null;
  const jobId = String(raw).trim();
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(jobId)) throw new Error('INVALID_JOB_ID');
  return jobId;
}
async function runPrintJob({ jobId, printer, text }) {
  cleanupDedupe();
  if (jobId && completedJobs.has(jobId)) return { deduplicated: true };
  if (jobId && inFlightJobs.has(jobId)) { await inFlightJobs.get(jobId); return { deduplicated: true }; }
  const task = enqueuePrinter(printer, () => withRetry(() => printTextOnce(printer, text), `print:${printer}`));
  if (jobId) inFlightJobs.set(jobId, task);
  try {
    await task;
    if (jobId) completedJobs.set(jobId, Date.now() + DEDUPE_TTL_MS);
    return { deduplicated: false };
  } finally { if (jobId && inFlightJobs.get(jobId) === task) inFlightJobs.delete(jobId); }
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('INVALID_JSON')); } });
    req.on('error', reject);
  });
}
function html(res, body) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); }
function configPage() {
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>طباعة فرع سموحة</title>
<style>body{font-family:Segoe UI,Tahoma,sans-serif;max-width:760px;margin:32px auto;padding:0 18px;background:#f6f7f9;color:#171717}.card{background:#fff;border:1px solid #ddd;border-radius:14px;padding:18px;margin:16px 0}label{display:block;font-weight:700;margin:14px 0 5px}select,button{font:inherit;padding:10px;border-radius:9px;border:1px solid #bbb}select{min-width:340px}button{cursor:pointer;background:#111;color:#fff;border:0;margin:10px 4px}.ok{color:#087a37}.muted{color:#666;font-size:13px}</style>
<body><h1>Johns Print Agent — فرع سموحة</h1><div class="muted">الإصدار ${VERSION} — المحطات المعتمدة لسموحة فقط.</div>
<div class="card"><div id="status">جاري قراءة الطابعات…</div><div id="routes"></div><button onclick="save()">حفظ</button><button onclick="testPrint()">طباعة اختبار</button></div>
<div class="card muted">الكاشير = cashier &nbsp; | &nbsp; المطبخ = main &nbsp; | &nbsp; الباريستا = drinks</div>
<script>
const stations=${JSON.stringify(STATIONS)}, labels=${JSON.stringify(LABELS)}; let printers=[],config={routes:{}};
async function load(){const p=await fetch('/printers').then(r=>r.json());const c=await fetch('/config').then(r=>r.json());printers=p.printers||[];config=c;render();}
function esc(s){return String(s).replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
function render(){document.getElementById('status').innerHTML='<span class="ok">الخدمة متصلة</span> — '+printers.length+' طابعة';document.getElementById('routes').innerHTML=stations.map(s=>'<label>'+esc(labels[s])+'</label><select data-st="'+s+'"><option value="">بدون طابعة</option>'+printers.map(p=>'<option '+((config.routes||{})[s]===p?'selected':'')+'>'+esc(p)+'</option>').join('')+'</select>').join('');}
async function save(){const routes={};document.querySelectorAll('select[data-st]').forEach(x=>{if(x.value)routes[x.dataset.st]=x.value});const r=await fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({routes})});const body=await r.json();if(!r.ok)return alert(body.error||'فشل الحفظ');config=body;alert('تم حفظ طابعات فرع سموحة');}
async function testPrint(){const s=[...document.querySelectorAll('select[data-st]')].find(x=>x.value);if(!s)return alert('اختر طابعة أولاً');const r=await fetch('/print',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:s.dataset.st,printer:s.value,jobId:'samouha-test-'+Date.now(),text:'SAMOUHA PRINT TEST\\n'+labels[s.dataset.st]+'\\n'+new Date().toLocaleString()+'\\n\\n'})}).then(r=>r.json());alert(r.success?'تم إرسال الاختبار للطابعة':(r.error||'فشل الطباعة'));}
load().catch(e=>document.getElementById('status').textContent='خطأ: '+e.message);
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  if (!originAllowed(req.headers.origin)) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Origin not allowed'); }
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/') return html(res, configPage());
    if (req.method === 'GET' && url.pathname === '/health') { cleanupDedupe(); return json(res, 200, { ok: true, service: SERVICE_NAME, version: VERSION, branch: 'Samouha', stations: STATIONS, activePrinterQueues: printerQueues.size, inFlightJobs: inFlightJobs.size }); }
    if (req.method === 'GET' && url.pathname === '/printers') return json(res, 200, { printers: await listPrinters() });
    if (req.method === 'GET' && url.pathname === '/config') return json(res, 200, readConfig());
    if (req.method === 'POST' && url.pathname === '/config') {
      const body = await readBody(req); const installed = await listPrinters(true); const routes = {};
      for (const station of STATIONS) { const printer = body.routes && body.routes[station]; if (printer && !installed.includes(String(printer))) return json(res, 400, { success: false, error: 'PRINTER_NOT_INSTALLED', station }); if (printer) routes[station] = String(printer); }
      return json(res, 200, { routes: saveConfig(routes) });
    }
    if (req.method === 'POST' && url.pathname === '/print') {
      const body = await readBody(req); const station = String(body.station || 'main'); const text = String(body.text || '');
      if (!STATIONS.includes(station)) return json(res, 400, { success: false, error: 'STATION_NOT_ALLOWED_FOR_SAMOUHA', station });
      if (!text || text.length > 200000) return json(res, 400, { success: false, error: 'INVALID_TEXT' });
      let jobId; try { jobId = normalizeJobId(body); } catch (err) { return json(res, 400, { success: false, error: err.message }); }
      const printer = body.printer ? String(body.printer) : readConfig().routes[station];
      if (!printer) return json(res, 409, { success: false, error: 'STATION_NOT_CONFIGURED', station });
      const result = await runPrintJob({ jobId, printer, text });
      return json(res, 200, { success: true, station, printer, jobId, deduplicated: result.deduplicated });
    }
    if (req.method === 'POST' && url.pathname === '/drawer') {
      const body = await readBody(req); const printer = body.printer ? String(body.printer).trim() : String(readConfig().routes.cashier || '').trim();
      if (!printer) return json(res, 409, { success: false, error: 'CASHIER_PRINTER_NOT_CONFIGURED' });
      await enqueuePrinter(printer, () => withRetry(() => kickDrawerOnce(printer), `drawer:${printer}`)); return json(res, 200, { success: true, printer });
    }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (err) { log(`request failed: ${err.message || err}`); return json(res, 500, { success: false, error: err.message || 'PRINT_AGENT_ERROR' }); }
});
server.on('error', err => { log(`server error: ${err.message}`); process.exitCode = 1; });
server.listen(PORT, HOST, () => { log(`Johns Print Agent Samouha ${VERSION}: http://${HOST}:${PORT}`); });
