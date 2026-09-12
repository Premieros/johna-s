// Premier Print Agent - Windows desktop shell and local thermal print bridge.
// Every physical printer owns an independent FIFO queue and hidden print worker.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { PerPrinterQueue, withTimeout } = require('./printerQueue.cjs');

const DEFAULT_URL = 'https://premieros.github.io/johna-s/';
const TRUSTED_ORIGIN = 'https://premieros.github.io';
const DEFAULT_THERMAL_WIDTH_MM = 80;
const PRINT_LOAD_TIMEOUT_MS = 6000;
const PRINT_CALLBACK_TIMEOUT_MS = 12000;

let mainWindow = null;
let allowQuit = false;
const printerQueue = new PerPrinterQueue();
const printWorkerWindows = new Map();

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

function workerKey(printerName) {
  return String(printerName || '').trim().toLocaleLowerCase();
}

function destroyPrintWorker(printerName) {
  const key = workerKey(printerName);
  const worker = printWorkerWindows.get(key);
  if (worker && !worker.isDestroyed()) worker.destroy();
  printWorkerWindows.delete(key);
}

function destroyAllPrintWorkers() {
  for (const worker of printWorkerWindows.values()) {
    if (worker && !worker.isDestroyed()) worker.destroy();
  }
  printWorkerWindows.clear();
  printerQueue.clear();
}

function createPrintWorker(printerName) {
  const key = workerKey(printerName);
  const existing = printWorkerWindows.get(key);
  if (existing && !existing.isDestroyed()) return existing;

  const worker = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  printWorkerWindows.set(key, worker);
  worker.on('closed', () => {
    if (printWorkerWindows.get(key) === worker) printWorkerWindows.delete(key);
  });
  return worker;
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
  /*
   * Keep 58/80mm as document layout only. Do not advertise a custom CSS page
   * size here: Windows thermal drivers commonly expose a roll/form selected in
   * Printer Preferences and some of them stall when Chromium submits a unique
   * custom page height for every receipt.
   */
  @page { margin: 0; }
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

function driverCompatiblePrintOptions(printerName, options) {
  return {
    silent: true,
    printBackground: true,
    deviceName: printerName,
    copies: options.copies,
    // Intentionally omit Electron pageSize. The selected Windows printer form
    // controls physical roll geometry; CSS still lays out content at 58/80mm.
    // This avoids per-receipt custom heights that can remain stuck in Spooler.
    margins: { marginType: 'none' },
  };
}

async function printOnPhysicalPrinter(printerName, options) {
  const worker = createPrintWorker(printerName);
  const printableHtml = options.html
    ? applyThermalLayout(options.html, options.paperWidthMm)
    : textToPrintableHtml(options.text, options.paperWidthMm);

  try {
    await withTimeout(
      worker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printableHtml)}`),
      PRINT_LOAD_TIMEOUT_MS,
      'PRINT_LOAD_TIMEOUT',
    );
    const result = await withTimeout(new Promise((resolve) => {
      worker.webContents.print(
        driverCompatiblePrintOptions(printerName, options),
        (success, failureReason) => {
          resolve(success
            ? { success: true, printerName }
            : { success: false, error: failureReason || 'PRINT_FAILED' });
        },
      );
    }), PRINT_CALLBACK_TIMEOUT_MS, 'PRINT_CALLBACK_TIMEOUT');

    if (!result.success) destroyPrintWorker(printerName);
    return result;
  } catch (error) {
    // A worker that timed out or threw is discarded. Only this printer queue is
    // affected; all other physical printers continue independently.
    destroyPrintWorker(printerName);
    throw error;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: 'Premier Print Agent',
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
    console.error('[Premier Print Agent] Failed to load remote app:', error);
    const localIndex = path.join(__dirname, '..', 'dist', 'index.html');
    if (fs.existsSync(localIndex) && mainWindow) void mainWindow.loadFile(localIndex);
  });

  mainWindow.on('close', (event) => {
    if (!allowQuit) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('pos:get-printers', async () => {
  try {
    if (!mainWindow) return [];
    const printers = await mainWindow.webContents.getPrintersAsync();
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

  try {
    return await printerQueue.enqueue(printerName, () => printOnPhysicalPrinter(printerName, {
      html,
      text,
      copies,
      paperWidthMm,
    }));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'PRINT_ERROR' };
  }
});

ipcMain.handle('pos:kick-drawer', async (_event, requestedPrinterName) => {
  const printerName = typeof requestedPrinterName === 'string' ? requestedPrinterName.trim() : '';
  if (!printerName) return { success: false, error: 'PRINTER_NAME_REQUIRED' };

  const tempFile = path.join(os.tmpdir(), `premier-drawer-${Date.now()}.bin`);
  fs.writeFileSync(tempFile, Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]));

  return await new Promise((resolve) => {
    const script = '$p=$args[0];$f=$args[1];Get-Content -LiteralPath $f -Encoding Byte -Raw | Out-Printer -Name $p';
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, printerName, tempFile],
      { windowsHide: true, timeout: PRINT_CALLBACK_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        try { fs.unlinkSync(tempFile); } catch { /* best effort cleanup */ }
        resolve(error ? { success: false, error: String(stderr || error.message || '').trim() } : { success: true });
      },
    );
  });
});

ipcMain.handle('pos:get-system-info', async () => ({
  isElectron: true,
  platform: process.platform,
  hostname: os.hostname(),
  arch: process.arch,
  version: app.getVersion(),
}));

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) createWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === 'win32' && app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
    }
    createWindow();
    app.on('activate', () => {
      if (!mainWindow) createWindow();
      else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  });
}

app.on('before-quit', () => {
  allowQuit = true;
  destroyAllPrintWorkers();
});

// Keep the agent alive after the window is hidden. Launching it again restores
// the existing single instance, while cloud jobs continue printing in background.
app.on('window-all-closed', () => {});
