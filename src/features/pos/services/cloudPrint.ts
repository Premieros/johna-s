import { supabase, shifts as shiftsApi, pos as apiPos } from '@/api';
import type { KitchenSendItem } from '../types';
import { buildStationTicketText, groupKitchenItemsByStation, type LocalKitchenPrintContext } from './localPrintAgent';

const STORAGE_AGENT_ENABLED_KEY = 'johns_pos_cloud_print_agent_enabled';
const STORAGE_AGENT_BRANCH_KEY = 'johns_pos_cloud_print_agent_branch_id';
const STORAGE_AGENT_ID_KEY = 'johns_pos_cloud_print_agent_id';

export interface CloudPrintPayload { text?: string; html?: string; paperWidthMm?: number; copies?: number; }
export interface CloudPrintJob {
  id: string; branch_id: string; kind: 'kitchen' | 'receipt' | 'test' | 'report'; station_code: string;
  payload: CloudPrintPayload; sale_id?: string | null; expected_print_number?: number | null;
  attempts: number; created_at: string;
}
type RpcResult = { success?: boolean; error?: string; detail?: string; job_id?: string; status?: string; jobs?: CloudPrintJob[] };
const safeText = (value: unknown) => String(value ?? '').trim();
const KITCHEN_ENQUEUE_MAX_ATTEMPTS = 3;
const KITCHEN_ENQUEUE_RETRY_MS = 250;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function randomId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return hex.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const nibble = char === 'x' ? value : ((value & 0x3) | 0x8);
    return nibble.toString(16);
  });
}

export function isCloudPrintAgentEnabled(): boolean {
  return typeof window !== 'undefined' && window.localStorage.getItem(STORAGE_AGENT_ENABLED_KEY) === 'true';
}
export function getCloudPrintAgentBranchId(): string {
  return typeof window === 'undefined' ? '' : safeText(window.localStorage.getItem(STORAGE_AGENT_BRANCH_KEY));
}
export function saveCloudPrintAgentConfig(config: { enabled: boolean; branchId: string }): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_AGENT_ENABLED_KEY, config.enabled ? 'true' : 'false');
  const branchId = safeText(config.branchId);
  if (branchId) window.localStorage.setItem(STORAGE_AGENT_BRANCH_KEY, branchId);
  else window.localStorage.removeItem(STORAGE_AGENT_BRANCH_KEY);
  window.dispatchEvent(new CustomEvent('johns:cloud-print-agent-config'));
}
export function getCloudPrintAgentId(): string {
  if (typeof window === 'undefined') return randomId();
  const current = safeText(window.localStorage.getItem(STORAGE_AGENT_ID_KEY));
  if (current) return current;
  const id = randomId();
  window.localStorage.setItem(STORAGE_AGENT_ID_KEY, id);
  return id;
}

export async function enqueueCloudKitchenPrintJobs(params: { branchId: string; items: KitchenSendItem[]; context: LocalKitchenPrintContext; paperWidthMm?: number }) {
  const branchId = safeText(params.branchId);
  if (!branchId || params.items.length === 0 || (typeof navigator !== 'undefined' && !navigator.onLine)) return { accepted: false, queuedStations: [], failedStations: [] };
  const entries = Object.entries(groupKitchenItemsByStation(params.items));
  if (!entries.length) return { accepted: false, queuedStations: [], failedStations: [] };
  const results = await Promise.all(entries.map(async ([station, stationItems]) => {
    const deltaIdentities = stationItems
      .map((item) => {
        const sendIdentity = safeText(item.send_id || item.order_item_id);
        const currentQuantity = Number(item.current_quantity);
        if (!sendIdentity || !Number.isFinite(currentQuantity)) return '';
        return `${sendIdentity}:${currentQuantity}`;
      })
      .filter(Boolean)
      .sort();
    const fallbackIdentities = stationItems
      .map((item) => `${safeText(item.order_item_id || item.product_id)}:${Number(item.quantity || 0)}`)
      .sort();
    const keySeed = deltaIdentities.length === stationItems.length
      ? deltaIdentities.join(',')
      : `${safeText(params.context.orderNumber)}:${fallbackIdentities.join(',')}`;
    const idempotencyKey = `kitchen:${station}:${keySeed}`;
    const payload = { text: buildStationTicketText(station, stationItems, params.context), paperWidthMm: Number(params.paperWidthMm || 80), copies: 1 };

    let lastError = '';
    for (let attempt = 1; attempt <= KITCHEN_ENQUEUE_MAX_ATTEMPTS; attempt += 1) {
      const { data, error } = await supabase.rpc('enqueue_cloud_kitchen_print', {
        p_branch_id: branchId,
        p_station_code: station,
        p_payload: payload,
        p_idempotency_key: idempotencyKey,
      });
      const result = (data ?? {}) as RpcResult;
      if (!error && Boolean(result.success)) return { station, ok: true, attempts: attempt, error: '' };

      lastError = error?.message || result.error || result.detail || 'CLOUD_PRINT_ENQUEUE_FAILED';
      if (attempt < KITCHEN_ENQUEUE_MAX_ATTEMPTS) await sleep(KITCHEN_ENQUEUE_RETRY_MS * attempt);
    }

    console.error('[cloud-print] kitchen station enqueue failed after retries', {
      station,
      branchId,
      idempotencyKey,
      error: lastError,
    });
    return { station, ok: false, attempts: KITCHEN_ENQUEUE_MAX_ATTEMPTS, error: lastError };
  }));
  const queuedStations = results.filter((x) => x.ok).map((x) => x.station);
  const failedStations = results.filter((x) => !x.ok).map((x) => x.station);
  return { accepted: queuedStations.length === entries.length, queuedStations, failedStations };
}

export async function enqueueCloudOpenOrderPrint(params: { orderId: string; payload: CloudPrintPayload; idempotencyKey: string }) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { accepted: false, error: 'OFFLINE' };
  const { data, error } = await apiPos.enqueueOpenOrderPrint({
    p_order_id: params.orderId,
    p_payload: params.payload as Record<string, unknown>,
    p_idempotency_key: params.idempotencyKey,
  });
  if (error) return { accepted: false, error: error.message };
  const result = (data ?? {}) as RpcResult;
  return result.success
    ? { accepted: true, jobId: result.job_id, stationCode: 'cashier' }
    : { accepted: false, error: result.error || result.detail || 'CLOUD_PRINT_ENQUEUE_FAILED' };
}

export async function enqueueCloudReceiptPrint(params: { saleId: string; approvalRequestId: string | null; payload: CloudPrintPayload; idempotencyKey?: string }) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { accepted: false, error: 'OFFLINE' };
  const { data, error } = await supabase.rpc('enqueue_cloud_receipt_print', {
    p_sale_id: params.saleId,
    p_approval_request_id: params.approvalRequestId,
    p_payload: params.payload,
    p_idempotency_key: params.idempotencyKey || `receipt:${params.saleId}:${Date.now()}`,
  });
  if (error) return { accepted: false, error: error.message };
  const result = (data ?? {}) as RpcResult;
  return result.success ? { accepted: true, jobId: result.job_id } : { accepted: false, error: result.error || result.detail || 'CLOUD_PRINT_ENQUEUE_FAILED' };
}

export async function enqueueCloudReportPrint(params: { branchId: string; payload: CloudPrintPayload; idempotencyKey: string }) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { accepted: false, error: 'OFFLINE' };
  const { data, error } = await shiftsApi.enqueueReportPrint({
    p_branch_id: params.branchId,
    p_payload: params.payload as Record<string, unknown>,
    p_idempotency_key: params.idempotencyKey,
  });
  if (error) return { accepted: false, error: error.message };
  const result = (data ?? {}) as RpcResult;
  return result.success
    ? { accepted: true, jobId: result.job_id, stationCode: 'cashier' }
    : { accepted: false, error: result.error || result.detail || 'CLOUD_PRINT_ENQUEUE_FAILED' };
}

export async function claimCloudPrintJobs(branchId: string, agentId: string, limit = 12): Promise<CloudPrintJob[]> {
  const { data, error } = await supabase.rpc('claim_cloud_print_jobs', { p_branch_id: branchId, p_agent_id: agentId, p_limit: limit });
  if (error) throw error;
  const result = (data ?? {}) as RpcResult;
  if (!result.success) throw new Error(result.error || result.detail || 'CLOUD_PRINT_CLAIM_FAILED');
  return Array.isArray(result.jobs) ? result.jobs : [];
}
export async function startCloudPrintJob(jobId: string, agentId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('start_cloud_print_job', { p_job_id: jobId, p_agent_id: agentId });
  return !error && Boolean((data as RpcResult | null)?.success);
}
export async function completeCloudPrintJob(jobId: string, agentId: string, success: boolean, errorMessage?: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('complete_cloud_print_job', {
    p_job_id: jobId, p_agent_id: agentId, p_success: success, p_error: errorMessage || null,
  });
  return !error && Boolean((data as RpcResult | null)?.success);
}
