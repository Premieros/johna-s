const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.JOHNS_PRINT_PORT || 17654);
const CONFIG_PATH = path.join(__dirname, 'printer-config.json');
const STATIONS_PATH = path.join(__dirname, 'cleopatra-stations.json');
const MAX_BODY = 256 * 1024;
const PREFLIGHT_RETRY_DELAYS_MS = [150, 350];
const printerLanes = new Map();
const printerQueueDepth = new Map();

function originAllowed(origin) {
  if (!origin) return true;
  if (origin === 'https://premieros.github.io') return true;
  try {
    const url = new URL(origin);
    return (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { routes: parsed.routes && typeof parsed.routes === 'object' ? parsed.routes : {} };
  } catch {
    return { routes: {} };
  }
}

function readStations() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATIONS_PATH, 'utf8'));
    const stations = Array.isArray(parsed.stations) ? parsed.stations : [];
    return {
      branch_id: String(parsed.branch_id || ''),
      branch_name: String(parsed.branch_name || ''),
      stations: stations
        .map((station) => ({
          code: String(station?.code || ''),
          name_ar: String(station?.name_ar || ''),
          name_en: String(station?.name_en || ''),
        }))
        .filter((station) => station.code),
    };
  } catch {
    return { branch_id: '', branch_name: '', stations: [] };
  }
}


function saveConfig(routes) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ routes }, null, 2) + '\n', 'utf8');
}

function ps(script, args = []) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').trim()));
      resolve(stdout);
    });
  });
}

function psFile(filePath, args = []) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', filePath, ...args], { windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').trim()));
      resolve(stdout);
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printerKey(printerName) {
  return String(printerName || '').trim().toLocaleLowerCase();
}

function queueDepthFor(printerName) {
  return printerQueueDepth.get(printerKey(printerName)) || 0;
}

function queueSnapshot() {
  return Array.from(printerQueueDepth.entries())
    .filter(([, depth]) => depth > 0)
    .map(([printer, depth]) => ({ printer, depth }));
}

function enqueuePrinterTask(printerName, task) {
  const key = printerKey(printerName);
  if (!key) return Promise.reject(new Error('PRINTER_NAME_REQUIRED'));

  printerQueueDepth.set(key, (printerQueueDepth.get(key) || 0) + 1);
  const previous = printerLanes.get(key) || Promise.resolve();
  let current;
  current = previous
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      const nextDepth = Math.max(0, (printerQueueDepth.get(key) || 1) - 1);
      if (nextDepth === 0) printerQueueDepth.delete(key);
      else printerQueueDepth.set(key, nextDepth);
      if (printerLanes.get(key) === current) printerLanes.delete(key);
    });
  printerLanes.set(key, current);
  return current;
}

async function listPrinters() {
  const out = await ps("Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress");
  const parsed = JSON.parse(String(out || '[]').trim() || '[]');
  if (Array.isArray(parsed)) return parsed.map(String).sort();
  return parsed ? [String(parsed)] : [];
}

async function ensureSpoolerReady(printerName) {
  const script = "$p=$args[0];$svc=Get-Service -Name Spooler -ErrorAction Stop;if($svc.Status -ne 'Running'){throw 'PRINT_SPOOLER_NOT_RUNNING'};$printer=Get-Printer -Name $p -ErrorAction Stop;if($printer.PrinterStatus -eq 'Offline'){throw 'PRINTER_OFFLINE'}";
  await ps(script, [printerName]);
}

async function ensureSpoolerReadyWithRetry(printerName) {
  let lastError;
  for (let attempt = 0; attempt <= PREFLIGHT_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await ensureSpoolerReady(printerName);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= PREFLIGHT_RETRY_DELAYS_MS.length) break;
      await sleep(PREFLIGHT_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError || new Error('PRINT_SPOOLER_NOT_READY');
}

const ESC_POS_RASTER_SCRIPT_PATH = path.join(__dirname, 'print-escpos-raster.ps1');

async function submitTextToSpooler(printerName, text, paperWidthMm = 80) {
  const tmp = path.join(os.tmpdir(), `johns-ticket-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  fs.writeFileSync(tmp, text, { encoding: 'utf8' });
  try {
    await psFile(ESC_POS_RASTER_SCRIPT_PATH, [printerName, tmp, String(Number(paperWidthMm) <= 58 ? 58 : 80)]);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function printText(printerName, text, paperWidthMm = 80) {
  return enqueuePrinterTask(printerName, async () => {
    const printers = await listPrinters();
    if (!printers.includes(printerName)) throw new Error('PRINTER_NOT_INSTALLED');

    // Retry only the preflight. Once the raw ESC/POS raster write is invoked we never retry here,
    // because an ambiguous retry could produce a duplicate physical ticket.
    await ensureSpoolerReadyWithRetry(printerName);
    await submitTextToSpooler(printerName, text, paperWidthMm);
    return { acceptedBySpooler: true };
  });
}

async function kickDrawer(printerName) {
  const printers = await listPrinters();
  if (!printers.includes(printerName)) throw new Error('PRINTER_NOT_INSTALLED');
  const tmp = path.join(os.tmpdir(), `johns-drawer-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
  fs.writeFileSync(tmp, Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));
  try {
    const script = '$p=$args[0];$f=$args[1];Get-Content -LiteralPath $f -Encoding Byte -Raw | Out-Printer -Name $p';
    await ps(script, [printerName, tmp]);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

function html(res, body) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function configPage() {
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>Johns Print Service - Cleopatra</title>
<style>
body{font-family:Segoe UI,Tahoma,sans-serif;max-width:920px;margin:32px auto;padding:0 18px;background:#f6f7f9;color:#171717}
h1{margin-bottom:4px}.card{background:#fff;border:1px solid #ddd;border-radius:14px;padding:18px;margin:16px 0}
.station{display:grid;grid-template-columns:minmax(160px,1fr) minmax(320px,2fr) auto;gap:10px;align-items:end;margin:12px 0}
label{display:block;font-weight:700;margin-bottom:5px}.code{font-size:12px;color:#666;direction:ltr;text-align:right}
select,button{font:inherit;padding:10px;border-radius:9px;border:1px solid #bbb}
select{width:100%;min-width:0}button{cursor:pointer;background:#111;color:#fff;border:0;white-space:nowrap}
.ok{color:#087a37}.bad{color:#a11}.muted{color:#666;font-size:13px}.branch{font-weight:700}
@media(max-width:720px){.station{grid-template-columns:1fr}.station button{width:100%}}
</style>
<body>
<h1>Johns Print Service — كليوباترا</h1>
<div class="muted">إعداد الطابعات على جهاز كليوباترا فقط. اسم الطابعة يُستخدم من Windows كما هو بدون إعادة تنسيق.</div>
<div class="card">
  <div id="status">جاري قراءة المحطات والطابعات…</div>
  <div id="branch" class="branch"></div>
  <div id="routes"></div>
  <button onclick="save()">حفظ التعيينات</button>
</div>
<script>
let printers=[],config={routes:{}},stationConfig={stations:[]};

async function load(){
  const [p,c,st]=await Promise.all([
    fetch('/printers').then(r=>r.json()),
    fetch('/config').then(r=>r.json()),
    fetch('/stations').then(r=>r.json())
  ]);
  printers=Array.isArray(p.printers)?p.printers:[];
  config=c||{routes:{}};
  stationConfig=st||{stations:[]};
  render();
}

function esc(s){
  return String(s??'').replace(/[&<>"']/g,m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

function printerIndexForName(name){
  return printers.findIndex(p=>String(p)===String(name||''));
}

function render(){
  document.getElementById('status').innerHTML='<span class="ok">الخدمة متصلة</span> — '+printers.length+' طابعة';
  document.getElementById('branch').textContent='الفرع: '+(stationConfig.branch_name||'كليوباترا');
  const stations=Array.isArray(stationConfig.stations)?stationConfig.stations:[];
  if(!stations.length){
    document.getElementById('routes').innerHTML='<p class="bad">لم يتم تحميل المحطات الفعلية.</p>';
    return;
  }
  document.getElementById('routes').innerHTML=stations.map(st=>{
    const code=String(st.code||'');
    const label=String(st.name_ar||st.name_en||code);
    const selectedIndex=printerIndexForName((config.routes||{})[code]);
    const options=['<option value="">بدون طابعة</option>']
      .concat(printers.map((p,i)=>'<option value="'+i+'" '+(i===selectedIndex?'selected':'')+'>'+esc(p)+'</option>'))
      .join('');
    return '<div class="station" data-station="'+esc(code)+'">'
      +'<div><label>'+esc(label)+'</label><div class="code">'+esc(code)+'</div></div>'
      +'<select data-st="'+esc(code)+'">'+options+'</select>'
      +'<button type="button" onclick="testStation(this)">اختبار هذه المحطة</button>'
      +'</div>';
  }).join('');
}

async function save(){
  const routes={};
  document.querySelectorAll('select[data-st]').forEach(sel=>{
    if(sel.value==='') return;
    const idx=Number(sel.value);
    const rawName=printers[idx];
    if(typeof rawName==='string'&&rawName) routes[sel.dataset.st]=rawName;
  });
  const response=await fetch('/config',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({routes})
  });
  const result=await response.json();
  if(!response.ok) return alert(result.error||'فشل الحفظ');
  config=result;
  alert('تم حفظ المحطات الفعلية');
}

async function testStation(button){
  const row=button.closest('.station');
  const sel=row?.querySelector('select[data-st]');
  if(!sel||sel.value==='') return alert('اختر طابعة لهذه المحطة أولاً');
  const idx=Number(sel.value);
  const rawName=printers[idx];
  if(typeof rawName!=='string'||!rawName) return alert('اسم الطابعة غير صالح');
  const station=sel.dataset.st;
  const response=await fetch('/print',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      station,
      printerIndex:idx,
      text:'اختبار طباعة كليوباترا\\nالمحطة: '+station+'\\nPrinter: '+rawName+'\\n'+new Date().toLocaleString('ar-EG')+'\\n\\n'
    })
  });
  const result=await response.json();
  alert(response.ok&&result.success?'تم إرسال الاختبار للطابعة':(result.error||'فشل الطباعة'));
}

load().catch(e=>document.getElementById('status').textContent='خطأ: '+e.message);
</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Origin not allowed');
  }
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/') return html(res, configPage());
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'johns-print-agent', version: 4, transport: 'escpos-raw-raster', queue: queueSnapshot() });
    if (req.method === 'GET' && url.pathname === '/queue') return json(res, 200, { queue: queueSnapshot() });
    if (req.method === 'GET' && url.pathname === '/printers') return json(res, 200, { printers: await listPrinters() });
    if (req.method === 'GET' && url.pathname === '/config') return json(res, 200, readConfig());
    if (req.method === 'GET' && url.pathname === '/stations') return json(res, 200, readStations());
    if (req.method === 'POST' && url.pathname === '/config') {
      const body = await readBody(req);
      const printers = await listPrinters();
      const routes = {};
      for (const [station, printer] of Object.entries(body.routes || {})) {
        if (!/^[a-zA-Z0-9_\-\u0600-\u06FF]{1,64}$/.test(station)) return json(res, 400, { success: false, error: 'INVALID_STATION' });
        if (printer && !printers.includes(String(printer))) return json(res, 400, { success: false, error: 'PRINTER_NOT_INSTALLED', station });
        if (printer) routes[station] = String(printer);
      }
      saveConfig(routes);
      return json(res, 200, { routes });
    }
    if (req.method === 'POST' && url.pathname === '/print') {
      const body = await readBody(req);
      const station = String(body.station || 'main');
      const text = String(body.text || '');
      if (!/^[a-zA-Z0-9_\-\u0600-\u06FF]{1,64}$/.test(station)) return json(res, 400, { success: false, error: 'INVALID_STATION' });
      if (!text || text.length > 200000) return json(res, 400, { success: false, error: 'INVALID_TEXT' });
      const config = readConfig();
      const printers = await listPrinters();
      let printer = '';
      if (Number.isInteger(body.printerIndex)) {
        const index = Number(body.printerIndex);
        if (index < 0 || index >= printers.length) return json(res, 400, { success: false, error: 'INVALID_PRINTER_INDEX' });
        printer = printers[index];
      } else if (body.printer) {
        printer = String(body.printer);
      } else {
        printer = config.routes[station];
      }
      if (!printer) return json(res, 409, { success: false, error: 'STATION_NOT_CONFIGURED', station });
      if (!printers.includes(printer)) return json(res, 400, { success: false, error: 'PRINTER_NOT_INSTALLED', printer });
      const queuedAhead = queueDepthFor(printer);
      const paperWidthMm = Number(body.paperWidthMm || 80);
      const result = await printText(printer, text, paperWidthMm);
      return json(res, 200, { success: true, station, printer, acceptedBySpooler: Boolean(result?.acceptedBySpooler), queuedAhead });
    }
    if (req.method === 'POST' && url.pathname === '/drawer') {
      const body = await readBody(req);
      const config = readConfig();
      const printer = body.printer ? String(body.printer).trim() : String(config.routes.cashier || config.routes.receipt || config.routes.main || '').trim();
      if (!printer) return json(res, 409, { success: false, error: 'DRAWER_PRINTER_NOT_CONFIGURED' });
      await kickDrawer(printer);
      return json(res, 200, { success: true, printer });
    }
    return json(res, 404, { error: 'NOT_FOUND' });
  } catch (err) {
    return json(res, 500, { success: false, error: err instanceof Error ? err.message : 'PRINT_AGENT_ERROR' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Johns Print Service: http://${HOST}:${PORT}`);
  console.log(`Printer setup: http://${HOST}:${PORT}/`);
});