import type { Language, Settings } from '@/lib/types';
import { formatCurrency, escapeHtml } from '@/lib/format';
import { generateQRCodeDataURL } from '@/lib/barcode';
import { supabase } from '@/api';
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

/**
 * Check whether the current user may print. This function is intentionally
 * non-mutating: authorization alone must never create a successful print event.
 */
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

function buildReceiptPlainText(receipt: ReceiptData, s: Settings, lang: Language, isAr: boolean): string {
  const currency = s.currency || 'EGP';
  const width = receiptWidthMm(s.receipt_width_mm || 80);
  const divider = '-'.repeat(isCompactThermalWidth(width) ? 32 : 42);
  const lines: string[] = [];
  const row = (label: string, value: unknown) => lines.push(`${label}: ${safeThermalText(value)}`);
  const storeName = safeThermalText(s.store_name);
  if (storeName) lines.push(storeName);
  if (s.store_address) lines.push(safeThermalText(s.store_address));
  if (s.store_phone) row(isAr ? 'هاتف' : 'Tel', s.store_phone);
  if (s.receipt_header) lines.push(safeThermalText(s.receipt_header));
  row(isAr ? 'الفرع' : 'Branch', receipt.branchName);
  lines.push(divider);
  row(isAr ? 'الفاتورة' : 'Invoice', receipt.invoice);
  row(isAr ? 'التاريخ' : 'Date', new Date(receipt.date).toLocaleString(isAr ? 'ar-EG' : 'en-US'));
  if (receipt.orderTypeLabel) row(isAr ? 'النوع' : 'Type', receipt.orderTypeLabel);
  if (receipt.orderNumber) row(isAr ? 'الطلب' : 'Order', receipt.orderNumber);
  if (receipt.tableName) row(isAr ? 'طاولة' : 'Table', receipt.tableName);
  if (receipt.guestCount) row(isAr ? 'الضيوف' : 'Guests', receipt.guestCount);
  if (receipt.customerName) row(isAr ? 'العميل' : 'Customer', receipt.customerName);
  if (receipt.operatorName) row(isAr ? 'المستخدم' : 'User', receipt.operatorName);
  lines.push(divider);
  for (const item of receipt.items) {
    lines.push(safeThermalText(item.name));
    lines.push(`${safeThermalText(item.qty)} x ${safeThermalText(formatCurrency(item.price, currency, lang))}    ${safeThermalText(formatCurrency(item.total, currency, lang))}`);
  }
  lines.push(divider);
  row(isAr ? 'المجموع الفرعي' : 'Subtotal', formatCurrency(receipt.subtotal, currency, lang));
  if (receipt.discount > 0) row(isAr ? 'الخصم' : 'Discount', `-${formatCurrency(receipt.discount, currency, lang)}`);
  if (s.receipt_show_tax !== false && receipt.tax > 0) row(isAr ? 'الضريبة' : 'Tax', formatCurrency(receipt.tax, currency, lang));
  row(isAr ? 'الإجمالي' : 'Total', formatCurrency(receipt.total, currency, lang));
  row(isAr ? 'المدفوع' : 'Paid', formatCurrency(receipt.paid, currency, lang));
  if (receipt.change > 0) row(isAr ? 'الباقي' : 'Change', formatCurrency(receipt.change, currency, lang));
  lines.push(divider);
  if (s.receipt_footer) lines.push(safeThermalText(s.receipt_footer));
  lines.push(isAr ? 'شكراً لزيارتكم' : 'Thank you!');
  const one = `${lines.join('\r\n')}\r\n\r\n`;
  const copies = Math.max(1, Math.min(5, s.receipt_copies || 1));
  return Array.from({ length: copies }, () => one).join('\r\n\f\r\n');
}

export function openPrintWindow(html: string, widthMm: number): boolean {
  const win = window.open('', '_blank', `width=${Math.min(500, widthMm + 140)},height=600`);
  if (!win) return false;

  const token = receiptPrintToken(html);
  const pending = token ? pendingReceiptPrints.get(token) ?? null : null;
  if (token) pendingReceiptPrints.delete(token);

  win.document.write(html);
  win.document.close();

  // Kitchen/browser fallback tickets keep their embedded print script.
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
          ...(isRunningInElectron() ? { html } : { text: pending.plainText }),
        });
      }

      if (accepted) {
        // sale_print_events and the SALE_PRINTED audit entry are created only
        // after Electron/Print Agent explicitly confirms that it accepted the
        // physical print command. Missing/rejecting agents can never be logged
        // as a successful official print.
        await recordReceiptPrint(pending.authorization);
        if (!win.closed) win.close();
        return;
      }

      // Browser print dialogs cannot report whether the user actually printed or
      // cancelled. Keep this as an unconfirmed fallback: allow the operator to
      // print, but deliberately do not create a successful print event.
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

export async function buildReceiptHtml(receipt: ReceiptData, s: Settings, lang: Language, isAr: boolean): Promise<string> {
  const authorization = await authorizeReceiptPrint(receipt);
  const printToken = newPrintToken();
  pendingReceiptPrints.set(printToken, {
    authorization,
    plainText: buildReceiptPlainText(receipt, s, lang, isAr),
  });
  window.setTimeout(() => pendingReceiptPrints.delete(printToken), 60_000);

  const width = receiptWidthMm(s.receipt_width_mm || 80);
  const compact = isCompactThermalWidth(width);
  const copies = Math.max(1, Math.min(5, s.receipt_copies || 1));
  const showTax = s.receipt_show_tax !== false;
  const showQr = s.receipt_show_qr !== false;
  const currency = s.currency || 'EGP';
  const sidePaddingMm = compact ? 2 : 3;
  const bodyFontPx = compact ? 11 : 12;
  const smallFontPx = compact ? 9 : 10;
  const itemFontPx = compact ? 11 : 12;
  const totalFontPx = compact ? 15 : 16;
  const logoWidthMm = compact ? 28 : 36;
  const qrWidthMm = compact ? 18 : 22;

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
    <div class="meta-row"><span class="meta-value">${isAr ? 'الفاتورة' : 'Invoice'}: ${escapeHtml(receipt.invoice)}</span></div>
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
    <div class="money-row"><span>${isAr ? 'المدفوع' : 'Paid'}</span><span class="amount">${formatCurrency(receipt.paid, currency, lang)}</span></div>
    ${receipt.change > 0 ? `<div class="money-row"><span>${isAr ? 'الباقي' : 'Change'}</span><span class="amount">${formatCurrency(receipt.change, currency, lang)}</span></div>` : ''}
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
      <meta name="johns-print-auth" content="${escapeHtml(printToken)}">
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
          font-family: Tahoma, Arial, "Segoe UI", sans-serif;
          font-size: ${bodyFontPx}px;
          line-height: 1.35;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        body { overflow: visible; }
        .receipt-page {
          width: ${width}mm;
          min-height: 0;
          padding: 2.5mm ${sidePaddingMm}mm 4mm;
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
          font-size: ${compact ? 15 : 17}px;
          line-height: 1.2;
          font-weight: 800;
          overflow-wrap: anywhere;
        }
        .sub {
          margin: .5mm 0;
          font-size: ${smallFontPx}px;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }
        .branch-name { font-weight: 700; }
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
          margin: .65mm 0;
          min-width: 0;
        }
        .meta-value { display: block; overflow-wrap: anywhere; }
        .items-head,
        .item-detail,
        .money-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          column-gap: 2mm;
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
          padding: 1.3mm 0;
          border-bottom: .2mm dotted #777;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .item-row:last-of-type { border-bottom: 0; }
        .item-name {
          margin-bottom: .6mm;
          font-size: ${itemFontPx}px;
          line-height: 1.3;
          font-weight: 800;
          overflow-wrap: anywhere;
          word-break: normal;
        }
        .item-detail { font-size: ${smallFontPx}px; }
        .qty-price { overflow-wrap: anywhere; }
        .money-row {
          margin: .8mm 0;
          font-size: ${bodyFontPx}px;
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
          line-height: 1.4;
          overflow-wrap: anywhere;
        }
        .thank-you { margin-top: 2mm; font-weight: 800; }
        @page {
          margin: 0;
        }
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
            width: ${width}mm !important;
            margin: 0 !important;
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
  items: { name: string; qty: number; unit_name?: string | null }[];
  s: Settings;
  isAr: boolean;
}): string {
  const width = Math.max(50, Math.min(100, params.s.receipt_width_mm || 80));
  const { orderNumber, tableName, orderTypeLabel, guestCount, items, isAr } = params;
  const now = new Date().toLocaleString(isAr ? 'ar-SA' : 'en-US');
  const rows = items
    .map((i) => `<div class="item-name">${escapeHtml(i.name)}${i.unit_name && i.unit_name !== 'piece' ? ` (${escapeHtml(i.unit_name)})` : ''}</div><div class="row item-detail"><span>${isAr ? 'الكمية' : 'Qty'}</span><span>${i.qty}</span></div>`)
    .join('');
  return `<!DOCTYPE html>
    <html dir="${isAr ? 'rtl' : 'ltr'}">
    <head><title>${isAr ? 'تذكرة المطبخ' : 'Kitchen Ticket'}</title>
    <style>
      * { font-family: 'Courier New', monospace; margin: 0; padding: 0; box-sizing: border-box; }
      body { width: ${width}mm; padding: 4mm; font-size: 13px; color: #000; }
      .center { text-align: center; }
      .header { font-size: 15px; font-weight: bold; margin-bottom: 4px; }
      .divider { border-top: 2px solid #000; margin: 6px 0; }
      .row { display: flex; justify-content: space-between; margin: 2px 0; }
      .item-name { font-size: 15px; font-weight: bold; margin-top: 8px; }
      .item-detail { font-size: 13px; }
    </style></head>
    <body>
      <div class="center header">${escapeHtml(params.s.store_name)}</div>
      <div class="divider"></div>
      <div class="row"><span>${isAr ? 'التاريخ' : 'Date'}: ${now}</span></div>
      <div class="row"><span>${isAr ? 'النوع' : 'Type'}: ${escapeHtml(orderTypeLabel)}</span></div>
      ${orderNumber ? `<div class="row"><span>${isAr ? 'الطلب' : 'Order'}: ${escapeHtml(orderNumber)}</span></div>` : ''}
      ${tableName ? `<div class="row"><span>${isAr ? 'طاولة' : 'Table'}: ${escapeHtml(tableName)}</span></div>` : ''}
      ${guestCount ? `<div class="row"><span>${isAr ? 'الضيوف' : 'Guests'}: ${guestCount}</span></div>` : ''}
      <div class="divider"></div>
      ${rows}
      <div class="divider"></div>
      <div class="center">${isAr ? 'شكراً' : 'Thank you'}</div>
    </body>
    <script>window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 500); }</script>
    </html>`;
}