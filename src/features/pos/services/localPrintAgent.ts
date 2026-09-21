import type { KitchenSendItem } from '../types';

export const PRINT_AGENT_URL = 'http://127.0.0.1:17654';
const PRINT_TIMEOUT_MS = 1800;
const STORAGE_ROUTING_KEY = 'johns_pos_printer_routes';
const STORAGE_DRAWER_KICK_KEY = 'johns_pos_auto_drawer_kick';
const STORAGE_SILENT_PRINT_KEY = 'johns_pos_silent_print_enabled';

export interface PrinterRouteConfig {
  [stationCode: string]: string;
}

export interface LocalKitchenPrintContext {
  orderNumber?: string | null;
  tableName?: string | null;
  orderType?: string | null;
  guestCount?: number | null;
  isAr: boolean;
}

export interface DetectedPrinter {
  name: string;
  displayName?: string;
  isDefault?: boolean;
  status?: number;
}

export interface SilentPrintResult {
  success: boolean;
  error?: string;
}

export interface FixedThermalTemplateItem {
  qty: string;
  name: string;
  price?: string;
  total?: string;
  modifiers?: string[];
  notes?: string;
}

export interface FixedThermalTemplateRow {
  label: string;
  value: string;
  emphasis?: boolean;
}

export interface FixedThermalTemplate {
  version: 1;
  kind: 'customer' | 'kitchen';
  isAr: boolean;
  paperWidthMm: number;
  storeName: string;
  storeSubtitle: string;
  title: string;
  subtitle?: string;
  slogan?: string;
  branchName?: string;
  station?: string;
  meta: FixedThermalTemplateRow[];
  itemsHeading: string;
  items: FixedThermalTemplateItem[];
  totals?: FixedThermalTemplateRow[];
  footerLines?: string[];
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      getPrinters: () => Promise<Array<{ name: string; displayName?: string; isDefault?: boolean; status?: number }>>;
      printSilent: (options: { html?: string; text?: string; printerName: string; copies?: number; paperWidthMm?: number }) => Promise<{ success: boolean; error?: string }>;
      kickDrawer: (printerName?: string) => Promise<{ success: boolean; error?: string }>;
      getSystemInfo: () => Promise<{ isElectron: boolean; platform: string; hostname: string }>;
    };
  }
}

function safeText(value: unknown): string {
  return Array.from(String(value ?? ''))
    .filter((ch) => ch === '\n' || ch === '\r' || ch === '\t' || ch >= ' ')
    .join('')
    .trim();
}

function escapeTemplateHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function buildFixedThermalTemplateHtml(template: FixedThermalTemplate): string {
  const ar = Boolean(template.isAr);
  const kitchen = template.kind === 'kitchen';
  const dir = ar ? 'rtl' : 'ltr';
  const e = escapeTemplateHtml;
  const meta = Array.isArray(template.meta) ? template.meta : [];
  const items = Array.isArray(template.items) ? template.items : [];
  const totals = Array.isArray(template.totals) ? template.totals : [];
  const footerLines = Array.isArray(template.footerLines) ? template.footerLines : [];

  const metaRows = [
    ...(kitchen && template.station
      ? [{ label: ar ? 'المحطة' : 'Station', value: template.station, emphasis: true }]
      : []),
    ...meta,
  ].map((row) => `
    <div class="meta-row ${row.emphasis ? 'emphasis' : ''}">
      <div class="meta-label">${e(row.label)}:</div>
      <div class="meta-value">${e(row.value)}</div>
    </div>`).join('');

  const customerItems = items.map((item) => `
    <div class="item-row customer-item">
      <div class="qty">${e(item.qty)}</div>
      <div class="item-name">${e(item.name)}</div>
      <div class="price">${e(item.total || item.price || '')}</div>
    </div>`).join('');

  const kitchenItems = items.map((item) => {
    const modifiers = (item.modifiers || [])
      .map((modifier) => `<div class="modifier">+ ${e(modifier)}</div>`)
      .join('');
    const note = item.notes
      ? `<div class="note">${ar ? 'ملاحظة' : 'Note'}: ${e(item.notes)}</div>`
      : '';
    return `
      <div class="kitchen-item">
        <div class="kitchen-main"><span class="qty">${e(item.qty)}</span><span class="item-name">${e(item.name)}</span></div>
        ${modifiers}
        ${note}
      </div>`;
  }).join('');

  const totalRows = totals.map((row) => `
    <div class="total-row ${row.emphasis ? 'grand-total' : ''}">
      <span>${e(row.label)}:</span>
      <span>${e(row.value)}</span>
    </div>`).join('');

  const footer = footerLines.map((line, index) => `
    <div class="footer-line ${kitchen && index === 0 ? 'kitchen-end' : ''}">${e(line)}</div>`
  ).join('');

  const width = Number(template.paperWidthMm || 80);
  return `<!doctype html>
<html lang="${ar ? 'ar' : 'en'}" dir="${dir}">
<head>
<meta charset="utf-8">
<style>
  @page { size: ${width}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body {
    width: ${width}mm;
    min-width: ${width}mm;
    max-width: ${width}mm;
    margin: 0;
    padding: 0;
    background: #fff;
    color: #000;
    font-family: "Arial Narrow", "Segoe UI", Tahoma, Arial, sans-serif;
    direction: ${dir};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .receipt {
    width: 100%;
    padding: ${kitchen ? '3.4mm 4mm 3.2mm' : '4.8mm 5mm 4.2mm'};
    font-size: ${kitchen ? '11pt' : '12pt'};
    line-height: 1.26;
  }
  .brand {
    text-align: center;
    font-family: Arial, "Segoe UI", sans-serif;
    font-size: ${kitchen ? '26pt' : '30pt'};
    line-height: 1;
    font-weight: 900;
    letter-spacing: -.5px;
    margin: 0 0 1.2mm;
  }
  .brand-sub {
    text-align: center;
    font-family: Arial, "Segoe UI", sans-serif;
    font-size: ${kitchen ? '8.5pt' : '9.5pt'};
    font-weight: 600;
    letter-spacing: 3.2px;
    margin-bottom: ${kitchen ? '3mm' : '4mm'};
  }
  .title-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 2.2mm;
    align-items: center;
    margin-bottom: ${kitchen ? '1.2mm' : '1.6mm'};
  }
  .title-rule { height: .25mm; background: #111; }
  .title {
    font-size: ${kitchen ? '16.5pt' : '18pt'};
    font-weight: 900;
    white-space: nowrap;
    text-align: center;
  }
  .subtitle, .slogan, .branch {
    text-align: center;
    font-size: ${kitchen ? '9.5pt' : '10.5pt'};
    margin-top: .8mm;
  }
  .subtitle { font-weight: 700; letter-spacing: 2px; }
  .slogan { font-weight: 500; }
  .branch { font-weight: 600; }
  .meta {
    margin-top: ${kitchen ? '3mm' : '5mm'};
    margin-bottom: ${kitchen ? '3mm' : '4mm'};
  }
  .meta-row {
    display: grid;
    grid-template-columns: ${ar ? '1fr 23mm' : '23mm 1fr'};
    gap: 2mm;
    align-items: baseline;
    margin: .75mm 0;
    min-height: ${kitchen ? '5.2mm' : '5.6mm'};
  }
  .meta-label { font-weight: 700; ${ar ? 'grid-column:2;text-align:right' : 'text-align:left'}; }
  .meta-value { font-weight: 500; overflow-wrap: anywhere; ${ar ? 'grid-column:1;grid-row:1;text-align:right' : 'text-align:left'}; }
  .meta-row.emphasis .meta-label, .meta-row.emphasis .meta-value { font-weight: 800; }
  .section {
    border-top: .25mm solid #111;
    padding-top: ${kitchen ? '2.5mm' : '3.2mm'};
    margin-top: ${kitchen ? '2mm' : '2.5mm'};
  }
  .items-title {
    font-size: ${kitchen ? '16.5pt' : '18pt'};
    font-weight: 900;
    margin-bottom: ${kitchen ? '2mm' : '2.5mm'};
  }
  .items-head, .customer-item {
    display: grid;
    grid-template-columns: 11mm 1fr 21mm;
    gap: 1.5mm;
    align-items: baseline;
  }
  .items-head { font-size: 10pt; font-weight: 800; margin-bottom: 1.8mm; }
  .items-head .price, .customer-item .price { text-align: ${ar ? 'left' : 'right'}; }
  .items-head .qty, .customer-item .qty { text-align: center; }
  .customer-item { min-height: 9.5mm; padding: 1.5mm 0; font-size: 12.5pt; }
  .customer-item .item-name { font-weight: 600; overflow-wrap: anywhere; }
  .customer-item .price { font-weight: 700; white-space: nowrap; }
  .kitchen-item { padding: 1.4mm 0; border-bottom: .15mm solid #b8b8b8; }
  .kitchen-item:last-child { border-bottom: 0; }
  .kitchen-main {
    display: grid;
    grid-template-columns: 10mm 1fr;
    gap: 2mm;
    font-size: 14pt;
    font-weight: 900;
    align-items: baseline;
  }
  .kitchen-main .qty { text-align: center; }
  .modifier, .note {
    margin-top: .8mm;
    ${ar ? 'padding-right:12mm' : 'padding-left:12mm'};
    font-size: 12pt;
    line-height: 1.24;
  }
  .modifier { font-weight: 700; }
  .note { font-weight: 800; }
  .totals {
    border-top: .25mm solid #111;
    border-bottom: .25mm solid #111;
    margin-top: 3mm;
    padding: 2.4mm 0 2mm;
  }
  .total-row {
    display: flex;
    justify-content: space-between;
    gap: 2mm;
    margin: 1mm 0;
    font-size: 10.5pt;
  }
  .grand-total { font-size: 18pt; font-weight: 900; margin-top: 1.8mm; }
  .footer { text-align: center; margin-top: ${kitchen ? '3mm' : '5mm'}; }
  .footer-line { font-size: ${kitchen ? '11.5pt' : '12pt'}; margin: 1mm 0; }
  .kitchen-end { font-size: 13.5pt; font-weight: 900; margin-top: 1.2mm; }
  .heart { font-size: 16pt; line-height: 1; margin-top: 2mm; }
</style>
</head>
<body>
  <main class="receipt">
    <div class="brand">${e(template.storeName || "JOHNA'S")}</div>
    <div class="brand-sub">${e(template.storeSubtitle || 'RESTAURANT')}</div>
    <div class="title-row"><div class="title-rule"></div><div class="title">${e(template.title)}</div><div class="title-rule"></div></div>
    ${template.subtitle ? `<div class="subtitle">${e(template.subtitle)}</div>` : ''}
    ${template.slogan ? `<div class="slogan">${e(template.slogan)}</div>` : ''}
    ${template.branchName ? `<div class="branch">${e(template.branchName)}</div>` : ''}
    <section class="meta">${metaRows}</section>
    <section class="section">
      <div class="items-title">${e(template.itemsHeading)}</div>
      ${kitchen
        ? kitchenItems
        : `<div class="items-head"><div class="qty">${ar ? 'الكمية' : 'QTY'}</div><div>${ar ? 'الصنف' : 'ITEM'}</div><div class="price">${ar ? 'السعر' : 'PRICE'}</div></div>${customerItems}`}
    </section>
    ${!kitchen && totals.length ? `<section class="totals">${totalRows}</section>` : ''}
    <footer class="footer">${footer}${!kitchen ? '<div class="heart">♥</div>' : ''}</footer>
  </main>
</body>
</html>`;
}

function htmlToThermalText(html: string): string {
  if (typeof window === 'undefined' || !html.trim()) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style,script,noscript,svg').forEach((node) => node.remove());
    return safeText(doc.body?.innerText || doc.body?.textContent || '')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return '';
  }
}

function modifierNames(item: KitchenSendItem, isAr: boolean): string[] {
  return (item.modifiers || [])
    .map((m) => safeText(isAr ? (m.option_name || m.option_name_en) : (m.option_name_en || m.option_name)))
    .filter(Boolean);
}

function kitchenOrderTypeLabel(value: unknown, isAr: boolean): string {
  const key = safeText(value).toLowerCase().replace(/[ -]+/g, '_');
  const labels: Record<string, [string, string]> = {
    dine_in: ['داخل الصالة', 'Dine In'],
    takeaway: ['تيك أواي', 'Take Away'],
    take_away: ['تيك أواي', 'Take Away'],
    drive_thru: ['درايف ثرو', 'Drive Thru'],
    delivery: ['توصيل', 'Delivery'],
    quick_order: ['طلب سريع', 'Quick Order'],
  };
  const label = labels[key];
  return label ? (isAr ? label[0] : label[1]) : safeText(value);
}

function kitchenTime(isAr: boolean): string {
  return new Intl.DateTimeFormat(isAr ? 'ar-EG' : 'en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

function kitchenDateTime(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

function readBoolean(key: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined') return defaultValue;
  const value = window.localStorage.getItem(key);
  if (value == null) return defaultValue;
  return value === 'true';
}

function writeBoolean(key: string, enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, enabled ? 'true' : 'false');
}

export function getLocalPrinterRoutes(): PrinterRouteConfig {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_ROUTING_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([station, printer]) => [safeText(station), safeText(printer)] as const)
        .filter(([station, printer]) => Boolean(station && printer)),
    );
  } catch {
    return {};
  }
}

export function saveLocalPrinterRoutes(routes: PrinterRouteConfig): void {
  if (typeof window === 'undefined') return;
  const normalized = Object.fromEntries(
    Object.entries(routes)
      .map(([station, printer]) => [safeText(station), safeText(printer)] as const)
      .filter(([station, printer]) => Boolean(station && printer)),
  );
  window.localStorage.setItem(STORAGE_ROUTING_KEY, JSON.stringify(normalized));
}

export async function applyLocalPrinterRoutes(routes: PrinterRouteConfig): Promise<boolean> {
  saveLocalPrinterRoutes(routes);
  if (typeof window === 'undefined') return false;
  if (isRunningInElectron()) return true;

  try {
    const health = await fetchWithTimeout(`${PRINT_AGENT_URL}/health`);
    if (!health.ok) return false;
    const response = await fetchWithTimeout(`${PRINT_AGENT_URL}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ routes }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function isAutoDrawerKickEnabled(): boolean {
  return readBoolean(STORAGE_DRAWER_KICK_KEY, true);
}

export function setAutoDrawerKick(enabled: boolean): void {
  writeBoolean(STORAGE_DRAWER_KICK_KEY, enabled);
}

export function isSilentPrintEnabled(): boolean {
  return readBoolean(STORAGE_SILENT_PRINT_KEY, true);
}

export function setSilentPrintEnabled(enabled: boolean): void {
  writeBoolean(STORAGE_SILENT_PRINT_KEY, enabled);
}

export function isRunningInElectron(): boolean {
  return typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
}

export function groupKitchenItemsByStation(items: KitchenSendItem[]): Record<string, KitchenSendItem[]> {
  const groups: Record<string, KitchenSendItem[]> = {};
  for (const item of items) {
    const station = safeText(item.station_code);
    if (!station) continue;
    (groups[station] ||= []).push(item);
  }
  return groups;
}

export function buildKitchenFixedTemplate(
  station: string,
  items: KitchenSendItem[],
  ctx: LocalKitchenPrintContext,
  paperWidthMm = 80,
): FixedThermalTemplate {
  const ar = ctx.isAr;
  const meta: FixedThermalTemplateRow[] = [];
  if (ctx.orderNumber) meta.push({ label: ar ? 'رقم الطلب' : 'Order', value: safeText(ctx.orderNumber), emphasis: true });
  meta.push({ label: ar ? 'التاريخ' : 'Date', value: kitchenDateTime() });
  if (ctx.orderType) meta.push({ label: ar ? 'النوع' : 'Type', value: kitchenOrderTypeLabel(ctx.orderType, ar) });
  if (ctx.tableName) meta.push({ label: ar ? 'الطاولة' : 'Table', value: safeText(ctx.tableName), emphasis: true });
  if (ctx.guestCount) meta.push({ label: ar ? 'عدد الأفراد' : 'Guests', value: String(ctx.guestCount) });

  return {
    version: 1,
    kind: 'kitchen',
    isAr: ar,
    paperWidthMm: Number(paperWidthMm || 80),
    storeName: "JOHNA'S",
    storeSubtitle: 'RESTAURANT',
    title: ar ? 'تذكرة المطبخ' : 'KITCHEN TICKET',
    subtitle: ar ? 'نسخة المطبخ' : 'KITCHEN COPY',
    station: safeText(station),
    meta,
    itemsHeading: ar ? 'الأصناف' : 'ITEMS',
    items: items.map((item) => ({
      qty: String(Number(item.quantity || 0)),
      name: safeText(item.product_name || '—'),
      modifiers: modifierNames(item, ar),
      notes: item.notes?.trim() ? safeText(item.notes) : undefined,
    })),
    footerLines: [ar ? 'نهاية الطلب' : 'END OF ORDER'],
  };
}

export function buildStationTicketText(
  station: string,
  items: KitchenSendItem[],
  ctx: LocalKitchenPrintContext,
): string {
  const ar = ctx.isAr;
  const divider = '--------------------------------';
  const lines: string[] = [];

  lines.push(ar ? 'تذكرة المطبخ' : 'KITCHEN TICKET');
  lines.push(ar ? 'المحطة' : 'STATION');
  lines.push(safeText(station));
  lines.push(divider);

  if (ctx.orderNumber) lines.push(`${ar ? 'الطلب' : 'Order'}: ${safeText(ctx.orderNumber)}`);
  if (ctx.tableName) lines.push(`${ar ? 'الطاولة' : 'Table'}: ${safeText(ctx.tableName)}`);
  if (ctx.orderType) lines.push(`${ar ? 'النوع' : 'Type'}: ${kitchenOrderTypeLabel(ctx.orderType, ar)}`);
  lines.push(`${ar ? 'الوقت' : 'Time'}: ${kitchenTime(ar)}`);
  if (ctx.guestCount) lines.push(`${ar ? 'الأفراد' : 'Guests'}: ${ctx.guestCount}`);

  lines.push(divider);
  lines.push(ar ? 'الأصناف' : 'ITEMS');

  for (const item of items) {
    const qty = Number(item.quantity || 0);
    lines.push(`${qty} x ${safeText(item.product_name || '—')}`);
    for (const modifier of modifierNames(item, ar)) {
      lines.push(`+ ${modifier}`);
    }
    if (item.notes?.trim()) {
      lines.push(`${ar ? 'ملاحظة' : 'Note'}: ${safeText(item.notes)}`);
    }
  }

  lines.push(divider);
  lines.push('');
  return lines.join('\r\n');
}

async function fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), PRINT_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    window.clearTimeout(timer);
  }
}

export async function getAvailablePrinters(): Promise<DetectedPrinter[]> {
  if (typeof window === 'undefined') return [];

  if (isRunningInElectron() && window.electronAPI) {
    try {
      const printers = await window.electronAPI.getPrinters();
      if (Array.isArray(printers)) {
        return printers
          .filter((printer) => safeText(printer.name))
          .map((printer) => ({
            name: safeText(printer.name),
            displayName: safeText(printer.displayName || printer.name),
            isDefault: Boolean(printer.isDefault),
            status: printer.status,
          }));
      }
    } catch {
      // Fall through to the existing Windows local agent.
    }
  }

  try {
    const response = await fetchWithTimeout(`${PRINT_AGENT_URL}/printers`);
    if (!response.ok) return [];
    const data = await response.json() as { printers?: Array<string | { name?: string; displayName?: string; isDefault?: boolean; status?: number }> };
    const detected: DetectedPrinter[] = [];
    for (const [index, printer] of (data.printers || []).entries()) {
      if (typeof printer === 'string') {
        const name = safeText(printer);
        if (name) detected.push({ name, displayName: name, isDefault: index === 0 });
        continue;
      }
      const name = safeText(printer?.name);
      if (!name) continue;
      detected.push({
        name,
        displayName: safeText(printer.displayName || name),
        isDefault: Boolean(printer.isDefault),
        status: printer.status,
      });
    }
    return detected;
  } catch {
    return [];
  }
}

export async function executeSilentPrintDetailed(options: {
  printerName: string;
  text?: string;
  html?: string;
  template?: FixedThermalTemplate;
  copies?: number;
  paperWidthMm?: number;
}): Promise<SilentPrintResult> {
  if (typeof window === 'undefined') return { success: false, error: 'WINDOW_UNAVAILABLE' };
  const printerName = safeText(options.printerName);
  if (!printerName) return { success: false, error: 'PRINTER_NAME_REQUIRED' };

  if (isRunningInElectron() && window.electronAPI) {
    try {
      const templateHtml = options.template ? buildFixedThermalTemplateHtml(options.template) : '';
      const result = await window.electronAPI.printSilent({
        printerName,
        text: templateHtml ? undefined : options.text,
        html: templateHtml || options.html,
        copies: Math.max(1, Math.min(5, Number(options.copies || 1))),
        paperWidthMm: Number(options.paperWidthMm || 80),
      });
      return result?.success
        ? { success: true }
        : { success: false, error: safeText(result?.error) || 'PRINT_FAILED' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'PRINT_ERROR' };
    }
  }

  try {
    const response = await fetchWithTimeout(`${PRINT_AGENT_URL}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        station: 'custom',
        printer: printerName,
        text: options.text || (options.html ? htmlToThermalText(options.html) : ''),
        template: options.template,
      }),
    });
    if (!response.ok) return { success: false, error: `LOCAL_AGENT_HTTP_${response.status}` };
    const result = await response.json() as { success?: boolean; error?: string };
    return result.success
      ? { success: true }
      : { success: false, error: safeText(result.error) || 'PRINT_FAILED' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LOCAL_AGENT_ERROR';
    return { success: false, error: message || 'LOCAL_AGENT_ERROR' };
  }
}

export async function executeSilentPrint(options: {
  printerName: string;
  text?: string;
  html?: string;
  template?: FixedThermalTemplate;
  copies?: number;
  paperWidthMm?: number;
}): Promise<boolean> {
  return (await executeSilentPrintDetailed(options)).success;
}

export async function executeCashDrawerKick(printerName?: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const routes = getLocalPrinterRoutes();
  const targetPrinter = safeText(printerName || routes.cashier || routes.receipt || routes.main);
  if (!targetPrinter) return false;

  if (isRunningInElectron() && window.electronAPI) {
    try {
      const result = await window.electronAPI.kickDrawer(targetPrinter);
      return Boolean(result?.success);
    } catch {
      return false;
    }
  }

  try {
    const response = await fetchWithTimeout(`${PRINT_AGENT_URL}/drawer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ printer: targetPrinter }),
    });
    if (!response.ok) return false;
    const result = await response.json() as { success?: boolean };
    return Boolean(result.success);
  } catch {
    return false;
  }
}

export async function printKitchenStationsLocally(
  items: KitchenSendItem[],
  ctx: LocalKitchenPrintContext,
): Promise<boolean> {
  if (typeof window === 'undefined' || items.length === 0) return false;
  if (!isSilentPrintEnabled()) return false;
  if (items.some((item) => !safeText(item.station_code))) return false;

  const groups = groupKitchenItemsByStation(items);
  const stations = Object.keys(groups);
  if (stations.length === 0) return false;

  if (isRunningInElectron()) {
    const routes = getLocalPrinterRoutes();
    if (stations.some((station) => !safeText(routes[station]))) return false;
    const results = await Promise.all(Object.entries(groups).map(([station, stationItems]) => executeSilentPrint({
      printerName: routes[station],
      text: buildStationTicketText(station, stationItems, ctx),
      template: buildKitchenFixedTemplate(station, stationItems, ctx),
    })));
    return results.every(Boolean);
  }

  try {
    const health = await fetchWithTimeout(`${PRINT_AGENT_URL}/health`);
    if (!health.ok) return false;
    const configResponse = await fetchWithTimeout(`${PRINT_AGENT_URL}/config`);
    if (!configResponse.ok) return false;
    const config = await configResponse.json() as { routes?: Record<string, string> };
    const routes = config.routes || {};
    if (stations.some((station) => !safeText(routes[station]))) return false;

    const results = await Promise.all(Object.entries(groups).map(async ([station, stationItems]) => {
      try {
        const response = await fetchWithTimeout(`${PRINT_AGENT_URL}/print`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            station,
            text: buildStationTicketText(station, stationItems, ctx),
            template: buildKitchenFixedTemplate(station, stationItems, ctx),
          }),
        });
        if (!response.ok) return false;
        const result = await response.json() as { success?: boolean };
        return Boolean(result.success);
      } catch {
        return false;
      }
    }));
    return results.every(Boolean);
  } catch {
    return false;
  }
}

export function suppressNextKitchenBrowserPopup(): void {
  if (typeof window === 'undefined') return;
  const original = window.open;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    window.open = original;
  };
  window.open = (() => {
    restore();
    return null;
  }) as typeof window.open;
  window.setTimeout(restore, 1200);
}
