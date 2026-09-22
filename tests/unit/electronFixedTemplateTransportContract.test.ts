import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('fixed template Electron transport', () => {
  const source = readFileSync('src/features/pos/services/localPrintAgent.ts', 'utf8');

  it('prefers the installed localhost renderer for template-backed Electron jobs', () => {
    expect(source).toContain('PRINT_AGENT_URL}/health');
    expect(source).toContain('PRINT_AGENT_URL}/print');
    expect(source).toContain('template: options.template');
    expect(source).toContain('TEMPLATE_PRINT_TIMEOUT_MS');
  });

  it('never forwards fixed-template HTML through the Electron bridge', () => {
    expect(source).toContain('html: options.template ? undefined : options.html');
    expect(source).toContain('text: options.template ? (options.text || templateText) : options.text');
    expect(source).not.toContain('html: templateHtml || options.html');
  });

  it('does not double-print after an ambiguous localhost template request', () => {
    expect(source).toContain('LOCAL_TEMPLATE_PRINT_UNCONFIRMED');
    expect(source).toContain('Do not also send the same job through');
  });
});
