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
    expect(silentPrintHandler).toContain('textToPrintableHtml(text)');
    expect(silentPrintHandler).toContain('worker.webContents.print');
    expect(silentPrintHandler).toContain('deviceName: printerName');
    expect(silentPrintHandler).not.toContain('Out-Printer');
    expect(silentPrintHandler).not.toContain('powershell.exe');
  });

  it('keeps cash-drawer handling separate from receipt/kitchen printing', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'electron/main.cjs'), 'utf8');
    const drawerStart = source.indexOf("ipcMain.handle('pos:kick-drawer'");
    expect(drawerStart).toBeGreaterThanOrEqual(0);
    expect(source.slice(drawerStart)).toContain('Out-Printer');
  });
});
