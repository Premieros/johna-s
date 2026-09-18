import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useCan } from '@/lib/permissions';
import {
  claimCloudPrintJobs,
  completeCloudPrintJob,
  getCloudPrintAgentBranchId,
  getCloudPrintAgentId,
  isCloudPrintAgentEnabled,
  startCloudPrintJob,
  type CloudPrintJob,
} from '../../services/cloudPrint';
import {
  executeSilentPrintDetailed,
  getAvailablePrinters,
  getLocalPrinterRoutes,
  isSilentPrintEnabled,
} from '../../services/localPrintAgent';

const POLL_INTERVAL_MS = 700;
const TRANSPORT_CHECK_INTERVAL_MS = 5_000;

function printRouteForStation(station: string, routes: Record<string, string>): string {
  const direct = routes[station];
  if (direct) return direct;
  if (station === 'cashier' || station === 'receipt') return routes.cashier || routes.receipt || '';
  return '';
}

function physicalPrinterKey(printerName: string): string {
  return printerName.trim().toLocaleLowerCase();
}

function legacyThermalHtmlToText(html: string): string {
  if (typeof window === 'undefined' || !html.trim()) return '';
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('style,script,noscript,svg').forEach((node) => node.remove());
    const text = doc.body?.innerText || doc.body?.textContent || '';
    return text
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch {
    return '';
  }
}

async function executeJob(job: CloudPrintJob, agentId: string, printerName: string): Promise<void> {
  const started = await startCloudPrintJob(job.id, agentId);
  if (!started) return;

  if (!printerName) {
    await completeCloudPrintJob(job.id, agentId, false, `PRINTER_ROUTE_MISSING:${job.station_code}`);
    return;
  }

  const isThermalDocument = job.kind === 'receipt' || job.kind === 'report';
  const legacyText = isThermalDocument && !job.payload?.text && job.payload?.html
    ? legacyThermalHtmlToText(job.payload.html)
    : '';
  const result = await executeSilentPrintDetailed({
    printerName,
    text: job.payload?.text || legacyText || undefined,
    html: isThermalDocument ? undefined : job.payload?.html,
    copies: Math.max(1, Math.min(5, Number(job.payload?.copies || 1))),
    paperWidthMm: Number(job.payload?.paperWidthMm || 80),
  });
  await completeCloudPrintJob(job.id, agentId, result.success, result.error);
}

async function executeClaimedBatch(jobs: CloudPrintJob[], agentId: string): Promise<void> {
  const routes = getLocalPrinterRoutes();
  const lanes = new Map<string, Array<{ job: CloudPrintJob; printerName: string }>>();

  for (const job of jobs) {
    const printerName = printRouteForStation(job.station_code, routes).trim();
    const key = printerName ? `printer:${physicalPrinterKey(printerName)}` : `missing:${job.id}`;
    const lane = lanes.get(key) || [];
    lane.push({ job, printerName });
    lanes.set(key, lane);
  }

  await Promise.allSettled(Array.from(lanes.values()).map(async (lane) => {
    for (const entry of lane) await executeJob(entry.job, agentId, entry.printerName);
  }));
}

export function CloudPrintAgent() {
  const { user } = useAuth();
  const can = useCan();
  const [configVersion, setConfigVersion] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    const refresh = () => setConfigVersion((value) => value + 1);
    window.addEventListener('johns:cloud-print-agent-config', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('johns:cloud-print-agent-config', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  useEffect(() => {
    // The installed legacy Windows print service is intentionally supported here.
    // It is reachable from the normal web POS through localPrintAgent.ts, so Electron
    // must not be required before polling the durable cloud queue.
    if (!user?.id) return;
    if (!can('settings.manage') && !can('pos.print_kitchen') && !can('pos.receipt.print')) return;
    if (!isSilentPrintEnabled() || !isCloudPrintAgentEnabled()) return;
    const branchId = getCloudPrintAgentBranchId();
    if (!branchId) return;

    const agentId = getCloudPrintAgentId();
    let cancelled = false;
    let timer = 0;
    let transportAvailable = false;
    let lastTransportCheckAt = 0;

    const ensurePrintTransport = async (): Promise<boolean> => {
      const now = Date.now();
      if (now - lastTransportCheckAt < TRANSPORT_CHECK_INTERVAL_MS) return transportAvailable;
      lastTransportCheckAt = now;
      try {
        transportAvailable = (await getAvailablePrinters()).length > 0;
      } catch {
        transportAvailable = false;
      }
      return transportAvailable;
    };

    const poll = async () => {
      if (cancelled) return;
      if (busy.current) {
        timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
        return;
      }
      busy.current = true;
      try {
        // Never claim durable jobs unless Electron or the legacy localhost print
        // service can actually see a Windows printer. This leaves jobs pending
        // instead of burning retry attempts while the local service is offline.
        if (!(await ensurePrintTransport())) return;
        const jobs = await claimCloudPrintJobs(branchId, agentId, 12);
        if (jobs.length > 0) await executeClaimedBatch(jobs, agentId);
      } catch (error) {
        console.warn('[cloud-print-agent] poll failed', error);
      } finally {
        busy.current = false;
        if (!cancelled) timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [can, configVersion, user?.id]);

  return null;
}
