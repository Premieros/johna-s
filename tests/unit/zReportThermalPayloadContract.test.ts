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

  it('keeps browser/A4 HTML reporting separate', () => {
    expect(report).toContain('export function buildThermalZReportText');
    expect(report).toContain('export function buildThermalZReportHtml');
    expect(page).toContain('buildA4ZReportHtml(summary, currency, lang)');
  });

  it('queues the idempotent automatic report before optional audit network I/O', () => {
    const close = page.slice(page.indexOf('const finishClose ='), page.indexOf('const closeShift ='));
    expect(close.indexOf('await enqueueAutomaticShiftZReport')).toBeGreaterThan(0);
    expect(close.indexOf('await enqueueAutomaticShiftZReport')).toBeLessThan(close.indexOf('await logAudit'));
    expect(close).toContain('}, closeTarget.branch_id)');
  });
});
