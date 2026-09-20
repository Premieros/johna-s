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

function normalizeFixedThermalTemplate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Number(value.version) !== 1) return null;
  if (value.kind !== 'customer' && value.kind !== 'kitchen') return null;
  if (!Array.isArray(value.meta) || !Array.isArray(value.items)) return null;
  const paperWidthMm = normalizeThermalWidthMm(value.paperWidthMm);
  return { ...value, paperWidthMm };
}

function fixedTemplateToHtml(template) {
  const t = normalizeFixedThermalTemplate(template);
  if (!t) return '';
  const ar = Boolean(t.isAr);
  const kitchen = t.kind === 'kitchen';
  const dir = ar ? 'rtl' : 'ltr';
  const e = escapeHtml;
  const meta = Array.isArray(t.meta) ? t.meta : [];
  const items = Array.isArray(t.items) ? t.items : [];
  const totals = Array.isArray(t.totals) ? t.totals : [];
  const footerLines = Array.isArray(t.footerLines) ? t.footerLines : [];

  const metaRows = [
    ...(kitchen && t.station ? [{ label: ar ? 'المحطة' : 'Station', value: t.station, emphasis: true }] : []),
    ...meta,
  ].map((row) => `
    <div class="meta-row ${row?.emphasis ? 'emphasis' : ''}">
      <div class="meta-label">${e(row?.label || '')}:</div>
      <div class="meta-value">${e(row?.value || '')}</div>
    </div>`).join('');

  const customerItems = items.map((item) => `
    <div class="item-row customer-item">
      <div class="qty">${e(item?.qty || '')}</div>
      <div class="item-name">${e(item?.name || '')}</div>
      <div class="price">${e(item?.total || item?.price || '')}</div>
    </div>`).join('');

  const kitchenItems = items.map((item) => {
    const modifiers = Array.isArray(item?.modifiers)
      ? item.modifiers.map((modifier) => `<div class="modifier">+ ${e(modifier || '')}</div>`).join('')
      : '';
    const note = item?.notes
      ? `<div class="note">${ar ? 'ملاحظة' : 'Note'}: ${e(item.notes)}</div>`
      : '';
    return `
      <div class="kitchen-item">
        <div class="kitchen-main"><span class="qty">${e(item?.qty || '')}</span><span class="item-name">${e(item?.name || '')}</span></div>
        ${modifiers}
        ${note}
      </div>`;
  }).join('');

  const totalRows = totals.map((row) => `
    <div class="total-row ${row?.emphasis ? 'grand-total' : ''}">
      <span>${e(row?.label || '')}:</span>
      <span>${e(row?.value || '')}</span>
    </div>`).join('');

  const footer = footerLines.map((line, index) => `
    <div class="footer-line ${kitchen && index === 0 ? 'kitchen-end' : ''}">${e(line || '')}</div>`
  ).join('');

  return applyThermalLayout(`<!doctype html>
<html lang="${ar ? 'ar' : 'en'}" dir="${dir}">
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body {
    font-family: "Arial Narrow", "Segoe UI", Tahoma, Arial, sans-serif !important;
    direction: ${dir};
    background: #fff;
    color: #000;
  }
  body { margin: 0; padding: 0; }
  .receipt {
    width: 100%;
    padding: ${kitchen ? '3.2mm 4mm 3mm' : '4.5mm 5mm 4mm'};
    font-size: ${kitchen ? '9.5pt' : '10pt'};
    line-height: 1.22;
  }
  .brand {
    text-align: center;
    font-family: Arial, "Segoe UI", sans-serif;
    font-size: ${kitchen ? '22pt' : '26pt'};
    line-height: 1;
    font-weight: 900;
    letter-spacing: -0.5px;
    margin: 0 0 1.2mm;
  }
  .brand-sub {
    text-align: center;
    font-family: Arial, "Segoe UI", sans-serif;
    font-size: ${kitchen ? '7.3pt' : '8pt'};
    font-weight: 600;
    letter-spacing: 3.2px;
    margin-bottom: ${kitchen ? '3mm' : '4mm'};
  }
  .title-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 2.2mm;
    align-items: center;
    margin-bottom: ${kitchen ? '1.2mm' : '1.6mm'};
  }
  .title-rule { height: .25mm; background: #111; }
  .title {
    font-size: ${kitchen ? '14pt' : '15pt'};
    font-weight: 900;
    white-space: nowrap;
    text-align: center;
  }
  .subtitle, .slogan, .branch {
    text-align: center;
    font-size: ${kitchen ? '8pt' : '8.5pt'};
    margin-top: .8mm;
  }
  .subtitle { font-weight: 700; letter-spacing: 2px; }
  .slogan { font-weight: 500; }
  .branch { font-weight: 600; }
  .meta {
    margin-top: ${kitchen ? '3mm' : '5mm'};
    margin-bottom: ${kitchen ? '3mm' : '4mm'};
  }
  .meta-row {
    display: grid;
    grid-template-columns: ${ar ? '1fr 23mm' : '23mm 1fr'};
    gap: 2mm;
    align-items: baseline;
    margin: .75mm 0;
    min-height: 4.3mm;
  }
  .meta-label {
    font-weight: 700;
    ${ar ? 'grid-column:2;text-align:right' : 'text-align:left'};
  }
  .meta-value {
    font-weight: 500;
    overflow-wrap: anywhere;
    ${ar ? 'grid-column:1;grid-row:1;text-align:right' : 'text-align:left'};
  }
  .meta-row.emphasis .meta-label,
  .meta-row.emphasis .meta-value { font-weight: 800; }
  .section {
    border-top: .25mm solid #111;
    padding-top: ${kitchen ? '2.5mm' : '3.2mm'};
    margin-top: ${kitchen ? '2mm' : '2.5mm'};
  }
  .items-title {
    font-size: ${kitchen ? '14pt' : '15pt'};
    font-weight: 900;
    margin-bottom: ${kitchen ? '2mm' : '2.5mm'};
  }
  .items-head, .customer-item {
    display: grid;
    grid-template-columns: 11mm 1fr 21mm;
    gap: 1.5mm;
    align-items: baseline;
  }
  .items-head {
    font-size: 8.5pt;
    font-weight: 800;
    margin-bottom: 1.5mm;
  }
  .items-head .price, .customer-item .price { text-align: ${ar ? 'left' : 'right'}; }
  .items-head .qty, .customer-item .qty { text-align: center; }
  .customer-item {
    min-height: 8mm;
    padding: 1.2mm 0;
    font-size: 10.5pt;
  }
  .customer-item .item-name { font-weight: 600; overflow-wrap: anywhere; }
  .customer-item .price { font-weight: 700; white-space: nowrap; }
  .kitchen-item {
    padding: 1.4mm 0;
    border-bottom: .15mm solid #b8b8b8;
  }
  .kitchen-item:last-child { border-bottom: 0; }
  .kitchen-main {
    display: grid;
    grid-template-columns: 10mm 1fr;
    gap: 2mm;
    font-size: 11.5pt;
    font-weight: 900;
    align-items: baseline;
  }
  .kitchen-main .qty { text-align: center; }
  .modifier, .note {
    margin-top: .8mm;
    ${ar ? 'padding-right:12mm' : 'padding-left:12mm'};
    font-size: 8.7pt;
    line-height: 1.18;
  }
  .modifier { font-weight: 700; }
  .note { font-weight: 800; }
  .totals {
    border-top: .25mm solid #111;
    border-bottom: .25mm solid #111;
    margin-top: 3mm;
    padding: 2.4mm 0 2mm;
  }
  .total-row {
    display: flex;
    justify-content: space-between;
    gap: 2mm;
    margin: 1mm 0;
    font-size: 10.5pt;
  }
  .grand-total {
    font-size: 15pt;
    font-weight: 900;
    margin-top: 1.5mm;
  }
  .footer {
    text-align: center;
    margin-top: ${kitchen ? '3mm' : '5mm'};
  }
  .footer-line {
    font-size: ${kitchen ? '10pt' : '10.5pt'};
    margin: .8mm 0;
  }
  .kitchen-end {
    font-size: 11.5pt;
    font-weight: 900;
    margin-top: 1mm;
  }
  .heart { font-size: 14pt; line-height: 1; margin-top: 1.8mm; }
</style>
</head>
<body>
  <main class="receipt">
    <div class="brand">${e(t.storeName || "JOHNA'S")}</div>
    <div class="brand-sub">${e(t.storeSubtitle || 'RESTAURANT')}</div>
    <div class="title-row"><div class="title-rule"></div><div class="title">${e(t.title || '')}</div><div class="title-rule"></div></div>
    ${t.subtitle ? `<div class="subtitle">${e(t.subtitle)}</div>` : ''}
    ${t.slogan ? `<div class="slogan">${e(t.slogan)}</div>` : ''}
    ${t.branchName ? `<div class="branch">${e(t.branchName)}</div>` : ''}
    <section class="meta">${metaRows}</section>
    <section class="section">
      <div class="items-title">${e(t.itemsHeading || (ar ? 'الأصناف' : 'ITEMS'))}</div>
      ${kitchen
        ? kitchenItems
        : `<div class="items-head"><div class="qty">${ar ? 'الكمية' : 'QTY'}</div><div>${ar ? 'الصنف' : 'ITEM'}</div><div class="price">${ar ? 'السعر' : 'PRICE'}</div></div>${customerItems}`}
    </section>
    ${!kitchen && totals.length ? `<section class="totals">${totalRows}</section>` : ''}
    <footer class="footer">${footer}${!kitchen ? '<div class="heart">♥</div>' : ''}</footer>
  </main>
</body>
</html>`, t.paperWidthMm);
}

function driverCompatiblePrintOptions(printerName, options) {
  return {
    silent: true,
    printBackground: true,
    deviceName: printerName,
    copies: options.copies,
    margins: { marginType: 'none' },
  };
}

function minimalDriverPrintOptions(printerName) {
  return {
    silent: true,
    printBackground: true,
    deviceName: printerName,
  };
}

async function printOnPhysicalPrinter(printerName, options) {
  const worker = createPrintWorker(printerName);
  const templateHtml = fixedTemplateToHtml(options.template);
  const printableHtml = templateHtml
    || (options.html
      ? applyThermalLayout(options.html, options.paperWidthMm)
      : textToPrintableHtml(options.text, options.paperWidthMm));

  const attemptPrint = (printOptions) => withTimeout(new Promise((resolve) => {
    worker.webContents.print(
      printOptions,
      (success, failureReason) => {
        resolve(success
          ? { success: true, printerName }
          : { success: false, error: failureReason || 'PRINT_FAILED' });
      },
    );
  }), PRINT_CALLBACK_TIMEOUT_MS, 'PRINT_CALLBACK_TIMEOUT');

  try {
    await withTimeout(
      worker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printableHtml)}`),
      PRINT_LOAD_TIMEOUT_MS,
      'PRINT_LOAD_TIMEOUT',
    );

    let result = await attemptPrint(driverCompatiblePrintOptions(printerName, options));
    if (!result.success && /invalid printer settings/i.test(String(result.error || ''))) {
      result = await attemptPrint(minimalDriverPrintOptions(printerName));
      if (!result.success) {
        result.error = `INVALID_PRINTER_SETTINGS: ${result.error || 'PRINT_FAILED'}`;
      }
    }

    if (!result.success) destroyPrintWorker(printerName);
    return result;
  } catch (error) {
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
  const template = normalizeFixedThermalTemplate(options.template);
  const copies = Math.max(1, Math.min(5, Number(options.copies || 1)));
  const paperWidthMm = normalizeThermalWidthMm(options.paperWidthMm);

  if (!printerName) return { success: false, error: 'PRINTER_NAME_REQUIRED' };
  if (!template && !html && !text) return { success: false, error: 'NO_CONTENT_TO_PRINT' };

  try {
    if (!mainWindow) return { success: false, error: 'AGENT_WINDOW_UNAVAILABLE' };
    const availablePrinters = await mainWindow.webContents.getPrintersAsync();
    if (!availablePrinters.some((printer) => printer.name === printerName)) {
      return { success: false, error: `PRINTER_NOT_FOUND: ${printerName}` };
    }

    return await printerQueue.enqueue(printerName, () => printOnPhysicalPrinter(printerName, {
      html,
      text,
      template,
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

app.on('window-all-closed', () => {});
