// Premier POS - Windows Desktop shell.
// Exposes only the minimal local hardware bridge required for printing.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const DEFAULT_URL = 'https://premieros.github.io/johna-s/';
const TRUSTED_ORIGIN = 'https://premieros.github.io';
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

  if (!printerName) return { success: false, error: 'PRINTER_NAME_REQUIRED' };
  if (!html && !text) return { success: false, error: 'NO_CONTENT_TO_PRINT' };

  try {
    if (html) {
      const worker = createPrintWorker();
      await worker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      return await new Promise((resolve) => {
        worker.webContents.print(
          {
            silent: true,
            printBackground: true,
            deviceName: printerName,
            copies,
            margins: { marginType: 'none' },
          },
          (success, failureReason) => {
            resolve(success ? { success: true, printerName } : { success: false, error: failureReason || 'PRINT_FAILED' });
          },
        );
      });
    }

    const tempFile = path.join(os.tmpdir(), `premier-ticket-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
    fs.writeFileSync(tempFile, text, 'utf8');
    return await new Promise((resolve) => {
      const script = '$p=$args[0];$f=$args[1];Get-Content -LiteralPath $f -Raw -Encoding UTF8 | Out-Printer -Name $p';
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, printerName, tempFile],
        { windowsHide: true },
        (error, _stdout, stderr) => {
          try { fs.unlinkSync(tempFile); } catch { /* best effort cleanup */ }
          resolve(error ? { success: false, error: String(stderr || error.message || '').trim() } : { success: true, printerName });
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
