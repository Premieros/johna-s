import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const page = fs.readFileSync('src/features/trade/pages/ShiftsPage.tsx', 'utf8');
const report = fs.readFileSync('src/features/trade/services/shiftClosingReport.ts', 'utf8');

describe('thermal Z-report cloud payload', () => {
  it('queues plain thermal text instead of raw HTML/CSS', () => {
    expect(page).toContain('buildThermalZReportText(summary, currency, lang)');
    expect(page).toContain('payload: { text, paperWidthMm: 80, copies: 1 }');
    expect(page).not.toContain('payload: { html, paperWidthMm: 80, copies: 1 }');
  });

  it('keeps the browser/A4 HTML report separate', () => {
    expect(report).toContain('export function buildThermalZReportText');
    expect(report).toContain('export function buildThermalZReportHtml');
    expect(page).toContain('buildA4ZReportHtml(summary, currency, lang)');
  });
});
