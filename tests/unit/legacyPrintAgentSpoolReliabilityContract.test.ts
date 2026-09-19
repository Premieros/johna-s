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
    const printStart = agent.indexOf('async function printText(printerName, text)');
    const drawerStart = agent.indexOf('async function kickDrawer', printStart);
    const printText = agent.slice(printStart, drawerStart);

    expect(agent).toContain("Get-Service -Name Spooler -ErrorAction Stop");
    expect(agent).toContain("throw 'PRINT_SPOOLER_NOT_RUNNING'");
    expect(agent).toContain("throw 'PRINTER_OFFLINE'");
    expect(agent).toContain('ensureSpoolerReadyWithRetry');
    expect(agent).toContain('PREFLIGHT_RETRY_DELAYS_MS');
    expect(printText).toContain('await ensureSpoolerReadyWithRetry(printerName)');
    expect(printText).toContain('await submitTextToSpooler(printerName, text)');
    expect(printText.indexOf('await ensureSpoolerReadyWithRetry(printerName)')).toBeLessThan(
      printText.indexOf('await submitTextToSpooler(printerName, text)'),
    );
    expect(agent).toContain('Once the Windows GDI print call is invoked we never retry here');
  });

  it('returns success only after the Unicode GDI print call resolves and supports Arabic station codes', () => {
    const agent = read('local-print-agent/agent.cjs');
    const printHandlerStart = agent.indexOf("if (req.method === 'POST' && url.pathname === '/print')");
    const drawerHandlerStart = agent.indexOf("if (req.method === 'POST' && url.pathname === '/drawer')", printHandlerStart);
    const printHandler = agent.slice(printHandlerStart, drawerHandlerStart);

    expect(agent).toContain('await psFile(UNICODE_PRINT_SCRIPT_PATH, [printerName, tmp]);');
    expect(printHandler).toContain('const result = await printText(printer, text)');
    expect(printHandler).toContain('acceptedBySpooler: Boolean(result?.acceptedBySpooler)');
    expect(printHandler.indexOf('const result = await printText(printer, text)')).toBeLessThan(
      printHandler.indexOf('success: true'),
    );
    expect(agent).toContain('\\u0600-\\u06FF');
    expect(agent).toContain("path.join(__dirname, 'print-unicode.ps1')");
    expect(agent).toContain('await psFile(UNICODE_PRINT_SCRIPT_PATH, [printerName, tmp])');
    expect(agent).not.toContain('Get-Content -LiteralPath $f -Raw -Encoding UTF8 | Out-Printer -Name $p');

    const helper = read('local-print-agent/print-unicode.ps1');
    expect(helper).toContain('public static class JohnsUnicodePrinter');
    expect(helper).toContain('TextRenderingHint.AntiAliasGridFit');
    expect(helper).toContain('printerGraphics.DrawImage(bitmap, destination)');
    expect(helper).toContain('new UTF8Encoding(false, true)');
    expect(helper).toContain('StringFormatFlags.DirectionRightToLeft');
  });


  it('forces the installed localhost service onto the corrected v3 transport', () => {
    const agent = read('local-print-agent/agent.cjs');
    const restart = read('local-print-agent/restart-agent.ps1');
    const install = read('local-print-agent/install-startup.cmd');

    expect(agent).toContain("version: 3, transport: 'windows-gdi-raster'");
    expect(restart).toContain('Get-NetTCPConnection -LocalPort $port -State Listen');
    expect(restart).toContain("$process.Name -ieq 'node.exe'");
    expect(restart).toContain("$commandLine -match 'agent\\.cjs'");
    expect(restart).toContain("throw \"WRONG_PRINT_AGENT_VERSION:$($health.version)\"");
    expect(restart).toContain("throw \"WRONG_PRINT_TRANSPORT:$($health.transport)\"");
    expect(install).toContain('restart-agent.ps1');
    expect(install).toContain('Johns Print Service v3 is installed and verified.');
  });
});
