import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readDesktopSource = () => fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');

describe('Windows Electron print bridge contract', () => {
  it('routes receipt and kitchen content through Chromium printing, not PowerShell Out-Printer', () => {
    const source = readDesktopSource();
    const printStart = source.indexOf('async function printOnWorker');
    const queueStart = source.indexOf('function enqueuePrinterJob', printStart);
    const handlerStart = source.indexOf("ipcMain.handle('pos:print-silent'");
    const drawerStart = source.indexOf("ipcMain.handle('pos:kick-drawer'", handlerStart);

    expect(printStart).toBeGreaterThanOrEqual(0);
    expect(queueStart).toBeGreaterThan(printStart);
    expect(handlerStart).toBeGreaterThan(queueStart);
    expect(drawerStart).toBeGreaterThan(handlerStart);

    const chromiumPrintPath = source.slice(printStart, queueStart);
    const silentPrintHandler = source.slice(handlerStart, drawerStart);

    expect(chromiumPrintPath).toContain('textToPrintableHtml(text, paperWidthMm)');
    expect(chromiumPrintPath).toContain('applyThermalLayout(html, paperWidthMm)');
    expect(chromiumPrintPath).toContain('worker.webContents.print');
    expect(chromiumPrintPath).toContain('deviceName: printerName');
    expect(chromiumPrintPath).not.toContain('Out-Printer');
    expect(chromiumPrintPath).not.toContain('powershell.exe');

    expect(silentPrintHandler).toContain('enqueuePrinterJob(printerName');
    expect(silentPrintHandler).not.toContain('Out-Printer');
    expect(silentPrintHandler).not.toContain('powershell.exe');
  });

  it('isolates printer queues and bounds a hung native Windows print', () => {
    const source = readDesktopSource();

    expect(source).toContain('const printerQueues = new Map()');
    expect(source).toContain('const printerWorkers = new Map()');
    expect(source).toContain('let queue = printerQueues.get(printerName)');
    expect(source).toContain('getPrinterWorker(printerName)');
    expect(source).toContain('PRINT_TIMEOUT_MS = 15000');
    expect(source).toContain("'PRINT_TIMEOUT'");
    expect(source).toContain('deliveryUnknown: ambiguous');
    expect(source).toContain('retrySafe: !ambiguous');
    expect(source).toContain('queue.tail.then(run, run)');
  });

  it('prints on explicit 58/80mm thermal geometry sized to rendered content', () => {
    const source = readDesktopSource();

    expect(source).toContain('DEFAULT_THERMAL_WIDTH_MM = 80');
    expect(source).toContain('width === 58 ? 58 : DEFAULT_THERMAL_WIDTH_MM');
    expect(source).toContain('@page { size: ${widthMm}mm auto; margin: 0; }');
    expect(source).toContain('measureThermalPageSize(worker, paperWidthMm)');
    expect(source).toContain('document.body');
    expect(source).toContain('scrollHeight');
    expect(source).toContain('pageSize,');
    expect(source).toContain("margins: { marginType: 'none' }");
    expect(source).not.toContain("pageSize: 'A4'");
    expect(source).not.toContain("pageSize: 'Letter'");
  });

  it('keeps cash-drawer handling separate from receipt/kitchen printing', () => {
    const source = readDesktopSource();
    const drawerStart = source.indexOf("ipcMain.handle('pos:kick-drawer'");
    expect(drawerStart).toBeGreaterThanOrEqual(0);
    expect(source.slice(drawerStart)).toContain('Out-Printer');
    expect(source.slice(drawerStart)).toContain('DRAWER_TIMEOUT_MS');
  });
});
