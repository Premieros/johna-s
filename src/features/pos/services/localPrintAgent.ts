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

function escapeFixedFormHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function buildStationTicketHtml(
  station: string,
  items: KitchenSendItem[],
  ctx: LocalKitchenPrintContext,
  paperWidthMm = 80,
): string {
  const width = Number(paperWidthMm) <= 60 ? 58 : 80;
  const compact = width === 58;
  const ar = ctx.isAr;
  const typeLabel = ctx.orderType ? kitchenOrderTypeLabel(ctx.orderType, ar) : '';
  const time = kitchenTime(ar);
  const estimatedItemMm = items.reduce((sum, item) => {
    const modifiers = modifierNames(item, ar).length;
    const hasNote = Boolean(item.notes?.trim());
    return sum + (compact ? 7 : 8.5) + modifiers * (compact ? 3.2 : 3.6) + (hasNote ? (compact ? 5 : 5.5) : 0);
  }, 0);
  const pageHeightMm = Math.max(compact ? 55 : 62, Math.ceil((compact ? 42 : 48) + estimatedItemMm));

  const rows = items.map((item) => {
    const qty = Number(item.quantity || 0);
    const modifiers = modifierNames(item, ar)
      .map((modifier) => `<div class="modifier">+ ${escapeFixedFormHtml(modifier)}</div>`)
      .join('');
    const note = item.notes?.trim()
      ? `<div class="note"><strong>${ar ? 'ملاحظة' : 'NOTE'}:</strong> ${escapeFixedFormHtml(item.notes.trim())}</div>`
      : '';
    return `
      <section class="k-item">
        <div class="k-item-line">
          <div class="k-qty ltr">${escapeFixedFormHtml(qty)}</div>
          <div class="k-name">${escapeFixedFormHtml(item.product_name || '—')}</div>
        </div>
        ${modifiers}
        ${note}
      </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${ar ? 'ar' : 'en'}" dir="${ar ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${ar ? 'تذكرة المطبخ' : 'KITCHEN TICKET'}</title>
  <style>
    :root { color-scheme: light only; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      width: ${width}mm; min-width: ${width}mm; max-width: ${width}mm;
      background: #fff; color: #000;
      font-family: "Arial Narrow", Tahoma, Arial, "Segoe UI", sans-serif;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .ticket {
      width: ${width}mm;
      padding: ${compact ? 2.5 : 3.2}mm ${compact ? 2.4 : 3}mm ${compact ? 2.8 : 3.5}mm;
      background: #fff;
    }
    .brand { text-align: center; margin-bottom: ${compact ? 2.4 : 3}mm; }
    .brand-name {
      font-family: Arial, "Arial Black", Tahoma, sans-serif;
      font-size: ${compact ? 24 : 29}px;
      line-height: 1; font-weight: 900; letter-spacing: -1px; white-space: nowrap;
    }
    .restaurant {
      margin-top: .9mm; font-family: Arial, Tahoma, sans-serif;
      font-size: ${compact ? 8.5 : 10}px; line-height: 1;
      letter-spacing: ${compact ? 2.8 : 3.8}px; font-weight: 700;
      direction: ltr; unicode-bidi: isolate;
    }
    .title-band {
      display: grid; grid-template-columns: 1fr auto 1fr; align-items: center;
      gap: ${compact ? 1.7 : 2.5}mm; margin-top: ${compact ? 1.4 : 2}mm;
    }
    .title-band span, .rule { border-top: .28mm solid #000; }
    .ticket-title {
      font-size: ${compact ? 16 : 19}px; line-height: 1; font-weight: 900;
      white-space: nowrap; text-align: center;
    }
    .copy-label {
      margin-top: .9mm; text-align: center;
      font-size: ${compact ? 8.5 : 10}px; line-height: 1;
      font-weight: 800; letter-spacing: ${compact ? 1.7 : 2.3}px;
    }
    .meta { margin: ${compact ? 2.5 : 3.2}mm 0 ${compact ? 2 : 2.6}mm; }
    .meta-row {
      display: grid; grid-template-columns: ${compact ? '29%' : '30%'} minmax(0,1fr);
      gap: 1.7mm; margin: ${compact ? .45 : .6}mm 0;
      font-size: ${compact ? 10.5 : 12}px; line-height: 1.2;
    }
    .meta-label { font-weight: 800; }
    .meta-value { font-weight: 650; overflow-wrap: anywhere; }
    .ltr { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
    .rule { width: 100%; margin: ${compact ? 1.8 : 2.4}mm 0; }
    .items-title {
      font-size: ${compact ? 17 : 20}px; line-height: 1; font-weight: 900;
      margin-bottom: ${compact ? 1.4 : 1.8}mm;
    }
    .columns {
      display: grid; grid-template-columns: ${compact ? '9mm minmax(0,1fr)' : '11mm minmax(0,1fr)'};
      gap: 1.2mm; margin-bottom: ${compact ? .9 : 1.2}mm;
      font-size: ${compact ? 8.5 : 10}px; font-weight: 800;
    }
    .k-item {
      padding: ${compact ? .9 : 1.2}mm 0;
      break-inside: avoid; page-break-inside: avoid;
    }
    .k-item-line {
      display: grid; grid-template-columns: ${compact ? '9mm minmax(0,1fr)' : '11mm minmax(0,1fr)'};
      gap: 1.2mm; align-items: baseline;
    }
    .k-qty {
      text-align: center; font-size: ${compact ? 14 : 17}px; line-height: 1;
      font-weight: 900;
    }
    .k-name {
      font-size: ${compact ? 14 : 17}px; line-height: 1.1;
      font-weight: 900; overflow-wrap: anywhere;
    }
    .modifier {
      margin-top: .55mm;
      padding-inline-start: ${compact ? 10.2 : 12.2}mm;
      font-size: ${compact ? 10 : 11.5}px; line-height: 1.15; font-weight: 700;
      overflow-wrap: anywhere;
    }
    .note {
      margin: ${compact ? .7 : .9}mm 0 0 ${ar ? '0' : (compact ? '10.2mm' : '12.2mm')};
      ${ar ? `margin-right:${compact ? '10.2mm' : '12.2mm'};` : ''}
      padding: ${compact ? .7 : .9}mm;
      border: .25mm solid #000;
      font-size: ${compact ? 9.5 : 11}px; line-height: 1.2; font-weight: 700;
      overflow-wrap: anywhere;
    }
    .end {
      margin-top: ${compact ? 2.2 : 3}mm;
      text-align: center; font-size: ${compact ? 12 : 14}px; line-height: 1;
      font-weight: 900;
    }
    .end-mark {
      display: grid; grid-template-columns: 10mm auto 10mm; justify-content: center;
      align-items: center; gap: 1.6mm; margin-top: 1.4mm;
    }
    .end-mark span { width: 10mm; border-top: .25mm solid #000; }
    .end-mark b { font-size: ${compact ? 12 : 14}px; line-height: 1; }
    @page { size: ${width}mm ${pageHeightMm}mm; margin: 0; }
    @media print {
      html, body, .ticket {
        width: ${width}mm !important; min-width: ${width}mm !important; max-width: ${width}mm !important;
        margin: 0 !important; background: #fff !important; color: #000 !important;
      }
    }
  </style>
</head>
<body>
  <main class="ticket">
    <header class="brand">
      <div class="brand-name">JOHNA'S</div>
      <div class="restaurant">RESTAURANT</div>
    </header>

    <div class="title-band">
      <span></span><div class="ticket-title">${ar ? 'تذكرة المطبخ' : 'KITCHEN TICKET'}</div><span></span>
    </div>
    <div class="copy-label">${ar ? 'نسخة المطبخ' : 'KITCHEN COPY'}</div>

    <section class="meta">
      <div class="meta-row"><div class="meta-label">${ar ? 'المحطة' : 'Station'}:</div><div class="meta-value">${escapeFixedFormHtml(station)}</div></div>
      ${ctx.orderNumber ? `<div class="meta-row"><div class="meta-label">${ar ? 'رقم الطلب' : 'Order'}:</div><div class="meta-value ltr">${escapeFixedFormHtml(ctx.orderNumber)}</div></div>` : ''}
      <div class="meta-row"><div class="meta-label">${ar ? 'الوقت' : 'Time'}:</div><div class="meta-value ltr">${escapeFixedFormHtml(time)}</div></div>
      ${typeLabel ? `<div class="meta-row"><div class="meta-label">${ar ? 'النوع' : 'Type'}:</div><div class="meta-value">${escapeFixedFormHtml(typeLabel)}</div></div>` : ''}
      ${ctx.tableName ? `<div class="meta-row"><div class="meta-label">${ar ? 'الطاولة' : 'Table'}:</div><div class="meta-value">${escapeFixedFormHtml(ctx.tableName)}</div></div>` : ''}
      ${ctx.guestCount ? `<div class="meta-row"><div class="meta-label">${ar ? 'الأفراد' : 'Guests'}:</div><div class="meta-value ltr">${escapeFixedFormHtml(ctx.guestCount)}</div></div>` : ''}
    </section>

    <div class="rule"></div>
    <section>
      <div class="items-title">${ar ? 'الأصناف' : 'ITEMS'}</div>
      <div class="columns"><div>${ar ? 'الكمية' : 'QTY'}</div><div>${ar ? 'الصنف' : 'ITEM'}</div></div>
      ${rows}
    </section>
    <div class="rule"></div>
    <footer class="end">
      <div>${ar ? 'نهاية الطلب' : 'END OF ORDER'}</div>
      <div class="end-mark"><span></span><b>♨</b><span></span></div>
    </footer>
  </main>
</body>
</html>`;
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
  copies?: number;
  paperWidthMm?: number;
}): Promise<SilentPrintResult> {
  if (typeof window === 'undefined') return { success: false, error: 'WINDOW_UNAVAILABLE' };
  const printerName = safeText(options.printerName);
  if (!printerName) return { success: false, error: 'PRINTER_NAME_REQUIRED' };

  if (isRunningInElectron() && window.electronAPI) {
    try {
      const result = await window.electronAPI.printSilent({
        printerName,
        text: options.text,
        html: options.html,
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
      html: buildStationTicketHtml(station, stationItems, ctx, 80),
      paperWidthMm: 80,
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
