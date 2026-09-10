const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.JOHNS_PRINT_PORT || 17654);
const CONFIG_PATH = path.join(__dirname, 'printer-config.json');
const MAX_BODY = 256 * 1024;

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

async function listPrinters() {
  const out = await ps("Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress");
  const parsed = JSON.parse(String(out || '[]').trim() || '[]');
  if (Array.isArray(parsed)) return parsed.map(String).sort();
  return parsed ? [String(parsed)] : [];
}

async function printText(printerName, text) {
  const printers = await listPrinters();
  if (!printers.includes(printerName)) throw new Error('PRINTER_NOT_INSTALLED');
  const tmp = path.join(os.tmpdir(), `johns-ticket-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
  fs.writeFileSync(tmp, text, 'utf8');
  try {
    const script = "$p=$args[0];$f=$args[1];Get-Content -LiteralPath $f -Raw -Encoding UTF8 | Out-Printer -Name $p";
    await ps(script, [printerName, tmp]);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
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
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>Johns Print Service</title>
<style>body{font-family:Segoe UI,Tahoma,sans-serif;max-width:820px;margin:32px auto;padding:0 18px;background:#f6f7f9;color:#171717}h1{margin-bottom:4px}.card{background:#fff;border:1px solid #ddd;border-radius:14px;padding:18px;margin:16px 0}label{display:block;font-weight:700;margin:12px 0 5px}select,input,button{font:inherit;padding:10px;border-radius:9px;border:1px solid #bbb}select{min-width:320px}button{cursor:pointer;background:#111;color:#fff;border:0;margin:8px 4px}.ok{color:#087a37}.muted{color:#666;font-size:13px}</style>
<body><h1>Johns Print Service</h1><div class="muted">إعداد الطابعات لهذا الجهاز فقط — لا يتم إرسال أسماء الطابعات إلى قاعدة البيانات.</div>
<div class="card"><div id="status">جاري قراءة الطابعات…</div><div id="routes"></div><button onclick="save()">حفظ</button><button onclick="testPrint()">طباعة اختبار للمحطة المختارة</button></div>
<div class="card muted">في Johns: <b>drinks</b> للمشروبات/الباريستا و <b>main</b> للمطبخ العام. المحطات الأخرى متاحة إذا تم استخدامها لاحقًا.</div>
<script>
let printers=[],config={routes:{}},stations=['main','drinks','grill','salad','dessert','fryer'];
async function load(){const p=await fetch('/printers').then(r=>r.json());const c=await fetch('/config').then(r=>r.json());printers=p.printers||[];config=c;render();}
function esc(s){return String(s).replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
function render(){document.getElementById('status').innerHTML='<span class="ok">الخدمة متصلة</span> — '+printers.length+' طابعة';const extra=Object.keys(config.routes||{}).filter(x=>!stations.includes(x));stations=[...stations,...extra];document.getElementById('routes').innerHTML=stations.map(s=>'<label>'+esc(s)+'</label><select data-st="'+esc(s)+'"><option value="">بدون طابعة / استخدم fallback</option>'+printers.map(p=>'<option '+((config.routes||{})[s]===p?'selected':'')+'>'+esc(p)+'</option>').join('')+'</select>').join('');}
async function save(){const routes={};document.querySelectorAll('select[data-st]').forEach(x=>{if(x.value)routes[x.dataset.st]=x.value});const r=await fetch('/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({routes})});config=await r.json();alert('تم الحفظ');}
async function testPrint(){const s=document.querySelector('select[data-st]');if(!s||!s.value)return alert('اختر طابعة أولاً');const r=await fetch('/print',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:s.dataset.st,printer:s.value,text:'JOHNS PRINT TEST\\nStation: '+s.dataset.st+'\\nPrinter: '+s.value+'\\n'+new Date().toLocaleString()+'\\n\\n'})}).then(r=>r.json());alert(r.success?'تم إرسال الاختبار للطابعة':(r.error||'فشل الطباعة'));}
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
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'johns-print-agent', version: 1 });
    if (req.method === 'GET' && url.pathname === '/printers') return json(res, 200, { printers: await listPrinters() });
    if (req.method === 'GET' && url.pathname === '/config') return json(res, 200, readConfig());
    if (req.method === 'POST' && url.pathname === '/config') {
      const body = await readBody(req);
      const printers = await listPrinters();
      const routes = {};
      for (const [station, printer] of Object.entries(body.routes || {})) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/.test(station)) return json(res, 400, { success: false, error: 'INVALID_STATION' });
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
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(station)) return json(res, 400, { success: false, error: 'INVALID_STATION' });
      if (!text || text.length > 200000) return json(res, 400, { success: false, error: 'INVALID_TEXT' });
      const config = readConfig();
      const printer = body.printer ? String(body.printer) : config.routes[station];
      if (!printer) return json(res, 409, { success: false, error: 'STATION_NOT_CONFIGURED', station });
      await printText(printer, text);
      return json(res, 200, { success: true, station, printer });
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
