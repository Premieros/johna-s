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

function modifierNames(item: KitchenSendItem): string[] {
  return (item.modifiers || [])
    .map((m) => safeText(m.option_name || m.option_name_en))
    .filter(Boolean);
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
  const lines: string[] = [];
  const ar = ctx.isAr;
  lines.push('================================');
  lines.push(ar ? `محطة: ${station}` : `Station: ${station}`);
  if (ctx.orderNumber) lines.push(`${ar ? 'طلب' : 'Order'}: ${safeText(ctx.orderNumber)}`);
  if (ctx.tableName) lines.push(`${ar ? 'طاولة' : 'Table'}: ${safeText(ctx.tableName)}`);
  if (ctx.orderType) lines.push(`${ar ? 'النوع' : 'Type'}: ${safeText(ctx.orderType)}`);
  if (ctx.guestCount) lines.push(`${ar ? 'ضيوف' : 'Guests'}: ${ctx.guestCount}`);
  lines.push(new Date().toLocaleString(ar ? 'ar-EG' : 'en-US'));
  lines.push('--------------------------------');

  for (const item of items) {
    const qty = Number(item.quantity || 0);
    lines.push(`${qty} x ${safeText(item.product_name || '—')}`);
    for (const modifier of modifierNames(item)) lines.push(`  + ${modifier}`);
    if (item.notes?.trim()) lines.push(`  * ${safeText(item.notes)}`);
    lines.push('');
  }

  lines.push('================================');
  lines.push('');
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
        text: options.text || options.html || '',
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

/**
 * Print station groups concurrently across physical printers. Electron itself
 * serializes jobs only when they target the same printer, so a stalled device
 * cannot block unrelated cashier/kitchen/barista queues.
 */
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
