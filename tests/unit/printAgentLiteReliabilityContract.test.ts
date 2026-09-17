import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Premier Print Agent Lite reliability contract', () => {
  it('keeps the existing Lite runtime identity and browser bridge', () => {
    const main = read('print-agent-lite/MainForm.cs');
    expect(main).toContain('Text = "Premier Print Agent Lite"');
    expect(main).toContain('https://premieros.github.io/johna-s/');
    expect(main).toContain('window.electronAPI = {');
    expect(main).toContain('printSilent: (o) => call(\'printSilent\', o)');
    expect(main).toContain("hostname:'Premier-Lite',version:'1.2.0'");
    expect(main).toContain('window.__PREMIER_LITE_BACKGROUND__ = true');
  });

  it('serializes each physical printer and preflights the Windows spooler', () => {
    const bridge = read('print-agent-lite/PrintBridge.cs');
    expect(bridge).toContain('ConcurrentDictionary<string, SemaphoreSlim> _lanes');
    expect(bridge).toContain('await lane.WaitAsync()');
    expect(bridge).toContain('new ServiceController("Spooler")');
    expect(bridge).toContain('ServiceControllerStatus.Running');
    expect(bridge).toContain('EnsureSpoolerAndPrinterReadyWithRetry(printerName)');
    expect(bridge).toContain('acceptedBySpooler');
    expect(bridge).toContain('queuedAhead');
  });

  it('never retries after the Windows print submission starts', () => {
    const bridge = read('print-agent-lite/PrintBridge.cs');
    const preflightAt = bridge.indexOf('EnsureSpoolerAndPrinterReadyWithRetry(printerName);');
    const printAt = bridge.indexOf('document.Print();');
    expect(preflightAt).toBeGreaterThanOrEqual(0);
    expect(printAt).toBeGreaterThan(preflightAt);
    const afterPrint = bridge.slice(printAt);
    expect(afterPrint).not.toContain('EnsureSpoolerAndPrinterReadyWithRetry(printerName);');
    expect(bridge).toContain('Never retry after Print() is invoked');
  });
});
