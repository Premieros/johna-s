import type { Language, Settings } from '@/lib/types';
import { formatCurrency, escapeHtml } from '@/lib/format';
import { generateQRCodeDataURL } from '@/lib/barcode';
import { supabase } from '@/api';
import { enqueueCloudReceiptPrint } from '../services/cloudPrint';
import {
  executeSilentPrint,
  getLocalPrinterRoutes,
  isRunningInElectron,
  isSilentPrintEnabled,
} from '../services/localPrintAgent';

export const THERMAL_RECEIPT_PRESET_WIDTHS_MM = [58, 80] as const;

export interface ReceiptData {
  invoice: string;
  branchName: string;
  items: { name: string; qty: number; price: number; total: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  change: number;
  date: string;
  customerName: string;
  orderNumber?: string;
  tableName?: string;
  orderTypeLabel?: string;
  guestCount?: number | null;
  operatorName?: string | null;
  payments?: Array<{ method: string; amount: number }>;
  isOpenOrder?: boolean;
}

type PrintAuthorizationResult = {
  success?: boolean;
  error?: string;
  action?: string;
  print_number?: number;
  is_reprint?: boolean;
};

type ReceiptPrintAuthorization = {
  saleId: string;
  approvalRequestId: string | null;
};

type PendingReceiptPrint = {
  authorization: ReceiptPrintAuthorization;
  plainText: string;
};

type ApprovalRow = {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed';
  expires_at: string;
};

const pendingReceiptPrints = new Map<string, PendingReceiptPrint>();

export class ReceiptPrintApprovalError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReceiptPrintApprovalError';
    this.code = code;
  }
}

async function authorizeReceiptPrint(receipt: ReceiptData): Promise<ReceiptPrintAuthorization> {
  const invoice = receipt.invoice?.trim();
  if (!invoice) {
    throw new ReceiptPrintApprovalError('INVALID_INVOICE', 'Receipt invoice number is required');
  }

  const { data: sale, error: saleError } = await supabase
    .from('sales')
    .select('id')
    .eq('invoice_number', invoice)
    .maybeSingle();

  if (saleError) throw saleError;
  if (!sale?.id) {
    throw new ReceiptPrintApprovalError('SALE_NOT_FOUND', 'Sale was not found for receipt printing');
  }

  const tryAuthorize = async (approvalRequestId: string | null) => {
    const { data, error } = await supabase.rpc('authorize_sale_print', {
      p_sale_id: sale.id,
      p_approval_request_id: approvalRequestId,
    });
    if (error) throw error;
    return (data ?? {}) as PrintAuthorizationResult;
  };

  const initial = await tryAuthorize(null);
  if (initial.success) return { saleId: sale.id, approvalRequestId: null };
  if (initial.error !== 'MANAGER_APPROVAL_REQUIRED') {
    throw new ReceiptPrintApprovalError(initial.error || 'PRINT_NOT_AUTHORIZED', initial.error || 'Receipt print is not authorized');
  }

  const nowIso = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from('approval_requests')
    .select('id,status,expires_at')
    .eq('action_type', 'reprint')
    .eq('entity_type', 'sale')
    .eq('entity_id', sale.id)
    .in('status', ['pending', 'approved'])
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) throw existingError;
  const request = existing as ApprovalRow | null;

  if (request?.status === 'approved') {
    const authorized = await tryAuthorize(request.id);
    if (authorized.success) return { saleId: sale.id, approvalRequestId: request.id };
    throw new ReceiptPrintApprovalError(authorized.error || 'INVALID_APPROVAL', authorized.error || 'Reprint approval is invalid');
  }

  if (request?.status === 'pending') {
    throw new ReceiptPrintApprovalError(
      'REPRINT_APPROVAL_PENDING',
      'Manager approval is pending for this receipt reprint',
    );
  }

  const { data: created, error: createError } = await supabase.rpc('request_manager_approval', {
    p_action_type: 'reprint',
    p_entity_type: 'sale',
    p_entity_id: sale.id,
    p_payload: {
      invoice_number: invoice,
      total: receipt.total,
    },
    p_reason: `Receipt reprint: ${invoice}`,
  });

  if (createError) throw createError;
  const createdResult = (created ?? {}) as { success?: boolean; error?: string };
  if (!createdResult.success) {
    throw new ReceiptPrintApprovalError(
      createdResult.error || 'APPROVAL_REQUEST_FAILED',
      createdResult.error || 'Could not create reprint approval request',
    );
  }

  throw new ReceiptPrintApprovalError(
    'REPRINT_APPROVAL_PENDING',
    'Manager approval request was sent for this receipt reprint',
  );
}

async function recordReceiptPrint(authorization: ReceiptPrintAuthorization): Promise<void> {
  const { data, error } = await supabase.rpc('record_sale_print', {
    p_sale_id: authorization.saleId,
    p_approval_request_id: authorization.approvalRequestId,
  });
  if (error) throw error;
  const result = (data ?? {}) as PrintAuthorizationResult;
  if (!result.success) {
    throw new ReceiptPrintApprovalError(
      result.error || 'PRINT_RECORD_FAILED',
      result.error || 'Receipt print could not be recorded',
    );
  }
}

function newPrintToken(): string {
  return globalThis.crypto?.randomUUID?.() || `print_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function receiptPrintToken(html: string): string | null {
  return html.match(/<meta name="johns-print-auth" content="([^"]+)">/)?.[1] || null;
}

function receiptWidthMm(value: unknown): number {
  const configured = Number(value);
  if (!Number.isFinite(configured)) return 80;
  return Math.max(50, Math.min(100, configured));
}

function isCompactThermalWidth(widthMm: number): boolean {
  return widthMm <= THERMAL_RECEIPT_PRESET_WIDTHS_MM[0] + 2;
}

function safeThermalText(value: unknown): string {
  return Array.from(String(value ?? ''))
    .filter((ch) => ch === '\r' || ch === '\n' || ch === '\t' || ch >= ' ')
    .join('')
    .trim();
}

function thermalNumber(value: unknown, maxFractionDigits = 2): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
    useGrouping: true,
  }).format(n);
}

function thermalMoney(value: unknown, currency: string): string {
  return `${thermalNumber(value, 2)} ${safeThermalText(currency || 'EGP')}`;
}

function thermalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeThermalText(value);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

function thermalPaymentLabel(method: string, isAr: boolean): string {
  const key = String(method || '').toLowerCase();
  const labels: Record<string, [string, string]> = {
    cash: ['نقدي', 'CASH'],
    card: ['بطاقة', 'CARD'],
    transfer: ['تحويل', 'TRANSFER'],
    bank_transfer: ['تحويل بنكي', 'BANK TRANSFER'],
    instapay: ['إنستاباي', 'INSTAPAY'],
    credit: ['آجل', 'CREDIT'],
  };
  const label = labels[key];
  return label ? (isAr ? label[0] : label[1]) : safeThermalText(method).toUpperCase();
}

export function buildReceiptThermalText(receipt: ReceiptData, s: Settings, _lang: Language, isAr: boolean): string {
  const currency = safeThermalText(s.currency || 'EGP');
  const width = receiptWidthMm(s.receipt_width_mm || 80);
  const divider = '-'.repeat(isCompactThermalWidth(width) ? 32 : 42);
  const strongDivider = '='.repeat(isCompactThermalWidth(width) ? 32 : 42);
  const lines: string[] = [];
  const row = (label: string, value: unknown) => lines.push(`${label}: ${safeThermalText(value)}`);

  const storeName = safeThermalText(s.store_name);
  if (storeName) lines.push(storeName);
  lines.push(receipt.isOpenOrder
    ? (isAr ? 'حساب مبدئي' : 'OPEN CHECK')
    : (isAr ? 'إيصال العميل' : 'CUSTOMER RECEIPT'));

  if (s.store_address) lines.push(safeThermalText(s.store_address));
  if (s.store_phone) row(isAr ? 'هاتف' : 'Tel', s.store_phone);
  row(isAr ? 'الفرع' : 'Branch', receipt.branchName);

  lines.push(strongDivider);
  row(receipt.isOpenOrder ? (isAr ? 'الطلب' : 'Order') : (isAr ? 'الفاتورة' : 'Invoice'), receipt.invoice);
  row(isAr ? 'التاريخ' : 'Date', thermalDateTime(receipt.date));
  if (receipt.orderTypeLabel) row(isAr ? 'النوع' : 'Type', receipt.orderTypeLabel);
  if (receipt.orderNumber && receipt.orderNumber !== receipt.invoice) row(isAr ? 'الطلب' : 'Order', receipt.orderNumber);
  if (receipt.tableName) row(isAr ? 'الطاولة' : 'Table', receipt.tableName);
  if (receipt.guestCount) row(isAr ? 'الأفراد' : 'Guests', receipt.guestCount);
  if (receipt.customerName) row(isAr ? 'العميل' : 'Customer', receipt.customerName);
  if (receipt.operatorName) row(isAr ? 'المستخدم' : 'User', receipt.operatorName);

  lines.push(divider);
  lines.push(isAr ? 'الأصناف' : 'ITEMS');
  lines.push(divider);
  for (const item of receipt.items) {
    lines.push(safeThermalText(item.name));
    lines.push(`${thermalNumber(item.qty, 3)} x ${thermalMoney(item.price, currency)} = ${thermalMoney(item.total, currency)}`);
  }

  lines.push(strongDivider);
  row(isAr ? 'المجموع الفرعي' : 'Subtotal', thermalMoney(receipt.subtotal, currency));
  if (receipt.discount > 0) row(isAr ? 'الخصم' : 'Discount', `-${thermalMoney(receipt.discount, currency)}`);
  if (s.receipt_show_tax !== false && receipt.tax > 0) row(isAr ? 'الضريبة' : 'Tax', thermalMoney(receipt.tax, currency));
  row(isAr ? 'الإجمالي' : 'TOTAL', thermalMoney(receipt.total, currency));

  if (!receipt.isOpenOrder) {
    const payments = (receipt.payments || []).filter((payment) => String(payment.method || '').trim());
    if (payments.length > 0) {
      lines.push(divider);
      lines.push(isAr ? 'الدفع' : 'PAYMENT');
      lines.push(divider);
      for (const payment of payments) {
        row(thermalPaymentLabel(payment.method, isAr), thermalMoney(payment.amount, currency));
      }
    }
    row(isAr ? 'المدفوع' : 'Paid', thermalMoney(receipt.paid, currency));
    if (receipt.change > 0) row(isAr ? 'الباقي' : 'Change', thermalMoney(receipt.change, currency));
  }

  lines.push(strongDivider);
  if (s.receipt_footer) lines.push(safeThermalText(s.receipt_footer));
  lines.push(isAr ? 'شكراً لزيارتكم' : 'Thank you for visiting.');
  const one = `${lines.join('\r\n')}\r\n\r\n`;
  const copies = Math.max(1, Math.min(5, s.receipt_copies || 1));
  return Array.from({ length: copies }, () => one).join('\r\n\f\r\n');
}

function openBrowserFallback(html: string, widthMm: number): boolean {
  const win = window.open('', '_blank', `width=${Math.min(500, widthMm + 140)},height=600`);
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  window.setTimeout(() => {
    if (!win.closed) win.close();
  }, 300);
  return true;
}

export function openPrintWindow(html: string, widthMm: number): boolean {
  const token = receiptPrintToken(html);
  const pending = token ? pendingReceiptPrints.get(token) ?? null : null;
  if (token) pendingReceiptPrints.delete(token);

  // Browser/mobile clients should not need a local network connection to the
  // branch PC. Queue the authorized receipt first; the Windows Print Agent will
  // confirm the physical print and only then persist the sale print event.
  if (pending && !isRunningInElectron()) {
    void (async () => {
      try {
        const cloud = await enqueueCloudReceiptPrint({
          saleId: pending.authorization.saleId,
          approvalRequestId: pending.authorization.approvalRequestId,
          payload: {
            text: pending.plainText,
            paperWidthMm: widthMm,
            copies: 1,
          },
          idempotencyKey: token ? `receipt-ui:${token}` : undefined,
        });
        if (cloud.accepted) return;

        // Compatibility fallback for installations that have not applied the
        // cloud queue migration yet: keep the proven localhost agent path.
        const routes = getLocalPrinterRoutes();
        const printerName = routes.cashier || routes.receipt || routes.main || '';
        if (printerName && isSilentPrintEnabled()) {
          const accepted = await executeSilentPrint({
            printerName,
            text: pending.plainText,
            paperWidthMm: widthMm,
          });
          if (accepted) {
            await recordReceiptPrint(pending.authorization);
            return;
          }
        }

        console.warn('[receipt-print] cloud/local print not confirmed; browser fallback is not recorded as printed');
        openBrowserFallback(html, widthMm);
      } catch (error) {
        console.error('[receipt-print] remote print failed', error);
        openBrowserFallback(html, widthMm);
      }
    })();
    return true;
  }

  const win = window.open('', '_blank', `width=${Math.min(500, widthMm + 140)},height=600`);
  if (!win) return false;

  win.document.write(html);
  win.document.close();

  if (!pending) return true;

  const runReceiptPrint = async () => {
    if (win.closed) return;
    try {
      const routes = getLocalPrinterRoutes();
      const printerName = routes.cashier || routes.receipt || routes.main || '';
      let accepted = false;
      if (printerName && isSilentPrintEnabled()) {
        accepted = await executeSilentPrint({
          printerName,
          html,
          paperWidthMm: widthMm,
        });
      }

      if (accepted) {
        await recordReceiptPrint(pending.authorization);
        if (!win.closed) win.close();
        return;
      }

      console.warn('[receipt-print] local print not confirmed; browser fallback is not recorded as printed');
      win.focus();
      win.print();
      window.setTimeout(() => {
        if (!win.closed) win.close();
      }, 300);
    } catch (error) {
      console.error('[receipt-print] confirmed print record failed', error);
      if (!win.closed) {
        const message = error instanceof Error ? error.message : 'Receipt print could not be confirmed';
        win.document.body.innerHTML = `<pre style="white-space:pre-wrap;padding:20px;font-family:sans-serif">${escapeHtml(message)}</pre>`;
      }
    }
  };

  if (win.document.readyState === 'complete') {
    window.setTimeout(() => void runReceiptPrint(), 0);
  } else {
    win.addEventListener('load', () => void runReceiptPrint(), { once: true });
  }
  return true;
}

export async function buildReceiptHtml(
  receipt: ReceiptData,
  s: Settings,
  lang: Language,
  isAr: boolean,
  options?: { authorize?: boolean },
): Promise<string> {
  let printToken: string | null = null;
  if (options?.authorize !== false) {
    const authorization = await authorizeReceiptPrint(receipt);
    printToken = newPrintToken();
    pendingReceiptPrints.set(printToken, {
      authorization,
      plainText: buildReceiptThermalText(receipt, s, lang, isAr),
    });
    const tokenToDelete = printToken;
    window.setTimeout(() => pendingReceiptPrints.delete(tokenToDelete), 60_000);
  }

  const width = receiptWidthMm(s.receipt_width_mm || 80);
  const compact = isCompactThermalWidth(width);
  const copies = Math.max(1, Math.min(5, s.receipt_copies || 1));
  const showTax = s.receipt_show_tax !== false;
  const showQr = s.receipt_show_qr !== false;
  const currency = s.currency || 'EGP';
  // Visual-only receipt profile: identical typography scale for Arabic and English.
  // Routing, authorization, queueing, printer selection and Print Agent behavior stay unchanged.
  const safeContentWidthMm = Math.max(46, width - (compact ? 4 : 6));
  const sidePaddingMm = compact ? 1.4 : 1.8;
  const bodyFontPx = compact ? 11 : 12;
  const smallFontPx = compact ? 9 : 10;
  const itemFontPx = compact ? 11 : 12;
  const totalFontPx = compact ? 15 : 17;
  const logoWidthMm = compact ? 24 : 32;
  const qrWidthMm = compact ? 16 : 20;

  let qrImg = '';
  if (showQr) {
    try {
      qrImg = await generateQRCodeDataURL(
        JSON.stringify({ inv: receipt.invoice, total: receipt.total, date: receipt.date })
      );
    } catch {
      qrImg = '';
    }
  }

  const single = `
    ${s.logo_url ? `<div class="center logo-wrap"><img src="${escapeHtml(s.logo_url)}" alt="logo" class="receipt-logo" /></div>` : ''}
    <div class="center header">${escapeHtml(s.store_name)}</div>
    ${s.store_address ? `<div class="center sub">${escapeHtml(s.store_address)}</div>` : ''}
    ${s.store_phone ? `<div class="center sub">${isAr ? 'هاتف' : 'Tel'}: ${escapeHtml(s.store_phone)}</div>` : ''}
    ${s.receipt_header ? `<div class="center sub pre-wrap">${escapeHtml(s.receipt_header)}</div>` : ''}
    <div class="center sub branch-name">${isAr ? 'الفرع' : 'Branch'}: ${escapeHtml(receipt.branchName)}</div>
    <div class="divider"></div>
    ${receipt.isOpenOrder ? `<div class="center open-order-label">${isAr ? 'حساب مبدئي – غير مدفوع' : 'OPEN CHECK – NOT PAID'}</div>` : ''}
    <div class="meta-row"><span class="meta-value">${receipt.isOpenOrder ? (isAr ? 'الطلب' : 'Order') : (isAr ? 'الفاتورة' : 'Invoice')}: ${escapeHtml(receipt.invoice)}</span></div>
    <div class="meta-row"><span class="meta-value">${isAr ? 'التاريخ' : 'Date'}: ${escapeHtml(new Date(receipt.date).toLocaleString(isAr ? 'ar-EG' : 'en-US'))}</span></div>
    ${receipt.orderTypeLabel ? `<div class="meta-row"><span class="meta-value">${isAr ? 'النوع' : 'Type'}: ${escapeHtml(receipt.orderTypeLabel)}</span></div>` : ''}
    ${receipt.orderNumber ? `<div class="meta-row"><span class="meta-value">${isAr ? 'الطلب' : 'Order'}: ${escapeHtml(receipt.orderNumber)}</span></div>` : ''}
    ${receipt.tableName ? `<div class="meta-row"><span class="meta-value">${isAr ? 'طاولة' : 'Table'}: ${escapeHtml(receipt.tableName)}</span></div>` : ''}
    ${receipt.guestCount ? `<div class="meta-row"><span class="meta-value">${isAr ? 'الضيوف' : 'Guests'}: ${receipt.guestCount}</span></div>` : ''}
    ${receipt.customerName ? `<div class="meta-row"><span class="meta-value">${isAr ? 'العميل' : 'Customer'}: ${escapeHtml(receipt.customerName)}</span></div>` : ''}
    ${receipt.operatorName ? `<div class="meta-row"><span class="meta-value">${isAr ? 'المستخدم' : 'User'}: ${escapeHtml(receipt.operatorName)}</span></div>` : ''}
    <div class="divider"></div>
    <div class="items-head"><span>${isAr ? 'الصنف' : 'Item'}</span><span>${isAr ? 'الإجمالي' : 'Total'}</span></div>
    ${receipt.items.map((i) => `<div class="item-row"><div class="item-name">${escapeHtml(i.name)}</div><div class="item-detail"><span class="qty-price">${i.qty} × ${formatCurrency(i.price, currency, lang)}</span><span class="amount">${formatCurrency(i.total, currency, lang)}</span></div></div>`).join('')}
    <div class="divider"></div>
    <div class="money-row"><span>${isAr ? 'المجموع الفرعي' : 'Subtotal'}</span><span class="amount">${formatCurrency(receipt.subtotal, currency, lang)}</span></div>
    ${receipt.discount > 0 ? `<div class="money-row"><span>${isAr ? 'الخصم' : 'Discount'}</span><span class="amount">-${formatCurrency(receipt.discount, currency, lang)}</span></div>` : ''}
    ${showTax && receipt.tax > 0 ? `<div class="money-row"><span>${isAr ? 'الضريبة' : 'Tax'} (${escapeHtml(s.tax_rate ?? 0)}%)</span><span class="amount">${formatCurrency(receipt.tax, currency, lang)}</span></div>` : ''}
    <div class="divider strong"></div>
    <div class="money-row total-row"><span>${isAr ? 'الإجمالي' : 'Total'}</span><span class="amount">${formatCurrency(receipt.total, currency, lang)}</span></div>
    ${receipt.isOpenOrder ? '' : `<div class="money-row"><span>${isAr ? 'المدفوع' : 'Paid'}</span><span class="amount">${formatCurrency(receipt.paid, currency, lang)}</span></div>`}
    ${!receipt.isOpenOrder && receipt.change > 0 ? `<div class="money-row"><span>${isAr ? 'الباقي' : 'Change'}</span><span class="amount">${formatCurrency(receipt.change, currency, lang)}</span></div>` : ''}
    ${qrImg ? `<div class="center qr-wrap"><img src="${qrImg}" class="receipt-qr" alt="QR" /></div>` : ''}
    <div class="divider"></div>
    ${s.receipt_footer ? `<div class="footer pre-wrap">${escapeHtml(s.receipt_footer)}</div>` : ''}
    <div class="footer thank-you">${isAr ? 'شكراً لزيارتكم' : 'Thank you!'}</div>`;

  const pages = Array.from({ length: copies }, () => `<section class="receipt-page">${single}</section>`).join('\n');
  return `<!DOCTYPE html>
    <html lang="${isAr ? 'ar' : 'en'}" dir="${isAr ? 'rtl' : 'ltr'}">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(receipt.invoice)}</title>
      ${printToken ? `<meta name="johns-print-auth" content="${escapeHtml(printToken)}">` : ''}
      <style>
        :root { color-scheme: light only; }
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          width: ${width}mm;
          min-width: ${width}mm;
          max-width: ${width}mm;
          background: #fff;
          color: #000;
          font-family: Arial, Tahoma, "Segoe UI", sans-serif;
          font-size: ${bodyFontPx}px;
          line-height: 1.35;
          font-weight: 600;
          letter-spacing: 0;
          text-rendering: optimizeLegibility;
          font-synthesis: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        body { overflow: visible; }
        .receipt-page {
          width: ${safeContentWidthMm}mm;
          max-width: ${safeContentWidthMm}mm;
          min-height: 0;
          margin: 0 auto;
          padding: 2mm ${sidePaddingMm}mm 3mm;
          background: #fff;
          color: #000;
          page-break-after: always;
          break-after: page;
        }
        .receipt-page:last-child { page-break-after: auto; break-after: auto; }
        .center { text-align: center; }
        .logo-wrap { margin: 0 auto 1.5mm; }
        .receipt-logo {
          display: block;
          width: auto;
          max-width: ${logoWidthMm}mm;
          max-height: 18mm;
          margin: 0 auto;
          object-fit: contain;
          filter: grayscale(100%) contrast(125%);
        }
        .header {
          margin: 0 0 1mm;
          font-size: ${compact ? 16 : 18}px;
          line-height: 1.3;
          font-weight: 800;
          overflow-wrap: anywhere;
        }
        .sub {
          margin: .5mm 0;
          font-size: ${smallFontPx}px;
          line-height: 1.45;
          overflow-wrap: anywhere;
        }
        .branch-name { font-weight: 700; }
        .open-order-label { margin: 1mm 0 1.5mm; font-size: ${compact ? 12 : 13}px; font-weight: 900; border: .3mm solid #000; padding: 1mm; }
        .pre-wrap { white-space: pre-wrap; }
        .divider {
          width: 100%;
          margin: 2mm 0;
          border: 0;
          border-top: .3mm dashed #000;
        }
        .divider.strong { border-top-style: solid; border-top-width: .45mm; }
        .meta-row {
          display: block;
          margin: .8mm 0;
          min-width: 0;
          line-height: 1.4;
        }
        .meta-value { display: block; overflow-wrap: anywhere; }
        .items-head,
        .item-detail,
        .money-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          column-gap: 1.2mm;
          align-items: baseline;
        }
        .items-head {
          margin-bottom: 1mm;
          font-size: ${smallFontPx}px;
          font-weight: 800;
          border-bottom: .25mm solid #000;
          padding-bottom: .7mm;
        }
        .item-row {
          padding: 1.1mm 0;
          border-bottom: .2mm dotted #777;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .item-row:last-of-type { border-bottom: 0; }
        .item-name {
          margin-bottom: .7mm;
          font-size: ${itemFontPx}px;
          line-height: 1.3;
          font-weight: 800;
          overflow-wrap: anywhere;
          word-break: normal;
        }
        .item-detail { font-size: ${smallFontPx}px; line-height: 1.3; font-weight: 600; min-width: 0; }
        .qty-price { overflow-wrap: anywhere; }
        .money-row {
          margin: .8mm 0;
          font-size: ${bodyFontPx}px;
          line-height: 1.3;
          font-weight: 600;
        }
        .amount {
          white-space: nowrap;
          direction: ltr;
          unicode-bidi: isolate;
          font-variant-numeric: tabular-nums;
          text-align: right;
        }
        .total-row {
          margin: 1.3mm 0;
          font-size: ${totalFontPx}px;
          line-height: 1.25;
          font-weight: 900;
        }
        .qr-wrap { margin: 3mm auto 1mm; break-inside: avoid; page-break-inside: avoid; }
        .receipt-qr {
          display: block;
          width: ${qrWidthMm}mm;
          height: ${qrWidthMm}mm;
          margin: 0 auto;
          image-rendering: pixelated;
        }
        .footer {
          margin-top: 1.5mm;
          text-align: center;
          font-size: ${smallFontPx}px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }
        .thank-you { margin-top: 2mm; font-weight: 800; }
        @page { margin: 0; }
        @media print {
          html,
          body {
            width: ${width}mm !important;
            min-width: ${width}mm !important;
            max-width: ${width}mm !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            color: #000 !important;
          }
          .receipt-page {
            width: ${safeContentWidthMm}mm !important;
            max-width: ${safeContentWidthMm}mm !important;
            margin: 0 auto !important;
            box-shadow: none !important;
          }
        }
      </style>
    </head>
    <body>${pages}</body>
    </html>`;
}

export function buildKitchenTicketHtml(params: {
  orderNumber: string | null;
  tableName: string | null;
  orderTypeLabel: string;
  guestCount: number | null;
  items: { name: string; qty: number; unit_name?: string | null; note?: string | null }[];
  orderNote?: string | null;
  s: Settings;
  isAr: boolean;
}): string {
  const width = receiptWidthMm(params.s.receipt_width_mm || 80);
  const compact = isCompactThermalWidth(width);
  const sidePaddingMm = compact ? 2 : 3;
  const bodyFontPx = compact ? 15 : 17;
  const headerFontPx = compact ? 19 : 22;
  const metaFontPx = compact ? 14 : 16;
  const itemFontPx = compact ? 19 : 22;
  const qtyFontPx = compact ? 20 : 24;
  const { orderNumber, tableName, orderTypeLabel, guestCount, items, orderNote, isAr } = params;
  const now = new Date().toLocaleString(isAr ? 'ar-EG' : 'en-US');
  const metaRows = 2 + (orderNumber ? 1 : 0) + (tableName ? 1 : 0) + (guestCount ? 1 : 0);
  const estimateLines = (value: unknown, wrapAt: number) => {
    const normalized = String(value || '').trim();
    if (!normalized) return 0;
    return normalized.split(/\r?\n/).reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / wrapAt)), 0);
  };
  const estimatedItemMm = items.reduce((sum, item) => {
    const wrapAt = compact ? 16 : 24;
    const nameLines = Math.max(1, estimateLines(item.name, wrapAt));
    const noteLines = estimateLines(item.note, compact ? 20 : 28);
    return sum + 7.5 + (nameLines * 4.8) + (noteLines * 4.2);
  }, 0);
  const orderNoteLines = estimateLines(orderNote, compact ? 22 : 30);
  const pageHeightMm = Math.max(45, Math.ceil(25 + (metaRows * 5) + (orderNoteLines * 4.2) + estimatedItemMm + 9));
  const rows = items
    .map((i) => `<section class="item-row"><div class="item-line"><strong class="qty-badge">${escapeHtml(i.qty)}×</strong><div class="item-name">${escapeHtml(i.name)}${i.unit_name && i.unit_name !== 'piece' ? ` <span class="unit">(${escapeHtml(i.unit_name)})</span>` : ''}</div></div><div class="qty-caption">${isAr ? 'الكمية' : 'Qty'}: <strong>${escapeHtml(i.qty)}</strong></div>${i.note ? `<div class="item-note"><strong>${isAr ? 'ملاحظة' : 'Note'}:</strong> ${escapeHtml(i.note)}</div>` : ''}</section>`)
    .join('');

  return `<!DOCTYPE html>
    <html lang="${isAr ? 'ar' : 'en'}" dir="${isAr ? 'rtl' : 'ltr'}">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${isAr ? 'تذكرة المطبخ' : 'Kitchen Ticket'}</title>
      <style>
        :root { color-scheme: light only; }
        * { box-sizing: border-box; }
        html, body {
          margin: 0;
          padding: 0;
          width: ${width}mm;
          min-width: ${width}mm;
          max-width: ${width}mm;
          min-height: 0;
          height: auto;
          background: #fff;
          color: #000;
          font-family: Tahoma, Arial, "Segoe UI", sans-serif;
          font-size: ${bodyFontPx}px;
          line-height: 1.35;
          font-weight: 600;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        body { overflow: visible; }
        .ticket {
          width: ${width}mm;
          padding: 2.5mm ${sidePaddingMm}mm 3mm;
          background: #fff;
          color: #000;
          border: .45mm solid #000;
        }
        .center { text-align: center; }
        .header {
          font-size: ${headerFontPx}px;
          line-height: 1.2;
          font-weight: 900;
          margin-bottom: 1.5mm;
          overflow-wrap: anywhere;
        }
        .ticket-title {
          font-size: ${metaFontPx}px;
          font-weight: 900;
          margin-bottom: 1mm;
        }
        .divider {
          width: 100%;
          margin: 2mm 0;
          border: 0;
          border-top: .45mm solid #000;
        }
        .meta-row {
          display: block;
          margin: 1mm 0;
          font-size: ${metaFontPx}px;
          font-weight: 700;
          overflow-wrap: anywhere;
        }
        .item-row {
          padding: 2.2mm 0;
          border-bottom: .35mm dashed #000;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .item-row:last-child { border-bottom: 0; }
        .item-line {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          gap: 2.5mm;
          align-items: center;
        }
        .qty-badge {
          min-width: 12mm;
          padding: 1mm 1.5mm;
          border: .4mm solid #000;
          text-align: center;
          direction: ltr;
          unicode-bidi: isolate;
          font-size: ${qtyFontPx}px;
          line-height: 1;
          font-weight: 900;
        }
        .item-name {
          font-size: ${itemFontPx}px;
          line-height: 1.2;
          font-weight: 900;
          overflow-wrap: anywhere;
        }
        .unit { font-size: .72em; font-weight: 700; }
        .item-note { margin-top: 1.2mm; padding: 1.2mm 1.5mm; border: .3mm solid #000; font-size: ${metaFontPx}px; line-height: 1.35; font-weight: 800; white-space: pre-wrap; overflow-wrap: anywhere; }
        .order-note { margin: 1.5mm 0; padding: 1.5mm; border: .4mm solid #000; font-size: ${metaFontPx}px; line-height: 1.35; font-weight: 900; white-space: pre-wrap; overflow-wrap: anywhere; }
        .qty-caption {
          margin-top: 1.2mm;
          font-size: ${metaFontPx}px;
          font-weight: 800;
        }
        .qty-caption strong {
          direction: ltr;
          unicode-bidi: isolate;
          font-size: 1.15em;
          font-weight: 900;
        }
        .footer {
          margin-top: 2mm;
          text-align: center;
          font-size: ${metaFontPx}px;
          font-weight: 800;
        }
        @page {
          size: ${width}mm ${pageHeightMm}mm;
          margin: 0;
        }
        @media print {
          html,
          body {
            width: ${width}mm !important;
            min-width: ${width}mm !important;
            max-width: ${width}mm !important;
            min-height: 0 !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            color: #000 !important;
          }
          .ticket {
            width: ${width}mm !important;
            margin: 0 !important;
            box-shadow: none !important;
          }
        }
      </style>
    </head>
    <body>
      <main class="ticket">
        <div class="center header">${escapeHtml(params.s.store_name)}</div>
        <div class="center ticket-title">${isAr ? 'تذكرة المطبخ' : 'Kitchen Ticket'}</div>
        <div class="divider"></div>
        <div class="meta-row">${isAr ? 'التاريخ' : 'Date'}: ${escapeHtml(now)}</div>
        <div class="meta-row">${isAr ? 'النوع' : 'Type'}: ${escapeHtml(orderTypeLabel)}</div>
        ${orderNumber ? `<div class="meta-row">${isAr ? 'الطلب' : 'Order'}: ${escapeHtml(orderNumber)}</div>` : ''}
        ${tableName ? `<div class="meta-row">${isAr ? 'طاولة' : 'Table'}: ${escapeHtml(tableName)}</div>` : ''}
        ${guestCount ? `<div class="meta-row">${isAr ? 'الضيوف' : 'Guests'}: ${guestCount}</div>` : ''}
        ${orderNote ? `<div class="order-note"><strong>${isAr ? 'ملاحظات الطلب' : 'Order notes'}:</strong> ${escapeHtml(orderNote)}</div>` : ''}
        <div class="divider"></div>
        ${rows}
        <div class="divider"></div>
        <div class="footer">${isAr ? 'شكراً' : 'Thank you'}</div>
      </main>
    </body>
    <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>
    </html>`;
}
