// Premier POS - Windows Desktop shell.
// Exposes only the minimal local hardware bridge required for printing.

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
let mainWindow = null;
let printWorkerWindow = null;

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

function createPrintWorker() {
  if (printWorkerWindow && !printWorkerWindow.isDestroyed()) return printWorkerWindow;
  printWorkerWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  return printWorkerWindow;
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
    if (printWorkerWindow && !printWorkerWindow.isDestroyed()) printWorkerWindow.destroy();
    printWorkerWindow = null;
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
    const worker = createPrintWorker();
    const printableHtml = html
      ? applyThermalLayout(html, paperWidthMm)
      : textToPrintableHtml(text, paperWidthMm);
    await worker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printableHtml)}`);
    const pageSize = await measureThermalPageSize(worker, paperWidthMm);

    return await new Promise((resolve) => {
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
            ? { success: true, printerName }
            : { success: false, error: failureReason || 'PRINT_FAILED' });
        },
      );
    });
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
      { windowsHide: true },
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
