import type { Language, Settings } from '@/lib/types';
import { formatCurrency, escapeHtml } from '@/lib/format';
import { generateQRCodeDataURL } from '@/lib/barcode';
import { supabase } from '@/api';

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

type ApprovalRow = {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'consumed';
  expires_at: string;
};

const pendingReceiptPrints = new Map<string, ReceiptPrintAuthorization>();

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
 * non-mutating: the database must not count a print until the print path has
 * actually opened and the browser print dialog has run.
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

export function openPrintWindow(html: string, widthMm: number): boolean {
  const win = window.open('', '_blank', `width=${Math.min(500, widthMm + 140)},height=600`);
  if (!win) return false;

  const token = receiptPrintToken(html);
  const authorization = token ? pendingReceiptPrints.get(token) ?? null : null;
  if (token) pendingReceiptPrints.delete(token);

  win.document.write(html);
  win.document.close();

  // Kitchen/browser fallback tickets keep their embedded print script. Official
  // receipts carry an authorization token and are printed here so authorization
  // never mutates the database before the print path exists.
  if (!authorization) return true;

  const runReceiptPrint = async () => {
    if (win.closed) return;
    try {
      win.focus();
      win.print();
      // window.print() returns only after the print dialog closes. Persist the
      // print event afterwards; a blocked/missing window can never be recorded.
      await recordReceiptPrint(authorization);
      window.setTimeout(() => {
        if (!win.closed) win.close();
      }, 300);
    } catch (error) {
      console.error('[receipt-print] print record failed', error);
      if (!win.closed) {
        const message = error instanceof Error ? error.message : 'Receipt print could not be recorded';
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
  pendingReceiptPrints.set(printToken, authorization);
  window.setTimeout(() => pendingReceiptPrints.delete(printToken), 60_000);

  const width = Math.max(50, Math.min(100, s.receipt_width_mm || 80));
  const copies = Math.max(1, Math.min(5, s.receipt_copies || 1));
  const showTax = s.receipt_show_tax !== false;
  const showQr = s.receipt_show_qr !== false;
  const currency = s.currency || 'EGP';

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
    ${s.logo_url ? `<div class="center"><img src="${escapeHtml(s.logo_url)}" alt="logo" style="max-width:${Math.min(width, 120)}px;max-height:80px;display:block;margin:2px auto" /></div>` : ''}
    <div class="center header">${escapeHtml(s.store_name)}</div>
    ${s.store_address ? `<div class="center sub">${escapeHtml(s.store_address)}</div>` : ''}
    ${s.store_phone ? `<div class="center sub">${isAr ? 'هاتف' : 'Tel'}: ${escapeHtml(s.store_phone)}</div>` : ''}
    ${s.receipt_header ? `<div class="center sub">${escapeHtml(s.receipt_header)}</div>` : ''}
    <div class="center sub">${isAr ? 'الفرع' : 'Branch'}: ${escapeHtml(receipt.branchName)}</div>
    <div class="divider"></div>
    <div class="row"><span>${isAr ? 'الفاتورة' : 'Invoice'}: ${escapeHtml(receipt.invoice)}</span></div>
    <div class="row"><span>${isAr ? 'التاريخ' : 'Date'}: ${new Date(receipt.date).toLocaleString(isAr ? 'ar-SA' : 'en-US')}</span></div>
    ${receipt.orderTypeLabel ? `<div class="row"><span>${isAr ? 'النوع' : 'Type'}: ${escapeHtml(receipt.orderTypeLabel)}</span></div>` : ''}
    ${receipt.orderNumber ? `<div class="row"><span>${isAr ? 'الطلب' : 'Order'}: ${escapeHtml(receipt.orderNumber)}</span></div>` : ''}
    ${receipt.tableName ? `<div class="row"><span>${isAr ? 'طاولة' : 'Table'}: ${escapeHtml(receipt.tableName)}</span></div>` : ''}
    ${receipt.guestCount ? `<div class="row"><span>${isAr ? 'الضيوف' : 'Guests'}: ${receipt.guestCount}</span></div>` : ''}
    ${receipt.customerName ? `<div class="row"><span>${isAr ? 'العميل' : 'Customer'}: ${escapeHtml(receipt.customerName)}</span></div>` : ''}
    ${receipt.operatorName ? `<div class="row"><span>${isAr ? 'المستخدم' : 'User'}: ${escapeHtml(receipt.operatorName)}</span></div>` : ''}
    <div class="divider"></div>
    ${receipt.items.map((i) => `<div class="item-row"><div class="item-name">${escapeHtml(i.name)}</div><div class="row item-detail"><span>${i.qty} x ${formatCurrency(i.price, currency, lang)}</span><span>${formatCurrency(i.total, currency, lang)}</span></div></div>`).join('')}
    <div class="divider"></div>
    <div class="row"><span>${isAr ? 'المجموع الفرعي' : 'Subtotal'}</span><span>${formatCurrency(receipt.subtotal, currency, lang)}</span></div>
    ${receipt.discount > 0 ? `<div class="row"><span>${isAr ? 'الخصم' : 'Discount'}</span><span>-${formatCurrency(receipt.discount, currency, lang)}</span></div>` : ''}
    ${showTax && receipt.tax > 0 ? `<div class="row"><span>${isAr ? 'الضريبة' : 'Tax'} (${escapeHtml(s.tax_rate ?? 0)}%)</span><span>${formatCurrency(receipt.tax, currency, lang)}</span></div>` : ''}
    <div class="divider"></div>
    <div class="row total-row"><span>${isAr ? 'الإجمالي' : 'Total'}</span><span>${formatCurrency(receipt.total, currency, lang)}</span></div>
    <div class="row"><span>${isAr ? 'المدفوع' : 'Paid'}</span><span>${formatCurrency(receipt.paid, currency, lang)}</span></div>
    ${receipt.change > 0 ? `<div class="row"><span>${isAr ? 'الباقي' : 'Change'}:</span><span>${formatCurrency(receipt.change, currency, lang)}</span></div>` : ''}
    ${qrImg ? `<div class="center" style="margin-top:6px"><img src="${qrImg}" width="${Math.round(width / 2.2)}" style="display:block;margin:0 auto" /></div>` : ''}
    <div class="divider"></div>
    ${s.receipt_footer ? `<div class="footer">${escapeHtml(s.receipt_footer)}</div>` : ''}
    <div class="footer">${isAr ? 'شكراً لزيارتكم' : 'Thank you!'}</div>`;

  const pages = Array.from({ length: copies }, () => `<div class="page">${single}</div>`).join('\n');
  return `<!DOCTYPE html>
    <html dir="${isAr ? 'rtl' : 'ltr'}">
    <head><title>${escapeHtml(receipt.invoice)}</title>
    <meta name="johns-print-auth" content="${escapeHtml(printToken)}">
    <style>
      * { font-family: 'Courier New', monospace; margin: 0; padding: 0; box-sizing: border-box; }
      body { width: ${width}mm; padding: 4mm; font-size: 12px; color: #000; }
      .page { page-break-after: always; }
      .page:last-child { page-break-after: auto; }
      .center { text-align: center; }
      .bold { font-weight: bold; }
      .header { font-size: 14px; font-weight: bold; margin-bottom: 4px; }
      .sub { font-size: 10px; margin-bottom: 8px; }
      .divider { border-top: 1px dashed #000; margin: 6px 0; }
      .row { display: flex; justify-content: space-between; margin: 2px 0; }
      .item-row { margin: 4px 0; }
      .item-name { font-weight: bold; }
      .item-detail { font-size: 11px; }
      .total-row { font-size: 14px; font-weight: bold; }
      .footer { margin-top: 10px; text-align: center; font-size: 10px; }
    </style></head>
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