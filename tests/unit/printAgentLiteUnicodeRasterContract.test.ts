import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(process.cwd(), 'print-agent-lite/PrintBridge.cs'),
  'utf8',
);

describe('Premier Print Agent Lite Unicode raster contract', () => {
  it('rasterizes receipt text before handing it to the thermal printer driver', () => {
    expect(source).toContain('private static void DrawRasterizedLine');
    expect(source).toContain('Graphics.FromImage(bitmap)');
    expect(source).toContain('TextRenderingHint.AntiAliasGridFit');
    expect(source).toContain('printerGraphics.DrawImage(bitmap, destination)');
    expect(source).not.toContain('e.Graphics.DrawString(line, font');
  });

  it('keeps Arabic shaping and RTL alignment inside the Windows rendering path', () => {
    expect(source).toContain('StringFormatFlags.DirectionRightToLeft');
    expect(source).toContain('StringAlignment.Far');
    expect(source).toContain('[\\u0600-\\u06FF]');
    expect(source).toContain('new Font("Tahoma", 9f');
  });

  it('keeps cash drawer raw bytes separate from receipt text rendering', () => {
    const printStart = source.indexOf('private static Dictionary<string, object> PrintText');
    const normalizeStart = source.indexOf('private static string[] NormalizeLines', printStart);
    const printText = source.slice(printStart, normalizeStart);

    expect(printText).not.toContain('RawPrinter.Send');
    expect(source).toContain('RawPrinter.Send(printerName, new byte[] { 0x1B, 0x70');
  });
});
