import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/pos/components/settings/PrinterSettingsPanel.tsx', 'utf8');

describe('printer settings queue summary polling', () => {
  it('limits noncritical monitoring reads to visible tabs every 15 seconds', () => {
    expect(source).toContain('if (!document.hidden) void loadPrintQueue();');
    expect(source).toContain('}, 15_000);');
    expect(source).not.toContain('setInterval(() => void loadPrintQueue(), 5000)');
  });

  it('still refreshes on resume and cancels the timer when settings unmount', () => {
    expect(source).toContain("document.addEventListener('visibilitychange', onVisible)");
    expect(source).toContain("document.removeEventListener('visibilitychange', onVisible)");
    expect(source).toContain('window.clearInterval(timer)');
    expect(source).toContain('queue.cancel()');
  });
});
