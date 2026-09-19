import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => fs.readFileSync(path.resolve(process.cwd(), relative), 'utf8');

describe('Premier Print Agent Lite Arabic raster + auto-cut contract', () => {
  it('rasterizes ticket text before sending it to the Windows printer graphics surface', () => {
    const source = read('print-agent-lite/PrintBridge.cs');
    const rasterStart = source.indexOf('private static void DrawRasterPage');
    const cutStart = source.indexOf('internal static bool Cut');
    expect(rasterStart).toBeGreaterThan(0);
    expect(cutStart).toBeGreaterThan(rasterStart);

    const raster = source.slice(rasterStart, cutStart);
    expect(raster).toContain('new Bitmap(');
    expect(raster).toContain('Graphics.FromImage(bitmap)');
    expect(raster).toContain('graphics.DrawString(');
    expect(raster).toContain('StringFormatFlags.DirectionRightToLeft');
    expect(raster).toContain('e.Graphics.DrawImage(');
  });

  it('attempts ESC/POS cut only after print submission and never converts cut failure into a receipt retry', () => {
    const source = read('print-agent-lite/PrintBridge.cs');
    const printAt = source.indexOf('document.Print();');
    const cutAt = source.indexOf('RawPrinter.Cut(printerName);');
    expect(printAt).toBeGreaterThan(0);
    expect(cutAt).toBeGreaterThan(printAt);
    expect(source).toContain('0x1B, 0x64, 0x03, 0x1D, 0x56, 0x00');
    expect(source).not.toContain('if (!RawPrinter.Cut(printerName))');
  });

  it('passes paper width to the bridge and exposes version 1.0.2', () => {
    const source = read('print-agent-lite/MainForm.cs');
    expect(source).toContain("version:'1.0.2'");
    expect(source).toContain('TryGetProperty("paperWidthMm"');
    expect(source).toContain('PrintAsync(printer, text, html, copies, paperWidthMm)');
  });
});
