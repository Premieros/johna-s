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
      printSilent: (options: { html?: string; text?: string; template?: FixedThermalTemplate; printerName: string; copies?: number; paperWidthMm?: number }) => Promise<{ success: boolean; error?: string }>;
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
      const result = await window.electronAPI.printSilent({
        printerName,
        text: options.text,
        html: options.html,
        template: options.template,
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
