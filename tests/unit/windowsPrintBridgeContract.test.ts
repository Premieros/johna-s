import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  expect(startAt).toBeGreaterThanOrEqual(0);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(endAt).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe('Windows Electron print bridge contract', () => {
  it('routes receipt and kitchen work through a per-printer queue into Chromium printing, not PowerShell Out-Printer', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
    const silentPrintHandler = between(source, "ipcMain.handle('pos:print-silent'", "ipcMain.handle('pos:kick-drawer'");
    const printOptions = between(source, 'function driverCompatiblePrintOptions', 'async function printOnPhysicalPrinter');
    const physicalPrint = between(source, 'async function printOnPhysicalPrinter', 'function createWindow');

    expect(silentPrintHandler).toContain('printerQueue.enqueue(printerName');
    expect(silentPrintHandler).toContain('printOnPhysicalPrinter(printerName');
    expect(physicalPrint).toContain('textToPrintableHtml(options.text, options.paperWidthMm)');
    expect(physicalPrint).toContain('applyThermalLayout(options.html, options.paperWidthMm)');
    expect(physicalPrint).toContain('worker.webContents.print');
    expect(physicalPrint).toContain('driverCompatiblePrintOptions(printerName, options)');
    expect(printOptions).toContain('deviceName: printerName');
    expect(silentPrintHandler).not.toContain('Out-Printer');
    expect(physicalPrint).not.toContain('Out-Printer');
    expect(physicalPrint).not.toContain('powershell.exe');
  });

  it('keeps 58/80mm document layout but lets the Windows driver own physical paper geometry', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
    const printOptions = between(source, 'function driverCompatiblePrintOptions', 'async function printOnPhysicalPrinter');
    const physicalPrint = between(source, 'async function printOnPhysicalPrinter', 'function createWindow');

    expect(source).toContain('DEFAULT_THERMAL_WIDTH_MM = 80');
    expect(source).toContain('width === 58 ? 58 : DEFAULT_THERMAL_WIDTH_MM');
    expect(source).toContain('width: ${widthMm}mm !important');
    expect(source).toContain('@page { margin: 0; }');
    expect(source).not.toContain('@page { size: ${widthMm}mm auto; margin: 0; }');
    expect(source).not.toContain('measureThermalPageSize');
    expect(source).not.toContain('PRINT_MEASURE_TIMEOUT_MS');
    expect(printOptions).not.toContain('pageSize');
    expect(physicalPrint).not.toContain('pageSize');
    expect(physicalPrint).toContain('PRINT_LOAD_TIMEOUT_MS');
    expect(physicalPrint).toContain('PRINT_CALLBACK_TIMEOUT_MS');
    expect(printOptions).toContain("margins: { marginType: 'none' }");
    expect(source).not.toContain("pageSize: 'A4'");
    expect(source).not.toContain("pageSize: 'Letter'");
  });

  it('keeps cash-drawer handling separate from receipt/kitchen printing', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
    const drawerStart = source.indexOf("ipcMain.handle('pos:kick-drawer'");
    expect(drawerStart).toBeGreaterThanOrEqual(0);
    expect(source.slice(drawerStart)).toContain('Out-Printer');
  });
});
