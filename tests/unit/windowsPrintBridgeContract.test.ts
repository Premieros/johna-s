import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Windows Electron print bridge contract', () => {
  it('routes receipt and kitchen text through Chromium printing, not PowerShell Out-Printer', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
    const start = source.indexOf("ipcMain.handle('pos:print-silent'");
    const end = source.indexOf("ipcMain.handle('pos:kick-drawer'", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const silentPrintHandler = source.slice(start, end);
    expect(silentPrintHandler).toContain('textToPrintableHtml(text, paperWidthMm)');
    expect(silentPrintHandler).toContain('applyThermalLayout(html, paperWidthMm)');
    expect(silentPrintHandler).toContain('worker.webContents.print');
    expect(silentPrintHandler).toContain('deviceName: printerName');
    expect(silentPrintHandler).not.toContain('Out-Printer');
    expect(silentPrintHandler).not.toContain('powershell.exe');
  });

  it('prints on explicit 58/80mm thermal geometry sized to rendered content', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');

    expect(source).toContain('DEFAULT_THERMAL_WIDTH_MM = 80');
    expect(source).toContain('width === 58 ? 58 : DEFAULT_THERMAL_WIDTH_MM');
    expect(source).toContain('@page { size: ${widthMm}mm auto; margin: 0; }');
    expect(source).toContain('measureThermalPageSize(worker, paperWidthMm)');
    expect(source).toContain('document.body');
    expect(source).toContain('scrollHeight');
    expect(source).toContain('pageSize,');
    expect(source).toContain('margins: { marginType: \'none\' }');
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
