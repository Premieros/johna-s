import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/trade/services/shiftClosingReport.ts', 'utf8');
const html = source.slice(source.indexOf('export function buildThermalZReportHtml('));
const text = source.slice(source.indexOf('export function buildThermalZReportText('), source.indexOf('export function buildThermalZReportHtml('));

describe('compact Z report', () => {
  it('omits product and raw material line items from printable HTML', () => {
    expect(html).not.toContain('summary.productsSold.map(');
    expect(html).not.toContain('summary.ingredientsConsumed.map(');
    expect(html).not.toContain('Products Sold Summary');
    expect(html).not.toContain('Raw Materials & Ingredients Consumed');
  });
  it('keeps thermal Z financial-only with payment and drawer totals', () => {
    expect(text).not.toContain('summary.productsSold.map(');
    expect(text).not.toContain('summary.ingredientsConsumed.map(');
    expect(text).toContain('summary.netSales');
    expect(text).toContain('paymentSummary.collectedTotal');
    expect(text).toContain('summary.expectedAmount');
    expect(text).toContain('summary.difference');
  });
  it('retains HTML financial summaries', () => {
    expect(html).toContain('summary.netSales');
    expect(html).toContain('summary.expectedAmount');
    expect(html).toContain('summary.difference');
  });
});
