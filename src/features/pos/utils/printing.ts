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

function queueSafeReceiptFormHtml(html: string): string {
  return String(html || '')
    .replace(/\s*<meta name="johns-print-auth" content="[^"]*">\s*/i, '')
    .trim();
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

function thermalCenter(value: unknown, columns: number): string {
  const text = safeThermalText(value);
  if (!text || text.length >= columns) return text;
  return `${' '.repeat(Math.max(0, Math.floor((columns - text.length) / 2)))}${text}`;
}

function thermalColumns(left: unknown, right: unknown, columns: number): string {
  const lhs = safeThermalText(left);
  const rhs = safeThermalText(right);
  if (!rhs) return lhs;
  const gap = columns - lhs.length - rhs.length;
  if (gap < 2) return `${lhs}\r\n${rhs}`;
  return `${lhs}${' '.repeat(gap)}${rhs}`;
}

export function buildReceiptThermalText(receipt: ReceiptData, s: Settings, _lang: Language, isAr: boolean): string {
  const currency = safeThermalText(s.currency || 'EGP');
  const width = receiptWidthMm(s.receipt_width_mm || 80);
  const columns = isCompactThermalWidth(width) ? 32 : 42;
  const divider = '-'.repeat(isCompactThermalWidth(width) ? 32 : 42);
  const lines: string[] = [];
  const heading = (value: unknown) => (isAr ? safeThermalText(value) : thermalCenter(value, columns));
  const row = (label: string, value: unknown) => lines.push(`${label}: ${safeThermalText(value)}`);
  const moneyRow = (label: string, value: unknown) => {
    const amount = safeThermalText(value);
    lines.push(isAr ? `${label}: ${amount}` : thermalColumns(label, amount, columns));
  };

  const storeName = safeThermalText(s.store_name);
  if (storeName) lines.push(heading(storeName.toUpperCase()));
  lines.push(heading(receipt.isOpenOrder
    ? (isAr ? 'حساب مبدئي' : 'OPEN CHECK')
    : (isAr ? 'إيصال العميل' : 'CUSTOMER RECEIPT')));

  const branchName = safeThermalText(receipt.branchName);
  if (branchName) lines.push(heading(branchName));
  lines.push(divider);

  row(receipt.isOpenOrder ? (isAr ? 'الطلب' : 'Order') : (isAr ? 'الفاتورة' : 'Invoice'), receipt.invoice);
  row(isAr ? 'التاريخ' : 'Date', thermalDateTime(receipt.date));
  if (receipt.orderTypeLabel) row(isAr ? 'النوع' : 'Type', receipt.orderTypeLabel);
  if (receipt.orderNumber && receipt.orderNumber !== receipt.invoice) row(isAr ? 'الطلب' : 'Order', receipt.orderNumber);
  if (receipt.tableName) row(isAr ? 'الطاولة' : 'Table', receipt.tableName);
  if (receipt.guestCount) row(isAr ? 'الأفراد' : 'Guests', receipt.guestCount);
  if (receipt.customerName) row(isAr ? 'العميل' : 'Customer', receipt.customerName);
  if (receipt.operatorName) row(isAr ? 'المستخدم' : 'User', receipt.operatorName);

  lines.push(divider);
  lines.push(heading(isAr ? 'الأصناف' : 'ITEMS'));
  lines.push(divider);
  for (const item of receipt.items) {
    lines.push(safeThermalText(item.name));
    const qtyPrice = `${thermalNumber(item.qty, 3)} x ${thermalMoney(item.price, currency)}`;
    const itemTotal = thermalMoney(item.total, currency);
    lines.push(isAr ? `${qtyPrice} = ${itemTotal}` : thermalColumns(qtyPrice, itemTotal, columns));
  }

  lines.push(divider);
  moneyRow(isAr ? 'المجموع الفرعي' : 'SUBTOTAL', thermalMoney(receipt.subtotal, currency));
  if (receipt.discount > 0) moneyRow(isAr ? 'الخصم' : 'DISCOUNT', `-${thermalMoney(receipt.discount, currency)}`);
  if (s.receipt_show_tax !== false && receipt.tax > 0) moneyRow(isAr ? 'الضريبة' : 'TAX', thermalMoney(receipt.tax, currency));
  moneyRow(isAr ? 'الإجمالي' : 'TOTAL', thermalMoney(receipt.total, currency));

  if (!receipt.isOpenOrder) {
    const payments = (receipt.payments || []).filter((payment) => String(payment.method || '').trim());
    if (payments.length > 0) {
      lines.push(divider);
      lines.push(heading(isAr ? 'الدفع' : 'PAYMENT'));
      for (const payment of payments) {
        moneyRow(thermalPaymentLabel(payment.method, isAr), thermalMoney(payment.amount, currency));
      }
    }
    moneyRow(isAr ? 'المدفوع' : 'PAID', thermalMoney(receipt.paid, currency));
    if (receipt.change > 0) moneyRow(isAr ? 'الباقي' : 'CHANGE', thermalMoney(receipt.change, currency));
  }

  lines.push(divider);
  if (s.receipt_footer) lines.push(heading(s.receipt_footer));
  lines.push(heading(isAr ? 'شكراً لزيارتكم' : 'Thank you for visiting'));
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
            fixedFormHtml: queueSafeReceiptFormHtml(html),
            rendererVersion: 1,
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
  const currency = s.currency || 'EGP';
  const showTax = s.receipt_show_tax !== false;
  const showQr = s.receipt_show_qr !== false;
  const contentWidth = Math.max(46, width - (compact ? 4 : 6));
  const brand = safeThermalText(s.store_name || "JOHNA'S").toUpperCase();
  const title = receipt.isOpenOrder
    ? (isAr ? 'الحساب المفتوح' : 'OPEN CHECK')
    : (isAr ? 'إيصال العميل' : 'CUSTOMER RECEIPT');
  const tagline = isAr ? 'الأكل الجيد يجمع الناس' : 'Good Food Brings People Together';

  let qrImg = '';
  if (showQr) {
    try {
      qrImg = await generateQRCodeDataURL(
        JSON.stringify({ inv: receipt.invoice, total: receipt.total, date: receipt.date }),
      );
    } catch {
      qrImg = '';
    }
  }

  const metaRows: Array<[string, string, boolean]> = [
    [receipt.isOpenOrder ? (isAr ? 'رقم الطلب' : 'Order') : (isAr ? 'الفاتورة' : 'Invoice'), receipt.invoice, true],
    [isAr ? 'التاريخ' : 'Date', thermalDateTime(receipt.date), true],
  ];
  if (receipt.orderTypeLabel) metaRows.push([isAr ? 'النوع' : 'Type', receipt.orderTypeLabel, false]);
  if (receipt.orderNumber && receipt.orderNumber !== receipt.invoice) metaRows.push([isAr ? 'الطلب' : 'Order', receipt.orderNumber, true]);
  if (receipt.tableName) metaRows.push([isAr ? 'الطاولة' : 'Table', receipt.tableName, false]);
  if (receipt.guestCount) metaRows.push([isAr ? 'الأفراد' : 'Guests', String(receipt.guestCount), true]);
  if (receipt.customerName) metaRows.push([isAr ? 'العميل' : 'Customer', receipt.customerName, false]);
  if (receipt.operatorName) metaRows.push([isAr ? 'المستخدم' : 'User', receipt.operatorName, false]);

  const metaHtml = metaRows.map(([label, value, ltr]) => `
    <div class="meta-row">
      <div class="meta-label">${escapeHtml(label)}:</div>
      <div class="meta-value ${ltr ? 'ltr' : ''}">${escapeHtml(value)}</div>
    </div>`).join('');

  const itemRows = receipt.items.map((item) => `
    <div class="item-grid item-row">
      <div class="qty ltr">${escapeHtml(thermalNumber(item.qty, 3))}</div>
      <div class="item-name">${escapeHtml(item.name)}</div>
      <div class="price ltr">${escapeHtml(formatCurrency(item.total, currency, lang))}</div>
    </div>`).join('');

  const paymentRows = (receipt.payments || [])
    .filter((payment) => String(payment.method || '').trim())
    .map((payment) => `
      <div class="summary-row payment-row">
        <span>${escapeHtml(thermalPaymentLabel(payment.method, isAr))}</span>
        <strong class="ltr">${escapeHtml(formatCurrency(payment.amount, currency, lang))}</strong>
      </div>`)
    .join('');

  const storeInfo = [
    s.store_address ? escapeHtml(s.store_address) : '',
    s.store_phone ? `${isAr ? 'هاتف' : 'Tel'}: ${escapeHtml(s.store_phone)}` : '',
    receipt.branchName ? escapeHtml(receipt.branchName) : '',
    s.receipt_header ? escapeHtml(s.receipt_header) : '',
  ].filter(Boolean).map((line) => `<div class="store-line">${line}</div>`).join('');

  const single = `
    <main class="fixed-receipt">
      <header class="brand-block">
        <div class="brand">${escapeHtml(brand)}</div>
        <div class="restaurant">RESTAURANT</div>
      </header>

      <div class="title-band">
        <span></span><div class="document-title">${escapeHtml(title)}</div><span></span>
      </div>
      <div class="tagline">${escapeHtml(tagline)}</div>
      ${storeInfo ? `<div class="store-info">${storeInfo}</div>` : ''}

      <section class="meta-block">${metaHtml}</section>
      <div class="rule"></div>

      <section>
        <div class="section-title">${isAr ? 'الأصناف' : 'ITEMS'}</div>
        <div class="item-grid item-head">
          <div>${isAr ? 'الكمية' : 'QTY'}</div>
          <div>${isAr ? 'الصنف' : 'ITEM'}</div>
          <div class="end">${isAr ? 'السعر' : 'PRICE'}</div>
        </div>
        ${itemRows}
      </section>

      <div class="rule"></div>
      <section class="summary">
        <div class="summary-row"><span>${isAr ? 'المجموع الفرعي' : 'Subtotal'}:</span><strong class="ltr">${escapeHtml(formatCurrency(receipt.subtotal, currency, lang))}</strong></div>
        ${receipt.discount > 0 ? `<div class="summary-row"><span>${isAr ? 'الخصم' : 'Discount'}:</span><strong class="ltr">-${escapeHtml(formatCurrency(receipt.discount, currency, lang))}</strong></div>` : ''}
        ${showTax && receipt.tax > 0 ? `<div class="summary-row"><span>${isAr ? 'الضريبة' : 'Tax'}:</span><strong class="ltr">${escapeHtml(formatCurrency(receipt.tax, currency, lang))}</strong></div>` : ''}
        <div class="summary-row grand-total"><span>${isAr ? 'الإجمالي' : 'TOTAL'}:</span><strong class="ltr">${escapeHtml(formatCurrency(receipt.total, currency, lang))}</strong></div>
        ${!receipt.isOpenOrder && paymentRows ? `<div class="payment-block"><div class="mini-title">${isAr ? 'الدفع' : 'PAYMENT'}</div>${paymentRows}</div>` : ''}
        ${!receipt.isOpenOrder ? `<div class="summary-row paid-row"><span>${isAr ? 'المدفوع' : 'Paid'}:</span><strong class="ltr">${escapeHtml(formatCurrency(receipt.paid, currency, lang))}</strong></div>` : ''}
        ${!receipt.isOpenOrder && receipt.change > 0 ? `<div class="summary-row"><span>${isAr ? 'الباقي' : 'Change'}:</span><strong class="ltr">${escapeHtml(formatCurrency(receipt.change, currency, lang))}</strong></div>` : ''}
      </section>

      <div class="rule"></div>
      <footer>
        ${s.receipt_footer ? `<div class="configured-footer">${escapeHtml(s.receipt_footer)}</div>` : ''}
        <div>${isAr ? 'شكراً لزيارتكم' : 'Thank you for visiting.'}</div>
        <div>${isAr ? 'نراكم قريباً!' : 'Thank you!'}</div>
        <div class="footer-mark"><span></span><b>♥</b><span></span></div>
        ${qrImg ? `<img src="${qrImg}" class="receipt-qr" alt="QR" />` : ''}
      </footer>
    </main>`;

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
      font-family: "Arial Narrow", Tahoma, Arial, "Segoe UI", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body { overflow: visible; }
    .receipt-page {
      width: ${contentWidth}mm;
      margin: 0 auto;
      padding: ${compact ? 2.6 : 3.5}mm ${compact ? 2.2 : 3.2}mm ${compact ? 3.5 : 5}mm;
      page-break-after: always;
      break-after: page;
      background: #fff;
    }
    .receipt-page:last-child { page-break-after: auto; break-after: auto; }
    .brand-block { text-align: center; margin-bottom: ${compact ? 3 : 4.5}mm; }
    .brand {
      font-family: Arial, "Arial Black", Tahoma, sans-serif;
      font-size: ${compact ? 25 : 31}px;
      line-height: 1;
      font-weight: 900;
      letter-spacing: -1.2px;
      white-space: nowrap;
    }
    .restaurant {
      margin-top: 1.1mm;
      font-family: Arial, Tahoma, sans-serif;
      font-size: ${compact ? 9 : 11}px;
      line-height: 1;
      letter-spacing: ${compact ? 3 : 4.2}px;
      font-weight: 700;
      direction: ltr;
      unicode-bidi: isolate;
    }
    .title-band {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      gap: ${compact ? 2 : 3}mm;
      margin-top: ${compact ? 2 : 3}mm;
    }
    .title-band > span, .rule { border-top: .28mm solid #000; }
    .document-title {
      font-size: ${compact ? 17 : 21}px;
      line-height: 1;
      font-weight: 900;
      white-space: nowrap;
      text-align: center;
    }
    .tagline {
      margin-top: 1.2mm;
      text-align: center;
      font-size: ${compact ? 9 : 10.5}px;
      line-height: 1.2;
      font-weight: 500;
    }
    .store-info { margin-top: 1.5mm; text-align: center; }
    .store-line {
      margin: .3mm 0;
      font-size: ${compact ? 8.5 : 9.5}px;
      line-height: 1.2;
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .meta-block { margin: ${compact ? 3.2 : 4.2}mm 0 ${compact ? 3 : 4}mm; }
    .meta-row {
      display: grid;
      grid-template-columns: 30% minmax(0, 1fr);
      gap: 2mm;
      margin: ${compact ? .55 : .75}mm 0;
      font-size: ${compact ? 10.5 : 12}px;
      line-height: 1.25;
    }
    .meta-label { font-weight: 800; }
    .meta-value { font-weight: 600; overflow-wrap: anywhere; }
    .ltr { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
    .rule { width: 100%; margin: ${compact ? 2.2 : 3}mm 0; }
    .section-title {
      font-size: ${compact ? 18 : 21}px;
      line-height: 1;
      font-weight: 900;
      margin-bottom: ${compact ? 2 : 2.5}mm;
    }
    .item-grid {
      display: grid;
      grid-template-columns: ${compact ? '9mm minmax(0,1fr) 17mm' : '11mm minmax(0,1fr) 20mm'};
      column-gap: ${compact ? 1 : 1.6}mm;
      align-items: baseline;
    }
    .item-head {
      font-size: ${compact ? 9 : 10.5}px;
      line-height: 1.1;
      font-weight: 800;
      margin-bottom: ${compact ? 1.5 : 2}mm;
    }
    .end { text-align: end; }
    .item-row {
      padding: ${compact ? 1.3 : 1.7}mm 0;
      font-size: ${compact ? 11 : 12.5}px;
      line-height: 1.22;
      font-weight: 600;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .qty { text-align: center; }
    .item-name { font-weight: 700; overflow-wrap: anywhere; }
    .price { text-align: end; white-space: nowrap; font-weight: 700; }
    .summary-row {
      display: grid;
      grid-template-columns: minmax(0,1fr) auto;
      gap: 2mm;
      align-items: baseline;
      margin: ${compact ? .7 : .9}mm 0;
      font-size: ${compact ? 10.5 : 12}px;
      line-height: 1.2;
    }
    .summary-row strong { white-space: nowrap; }
    .grand-total {
      margin-top: ${compact ? 1.4 : 1.8}mm;
      font-size: ${compact ? 18 : 22}px;
      line-height: 1;
      font-weight: 900;
    }
    .payment-block { margin-top: 2mm; padding-top: 1.5mm; border-top: .2mm solid #777; }
    .mini-title { margin-bottom: 1mm; font-size: ${compact ? 9 : 10.5}px; font-weight: 900; letter-spacing: .4px; }
    .payment-row, .paid-row { font-size: ${compact ? 9 : 10.5}px; }
    footer {
      padding-top: ${compact ? 2.5 : 3.5}mm;
      text-align: center;
      font-size: ${compact ? 10 : 11.5}px;
      line-height: 1.35;
      font-weight: 500;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .configured-footer { margin-bottom: 1.1mm; white-space: pre-wrap; overflow-wrap: anywhere; }
    .footer-mark {
      display: grid;
      grid-template-columns: 12mm auto 12mm;
      justify-content: center;
      align-items: center;
      gap: 2mm;
      margin-top: 2mm;
    }
    .footer-mark span { width: 12mm; border-top: .25mm solid #000; }
    .footer-mark b { font-size: ${compact ? 11 : 13}px; line-height: 1; }
    .receipt-qr {
      display: block;
      width: ${compact ? 15 : 18}mm;
      height: ${compact ? 15 : 18}mm;
      margin: 2.5mm auto 0;
      image-rendering: pixelated;
    }
    @page { margin: 0; }
    @media print {
      html, body {
        width: ${width}mm !important;
        min-width: ${width}mm !important;
        max-width: ${width}mm !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #fff !important;
        color: #000 !important;
      }
      .receipt-page { width: ${contentWidth}mm !important; margin: 0 auto !important; }
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
