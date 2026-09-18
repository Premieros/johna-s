import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const printing = fs.readFileSync('src/features/pos/utils/printing.ts', 'utf8');
const payment = fs.readFileSync('src/features/pos/services/payment.ts', 'utf8');
const baseHook = fs.readFileSync('src/features/pos/hooks/usePosOrderBase.ts', 'utf8');
const wrapperHook = fs.readFileSync('src/features/pos/hooks/usePosOrder.ts', 'utf8');
const agent = fs.readFileSync('src/features/pos/components/settings/CloudPrintAgent.tsx', 'utf8');
const localAgent = fs.readFileSync('src/features/pos/services/localPrintAgent.ts', 'utf8');
const zReport = fs.readFileSync('src/features/trade/services/shiftClosingReport.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260918231500_thermal_print_payload_guard.sql', 'utf8');

describe('thermal receipt and Z-report readability contract', () => {
  it('uses stable ASCII numbers/dates and explicit tender labels on payment receipts', () => {
    expect(printing).toContain('export function buildReceiptThermalText');
    expect(printing).toContain("*** إيصال دفع / PAYMENT RECEIPT ***");
    expect(printing).toContain("timeZone: 'Africa/Cairo'");
    expect(printing).toContain("new Intl.NumberFormat('en-US'");
    expect(printing).toContain("نقدي / CASH");
    expect(printing).toContain("بطاقة / CARD");
    expect(printing).toContain("الدفع / PAYMENT");
    expect(printing).toContain("payments?: Array<{ method: string; amount: number }>");
  });

  it('carries normal and split tender allocation into the printed receipt', () => {
    expect(payment).toContain('payments?: ReceiptTender[]');
    expect(payment).toContain('payments: splitPayments');
    expect(payment).toContain('payment_method: settlementPayload.p_payment_method');
    expect(baseHook).toContain('payments: (result.payments || []).map');
    expect(wrapperHook).toContain('extended.payments || []');
  });

  it('queues open checks as text and never sends receipt/report HTML to the legacy thermal transport', () => {
    expect(baseHook).toContain('buildReceiptThermalText(openOrderReceipt, effSettings, lang, isAr)');
    expect(baseHook).toContain('copies: 1');
    expect(agent).toContain("const isThermalDocument = job.kind === 'receipt' || job.kind === 'report'");
    expect(agent).toContain('html: isThermalDocument ? undefined : job.payload?.html');
    expect(localAgent).toContain("text: options.text || (options.html ? htmlToThermalText(options.html) : '')");
  });

  it('keeps the thermal Z-report concise while preserving full detail in A4', () => {
    const thermalStart = zReport.indexOf('export function buildThermalZReportText');
    const htmlStart = zReport.indexOf('export function buildThermalZReportHtml', thermalStart);
    const thermal = zReport.slice(thermalStart, htmlStart);
    expect(thermal).toContain('ملخص المبيعات / SALES');
    expect(thermal).toContain('طرق الدفع / PAYMENTS');
    expect(thermal).toContain('فواتير دفع مقسم');
    expect(thermal).toContain('التفاصيل الكاملة متاحة في تقرير A4');
    expect(thermal).not.toContain('INVOICES & TENDERS');
    expect(thermal).not.toContain('sale.invoiceNumber');
    expect(zReport.slice(htmlStart)).toContain('INVOICES & TENDERS');
  });

  it('normalizes receipt/report payloads at the durable queue boundary', () => {
    expect(migration).toContain("IF NEW.kind IN ('receipt','report')");
    expect(migration).toContain("RETURN (p_payload - 'html') || jsonb_build_object('text', v_text)");
    expect(migration).toContain("status IN ('pending','failed')");
    expect(migration).toContain("kind IN ('receipt','report')");
    expect(migration).toContain('THERMAL_PRINT_TEXT_REQUIRED');
    expect(migration).not.toContain("status='submitted'");
  });
});
