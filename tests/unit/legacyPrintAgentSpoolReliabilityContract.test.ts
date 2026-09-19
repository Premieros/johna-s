import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('legacy print agent spool reliability contract', () => {
  it('serializes every job per physical printer inside the localhost agent', () => {
    const agent = read('local-print-agent/agent.cjs');

    expect(agent).toContain('const printerLanes = new Map()');
    expect(agent).toContain('const printerQueueDepth = new Map()');
    expect(agent).toContain('function enqueuePrinterTask(printerName, task)');
    expect(agent).toContain('const previous = printerLanes.get(key) || Promise.resolve()');
    expect(agent).toContain('return enqueuePrinterTask(printerName, async () => {');
    expect(agent).toContain("if (req.method === 'GET' && url.pathname === '/queue')");
  });

  it('preflights the Windows spooler and retries only before submission', () => {
    const agent = read('local-print-agent/agent.cjs');
    const printStart = agent.indexOf('async function printText(printerName, text, paperWidthMm = 80)');
    const drawerStart = agent.indexOf('async function kickDrawer', printStart);
    const printText = agent.slice(printStart, drawerStart);

    expect(agent).toContain("Get-Service -Name Spooler -ErrorAction Stop");
    expect(agent).toContain("throw 'PRINT_SPOOLER_NOT_RUNNING'");
    expect(agent).toContain("throw 'PRINTER_OFFLINE'");
    expect(agent).toContain('ensureSpoolerReadyWithRetry');
    expect(agent).toContain('PREFLIGHT_RETRY_DELAYS_MS');
    expect(printText).toContain('await ensureSpoolerReadyWithRetry(printerName)');
    expect(printText).toContain('await submitTextToSpooler(printerName, text, paperWidthMm)');
    expect(printText.indexOf('await ensureSpoolerReadyWithRetry(printerName)')).toBeLessThan(
      printText.indexOf('await submitTextToSpooler(printerName, text, paperWidthMm)'),
    );
    expect(agent).toContain('Once the raw ESC/POS raster write is invoked we never retry here');
  });

  it('returns success only after the raw ESC/POS raster call resolves and supports Arabic station codes', () => {
    const agent = read('local-print-agent/agent.cjs');
    const printHandlerStart = agent.indexOf("if (req.method === 'POST' && url.pathname === '/print')");
    const drawerHandlerStart = agent.indexOf("if (req.method === 'POST' && url.pathname === '/drawer')", printHandlerStart);
    const printHandler = agent.slice(printHandlerStart, drawerHandlerStart);

    expect(agent).toContain('await psFile(ESC_POS_RASTER_SCRIPT_PATH, [printerName, tmp, String(Number(paperWidthMm) <= 58 ? 58 : 80)]);');
    expect(printHandler).toContain('const result = await printText(printer, text, paperWidthMm)');
    expect(printHandler).toContain('acceptedBySpooler: Boolean(result?.acceptedBySpooler)');
    expect(printHandler.indexOf('const result = await printText(printer, text, paperWidthMm)')).toBeLessThan(
      printHandler.indexOf('success: true'),
    );
    expect(agent).toContain('\\u0600-\\u06FF');
    expect(agent).toContain("path.join(__dirname, 'print-escpos-raster.ps1')");
    expect(agent).toContain('await psFile(ESC_POS_RASTER_SCRIPT_PATH, [printerName, tmp, String(Number(paperWidthMm) <= 58 ? 58 : 80)])');
    expect(agent).not.toContain('Get-Content -LiteralPath $f -Raw -Encoding UTF8 | Out-Printer -Name $p');

    const helper = read('local-print-agent/print-escpos-raster.ps1');
    expect(helper).toContain('public static class JohnsEscPosRasterPrinter');
    expect(helper).toContain('TextRenderingHint.AntiAliasGridFit');
    expect(helper).toContain('// GS v 0 : raster bit image, normal density.');
    expect(helper).toContain('ValidateRasterPayload');
    expect(helper).toContain('new byte[10 + (widthBytes * height) + 8]');
    expect(helper).toContain('new UTF8Encoding(false, true)');
    expect(helper).toContain('StringFormatFlags.DirectionRightToLeft');
  });


  it('forces the installed localhost service onto the Cleopatra v4 ESC/POS raster transport', () => {
    const agent = read('local-print-agent/agent.cjs');
    const restart = read('local-print-agent/restart-agent.ps1');
    const install = read('local-print-agent/install-startup.cmd');

    expect(agent).toContain("version: 4, transport: 'escpos-raw-raster'");
    expect(restart).toContain('Get-NetTCPConnection -LocalPort $port -State Listen');
    expect(restart).toContain("$process.Name -ieq 'node.exe'");
    expect(restart).toContain("$commandLine -match 'agent\\.cjs'");
    expect(restart).toContain("throw \"WRONG_PRINT_AGENT_VERSION:$($health.version)\"");
    expect(restart).toContain("throw \"WRONG_PRINT_TRANSPORT:$($health.transport)\"");
    expect(install).toContain('restart-agent.ps1');
    expect(install).toContain('Johns Print Service v4 is installed and verified.');
  });
});
