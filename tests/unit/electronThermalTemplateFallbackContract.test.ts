import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('installed Electron thermal print compatibility guard', () => {
  const source = readFileSync('src/features/pos/services/localPrintAgent.ts', 'utf8');

  it('never sends fixed thermal template HTML to the installed Electron bridge', () => {
    expect(source).toContain(
      "const templateText = options.template\n        ? htmlToThermalText(buildFixedThermalTemplateHtml(options.template))\n        : '';",
    );
    expect(source).toContain(
      'text: options.template ? (options.text || templateText) : options.text,',
    );
    expect(source).toContain(
      'html: options.template ? undefined : options.html,',
    );
    expect(source).not.toContain('text: templateHtml ? undefined : options.text,');
    expect(source).not.toContain('html: templateHtml || options.html,');
  });

  it('keeps the DOM fallback stripping style/script content before text printing', () => {
    expect(source).toContain("doc.querySelectorAll('style,script,noscript,svg').forEach((node) => node.remove());");
  });
});
