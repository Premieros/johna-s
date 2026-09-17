import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useCan } from '@/lib/permissions';
import {
  claimCloudPrintJobs,
  completeCloudPrintJob,
  getCloudPrintAgentBranchId,
  getCloudPrintAgentId,
  heartbeatCloudPrintAgent,
  isCloudPrintAgentEnabled,
  registerCloudPrintAgent,
  startCloudPrintJob,
  type CloudPrintJob,
} from '../../services/cloudPrint';
import {
  executeSilentPrintDetailed,
  getLocalPrinterRoutes,
  isRunningInElectron,
  isSilentPrintEnabled,
} from '../../services/localPrintAgent';

const POLL_INTERVAL_MS = 700;
const HEARTBEAT_INTERVAL_MS = 10_000;

function printRouteForStation(station: string, routes: Record<string, string>): string {
  const direct = routes[station];
  if (direct) return direct;
  if (station === 'cashier' || station === 'receipt') return routes.cashier || routes.receipt || '';
  return '';
}

function physicalPrinterKey(printerName: string): string {
  return printerName.trim().toLocaleLowerCase();
}

async function executeJob(job: CloudPrintJob, agentId: string, printerName: string): Promise<void> {
  const started = await startCloudPrintJob(job.id, agentId);
  if (!started) return;

  if (!printerName) {
    await completeCloudPrintJob(job.id, agentId, false, `PRINTER_ROUTE_MISSING:${job.station_code}`);
    return;
  }

  const result = await executeSilentPrintDetailed({
    printerName,
    text: job.payload?.text,
    html: job.payload?.html,
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
    if (!isRunningInElectron() || !user?.id) return;
    if (!isSilentPrintEnabled() || !isCloudPrintAgentEnabled()) return;
    const branchId = getCloudPrintAgentBranchId();
    if (!branchId) return;

    const agentId = getCloudPrintAgentId();
    const mayRegister = can('settings.manage');
    let cancelled = false;
    let timer = 0;
    let lastHeartbeatAt = 0;
    let runtimeAuthorized = false;

    const ensureRuntimeAuthorization = async (): Promise<boolean> => {
      const now = Date.now();
      if (runtimeAuthorized && now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return true;

      let heartbeat = await heartbeatCloudPrintAgent(agentId);
      if (!heartbeat.success && mayRegister) {
        const registered = await registerCloudPrintAgent(branchId, agentId);
        if (registered) heartbeat = await heartbeatCloudPrintAgent(agentId);
      }

      runtimeAuthorized = heartbeat.success && (!heartbeat.branchId || heartbeat.branchId === branchId);
      lastHeartbeatAt = now;
      return runtimeAuthorized;
    };

    const poll = async () => {
      if (cancelled) return;
      if (busy.current) {
        timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
        return;
      }
      busy.current = true;
      try {
        const authorized = await ensureRuntimeAuthorization();
        if (!authorized) {
          if (mayRegister) console.warn('[cloud-print-agent] device registration or heartbeat failed');
          return;
        }
        const jobs = await claimCloudPrintJobs(branchId, agentId, 12);
        if (jobs.length > 0) await executeClaimedBatch(jobs, agentId);
      } catch (error) {
        runtimeAuthorized = false;
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
