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
    expect(agent).toContain('Once Out-Printer is invoked we never retry here');
  });

  it('returns success only after Out-Printer resolves and supports Arabic station codes', () => {
    const agent = read('local-print-agent/agent.cjs');
    const printHandlerStart = agent.indexOf("if (req.method === 'POST' && url.pathname === '/print')");
    const drawerHandlerStart = agent.indexOf("if (req.method === 'POST' && url.pathname === '/drawer')", printHandlerStart);
    const printHandler = agent.slice(printHandlerStart, drawerHandlerStart);

    expect(agent).toContain('await ps(script, [printerName, tmp]);');
    expect(printHandler).toContain('const result = await printText(printer, text)');
    expect(printHandler).toContain('acceptedBySpooler: Boolean(result?.acceptedBySpooler)');
    expect(printHandler.indexOf('const result = await printText(printer, text)')).toBeLessThan(
      printHandler.indexOf('success: true'),
    );
    expect(agent).toContain('\\u0600-\\u06FF');
  });
});
