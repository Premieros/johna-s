// Premier POS - Windows Desktop shell.
// Exposes only the minimal local hardware bridge required for printing.
//
// Thermal printing V2 safety rules:
// - every Windows printer has its own serialized queue + hidden BrowserWindow
// - different printers run independently, so one bad queue cannot block the rest
// - load/print operations have bounded timeouts
// - an ambiguous timeout is NEVER retried automatically (avoids duplicate receipts)
// - physical inventory/payment side effects remain owned by the web app/backend

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const DEFAULT_URL = 'https://premieros.github.io/johna-s/';
const TRUSTED_ORIGIN = 'https://premieros.github.io';
const DEFAULT_THERMAL_WIDTH_MM = 80;
const THERMAL_BOTTOM_FEED_MM = 5;
const PX_PER_INCH = 96;
const MICRONS_PER_INCH = 25400;
const PRINT_TIMEOUT_MS = 15000;
const LOAD_TIMEOUT_MS = 8000;
const DRAWER_TIMEOUT_MS = 5000;
const WORKER_IDLE_TTL_MS = 60000;
const MAX_PENDING_PER_PRINTER = 100;
const MAX_RECENT_JOBS = 100;

let mainWindow = null;
let nextPrintJobId = 1;

// printerName -> { tail: Promise, pending: number, activeJobId: string|null }
const printerQueues = new Map();
// printerName -> { window: BrowserWindow, idleTimer: NodeJS.Timeout|null }
const printerWorkers = new Map();
const recentPrintJobs = new Map();

function resolveTargetUrl() {
  const candidate = process.env.ELECTRON_START_URL || process.env.POS_APP_URL || DEFAULT_URL;
  try {
    const parsed = new URL(candidate);
    const isTrustedProduction = parsed.origin === TRUSTED_ORIGIN && parsed.pathname.startsWith('/johna-s');
    const isLocalDev = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    if (isTrustedProduction || isLocalDev) return candidate;
  } catch {
    // Fall through to the pinned production URL.
  }
  return DEFAULT_URL;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeThermalWidthMm(value) {
  const width = Number(value);
  return width === 58 ? 58 : DEFAULT_THERMAL_WIDTH_MM;
}

function thermalCss(widthMm) {
  return `
<style id="premier-thermal-page">
  @page { size: ${widthMm}mm auto; margin: 0; }
  html, body {
    width: ${widthMm}mm !important;
    min-width: ${widthMm}mm !important;
    max-width: ${widthMm}mm !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
    overflow: visible !important;
  }
  body { box-sizing: border-box !important; }
  *, *::before, *::after { box-sizing: border-box; }
</style>`;
}

function applyThermalLayout(html, widthMm) {
  const css = thermalCss(widthMm);
  const title = '<title>Premier POS Thermal</title>';
  let normalized = String(html || '');
  if (/<head[\s>]/i.test(normalized)) {
    normalized = normalized.replace(/<head([^>]*)>/i, `<head$1>${title}${css}`);
  } else if (/<html[\s>]/i.test(normalized)) {
    normalized = normalized.replace(/<html([^>]*)>/i, `<html$1><head>${title}${css}</head>`);
  } else {
    normalized = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">${title}${css}</head><body>${normalized}</body></html>`;
  }
  return normalized;
}

function textToPrintableHtml(text, widthMm) {
  const safe = escapeHtml(text);
  return applyThermalLayout(`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; }
  pre {
    width: 100%;
    margin: 0;
    padding: 2mm;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    direction: rtl;
    text-align: right;
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.3;
  }
</style>
</head>
<body><pre>${safe}</pre></body>
</html>`, widthMm);
}

function timeoutError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function withTimeout(promise, timeoutMs, code, onTimeout) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { if (onTimeout) onTimeout(); } catch { /* best effort */ }
        reject(timeoutError(code));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function rememberJob(job) {
  recentPrintJobs.set(job.id, job);
  while (recentPrintJobs.size > MAX_RECENT_JOBS) {
    const oldest = recentPrintJobs.keys().next().value;
    recentPrintJobs.delete(oldest);
  }
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  rememberJob(job);
}

function destroyPrinterWorker(printerName) {
  const holder = printerWorkers.get(printerName);
  if (!holder) return;
  if (holder.idleTimer) clearTimeout(holder.idleTimer);
  if (holder.window && !holder.window.isDestroyed()) {
    try { holder.window.destroy(); } catch { /* best effort */ }
  }
  printerWorkers.delete(printerName);
}

function schedulePrinterWorkerCleanup(printerName) {
  const holder = printerWorkers.get(printerName);
  if (!holder) return;
  if (holder.idleTimer) clearTimeout(holder.idleTimer);
  holder.idleTimer = setTimeout(() => {
    const queue = printerQueues.get(printerName);
    if (!queue || (queue.pending === 0 && !queue.activeJobId)) destroyPrinterWorker(printerName);
  }, WORKER_IDLE_TTL_MS);
}

function getPrinterWorker(printerName) {
  const existing = printerWorkers.get(printerName);
  if (existing && existing.window && !existing.window.isDestroyed()) {
    if (existing.idleTimer) {
      clearTimeout(existing.idleTimer);
      existing.idleTimer = null;
    }
    return existing.window;
  }

  const worker = new BrowserWindow({
    show: false,
    title: `Premier POS Print Worker - ${printerName}`,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  worker.webContents.on('render-process-gone', () => {
    const holder = printerWorkers.get(printerName);
    if (holder && holder.window === worker) printerWorkers.delete(printerName);
  });
  worker.on('closed', () => {
    const holder = printerWorkers.get(printerName);
    if (holder && holder.window === worker) printerWorkers.delete(printerName);
  });

  printerWorkers.set(printerName, { window: worker, idleTimer: null });
  return worker;
}

async function measureThermalPageSize(worker, widthMm) {
  const heightPx = await worker.webContents.executeJavaScript(`(() => {
    const body = document.body;
    const root = document.documentElement;
    return Math.ceil(Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0
    ));
  })()`);
  if (!Number.isFinite(heightPx) || heightPx <= 0) throw new Error('THERMAL_PAGE_SIZE_FAILED');
  const contentMicrons = Math.ceil((heightPx * MICRONS_PER_INCH) / PX_PER_INCH);
  const minHeightMicrons = 30000;
  const maxHeightMicrons = 3000000;
  const height = Math.min(maxHeightMicrons, Math.max(minHeightMicrons, contentMicrons + (THERMAL_BOTTOM_FEED_MM * 1000)));
  return { width: widthMm * 1000, height };
}

async function listSystemPrinters() {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  return mainWindow.webContents.getPrintersAsync();
}

async function ensurePrinterExists(printerName) {
  const printers = await listSystemPrinters();
  return printers.some((printer) => printer.name === printerName);
}

async function printOnWorker(printerName, options, job) {
  const { html, text, copies, paperWidthMm } = options;
  const exists = await ensurePrinterExists(printerName);
  if (!exists) return { success: false, error: 'PRINTER_NOT_FOUND', printerName, jobId: job.id };

  let worker = getPrinterWorker(printerName);
  const printableHtml = html
    ? applyThermalLayout(html, paperWidthMm)
    : textToPrintableHtml(text, paperWidthMm);
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(printableHtml)}`;

  try {
    updateJob(job, { state: 'loading' });
    await withTimeout(
      worker.loadURL(dataUrl),
      LOAD_TIMEOUT_MS,
      'PRINT_PAGE_LOAD_TIMEOUT',
      () => destroyPrinterWorker(printerName),
    );

    // The timeout may have recycled the worker. Never continue with a destroyed renderer.
    if (worker.isDestroyed()) throw timeoutError('PRINT_PAGE_LOAD_TIMEOUT');
    const pageSize = await withTimeout(
      measureThermalPageSize(worker, paperWidthMm),
      LOAD_TIMEOUT_MS,
      'PRINT_PAGE_MEASURE_TIMEOUT',
      () => destroyPrinterWorker(printerName),
    );

    updateJob(job, { state: 'spooling' });
    const printResult = await withTimeout(
      new Promise((resolve) => {
        worker.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName: printerName,
            copies,
            pageSize,
            margins: { marginType: 'none' },
          },
          (success, failureReason) => {
            resolve(success
              ? { success: true, printerName, jobId: job.id, acceptedBySpooler: true, physicalPrintConfirmed: false }
              : { success: false, printerName, jobId: job.id, error: failureReason || 'PRINT_FAILED' });
          },
        );
      }),
      PRINT_TIMEOUT_MS,
      'PRINT_TIMEOUT',
      () => destroyPrinterWorker(printerName),
    );

    if (printResult.success) updateJob(job, { state: 'accepted' });
    else updateJob(job, { state: 'failed', error: printResult.error });
    return printResult;
  } catch (error) {
    const code = error && (error.code || error.message) ? String(error.code || error.message) : 'PRINT_ERROR';
    const ambiguous = code === 'PRINT_TIMEOUT';
    updateJob(job, { state: ambiguous ? 'timeout' : 'failed', error: code });
    // A print timeout is delivery-ambiguous: Windows may still emit the receipt later.
    // Do not retry automatically, otherwise cashier receipts can duplicate.
    return {
      success: false,
      printerName,
      jobId: job.id,
      error: code,
      deliveryUnknown: ambiguous,
      retrySafe: !ambiguous,
    };
  } finally {
    schedulePrinterWorkerCleanup(printerName);
  }
}

function enqueuePrinterJob(printerName, options) {
  let queue = printerQueues.get(printerName);
  if (!queue) {
    queue = { tail: Promise.resolve(), pending: 0, activeJobId: null };
    printerQueues.set(printerName, queue);
  }

  if (queue.pending >= MAX_PENDING_PER_PRINTER) {
    return Promise.resolve({ success: false, printerName, error: 'PRINTER_QUEUE_FULL' });
  }

  const job = {
    id: `print-${Date.now()}-${nextPrintJobId++}`,
    printerName,
    state: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  rememberJob(job);
  queue.pending += 1;

  const run = async () => {
    queue.pending = Math.max(0, queue.pending - 1);
    queue.activeJobId = job.id;
    updateJob(job, { state: 'active' });
    try {
      return await printOnWorker(printerName, options, job);
    } finally {
      queue.activeJobId = null;
      if (queue.pending === 0) schedulePrinterWorkerCleanup(printerName);
    }
  };

  // A failure on this printer must not poison its future queue entries.
  const result = queue.tail.then(run, run);
  queue.tail = result.then(() => undefined, () => undefined);
  return result;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Premier POS',
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      const target = new URL(resolveTargetUrl());
      const sameTrustedApp = parsed.origin === target.origin && parsed.pathname.startsWith('/johna-s');
      const sameLocalDev = (target.hostname === 'localhost' || target.hostname === '127.0.0.1') && parsed.origin === target.origin;
      if (!sameTrustedApp && !sameLocalDev) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  const targetUrl = resolveTargetUrl();
  mainWindow.loadURL(targetUrl).catch((error) => {
    console.error('[Premier POS Desktop] Failed to load remote app:', error);
    const localIndex = path.join(__dirname, '..', 'dist', 'index.html');
    if (fs.existsSync(localIndex) && mainWindow) void mainWindow.loadFile(localIndex);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    for (const printerName of [...printerWorkers.keys()]) destroyPrinterWorker(printerName);
  });
}

ipcMain.handle('pos:get-printers', async () => {
  try {
    const printers = await listSystemPrinters();
    return printers.map((printer) => ({
      name: printer.name,
      displayName: printer.displayName || printer.name,
      description: printer.description || '',
      status: printer.status,
      isDefault: printer.isDefault,
    }));
  } catch (error) {
    console.error('[Printer] Failed to enumerate printers:', error);
    return [];
  }
});

ipcMain.handle('pos:print-silent', async (_event, options = {}) => {
  const printerName = typeof options.printerName === 'string' ? options.printerName.trim() : '';
  const html = typeof options.html === 'string' ? options.html : '';
  const text = typeof options.text === 'string' ? options.text : '';
  const copies = Math.max(1, Math.min(5, Number(options.copies || 1)));
  const paperWidthMm = normalizeThermalWidthMm(options.paperWidthMm);

  if (!printerName) return { success: false, error: 'PRINTER_NAME_REQUIRED' };
  if (!html && !text) return { success: false, error: 'NO_CONTENT_TO_PRINT' };

  return enqueuePrinterJob(printerName, { html, text, copies, paperWidthMm });
});

ipcMain.handle('pos:get-print-queue-state', async () => ({
  queues: [...printerQueues.entries()].map(([printerName, queue]) => ({
    printerName,
    pending: queue.pending,
    activeJobId: queue.activeJobId,
    workerAlive: !!printerWorkers.get(printerName)?.window && !printerWorkers.get(printerName).window.isDestroyed(),
  })),
  recentJobs: [...recentPrintJobs.values()].slice(-25),
}));

ipcMain.handle('pos:kick-drawer', async (_event, requestedPrinterName) => {
  const printerName = typeof requestedPrinterName === 'string' ? requestedPrinterName.trim() : '';
  if (!printerName) return { success: false, error: 'PRINTER_NAME_REQUIRED' };

  const tempFile = path.join(os.tmpdir(), `premier-drawer-${Date.now()}.bin`);
  fs.writeFileSync(tempFile, Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { fs.unlinkSync(tempFile); } catch { /* best effort cleanup */ }
      resolve(result);
    };
    const script = '$p=$args[0];$f=$args[1];Get-Content -LiteralPath $f -Encoding Byte -Raw | Out-Printer -Name $p';
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, printerName, tempFile],
      { windowsHide: true, timeout: DRAWER_TIMEOUT_MS, killSignal: 'SIGKILL' },
      (error, _stdout, stderr) => {
        finish(error
          ? { success: false, error: error.killed ? 'DRAWER_TIMEOUT' : String(stderr || error.message || '').trim() }
          : { success: true });
      },
    );
    child.on('error', (error) => finish({ success: false, error: error.message || 'DRAWER_ERROR' }));
  });
});

ipcMain.handle('pos:get-system-info', async () => ({
  isElectron: true,
  platform: process.platform,
  hostname: os.hostname(),
  arch: process.arch,
  version: app.getVersion(),
  printEngine: 'thermal-v2-per-printer-queue',
}));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  for (const printerName of [...printerWorkers.keys()]) destroyPrinterWorker(printerName);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
