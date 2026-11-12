import { printRecovery } from '@/api/domains/printRecovery';
import type { CloudPrintPayload } from './cloudPrint';

export interface DelayedPrintTicket { id: string; kind: string; station_code: string; created_at: string; context?: string | null; }
export interface ReservedPrintTicket extends DelayedPrintTicket { payload: CloudPrintPayload; }

function unwrap<T>(result: { data: unknown; error: unknown }): T {
  if (result.error) throw result.error;
  const data = result.data as { success?: boolean; error?: string } | null;
  if (!data?.success) throw new Error(data?.error || 'MANUAL_PRINT_FAILED');
  return data as T;
}
export async function listDelayedPrintTickets(branchId: string): Promise<DelayedPrintTicket[]> {
  return unwrap<{ jobs: DelayedPrintTicket[] }>(await printRecovery.list( { p_branch_id: branchId })).jobs;
}
export async function reserveManualPrintTicket(jobId: string, agentId: string): Promise<ReservedPrintTicket> {
  return unwrap<{ job: ReservedPrintTicket }>(await printRecovery.reserve( { p_job_id: jobId, p_agent_id: agentId })).job;
}
export async function finishManualPrintTicket(jobId: string, agentId: string, confirmed: boolean): Promise<void> {
  unwrap(await printRecovery.finish( { p_job_id: jobId, p_agent_id: agentId, p_confirmed: confirmed }));
}

export function manualPrintError(error: unknown, ar: boolean): string {
  const message = error instanceof Error ? error.message : '';
  const codes: Record<string, [string, string]> = {
    PERMISSION_DENIED: ['لا تملك صلاحية الطباعة اليدوية أو صلاحية طباعة هذا النوع.', 'Manual recovery and the ticket print permission are required.'],
    BRANCH_MISMATCH: ['لا يمكنك طباعة تذاكر هذا الفرع.', 'You cannot print tickets for this branch.'],
    JOB_NO_LONGER_PENDING: ['استلم الوكيل التذكرة أو لم تعد مؤهلة. حدّث القائمة ولا تطبع نسخة أخرى.', 'The ticket was claimed or is no longer eligible. Refresh; do not print another copy.'],
    CLAIM_MISMATCH: ['انتهى حجز التذكرة أو تغيرت حالتها. راجع الورقة وحالة الطباعة قبل أي إعادة طباعة.', 'The reservation expired or changed. Check the paper and print status before reprinting.'],
    POPUP_BLOCKED: ['اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مجددًا. لم تُحجز التذكرة.', 'Allow popups for this site and retry. The ticket was not reserved.'],
  };
  return codes[message]?.[ar ? 0 : 1] || (ar
    ? 'تعذر تأكيد العملية. حدّث القائمة وراجع حالة التذكرة قبل إعادة الطباعة.'
    : 'The operation could not be confirmed. Refresh and check ticket status before reprinting.');
}

// Never inject stored HTML/scripts into the print window. Preserve ticket text only.
export function manualTicketText(payload: CloudPrintPayload): string {
  if (payload.text?.trim()) return payload.text;
  if (!payload.html) throw new Error('PRINT_CONTENT_MISSING');
  const doc = new DOMParser().parseFromString(payload.html, 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,template').forEach(node => node.remove());
  doc.querySelectorAll('br').forEach(node => node.replaceWith('\n'));
  doc.querySelectorAll('td,th').forEach(node => node.append('\t'));
  doc.querySelectorAll('tr,p,div,h1,h2,h3').forEach(node => node.append('\n'));
  const text = doc.body.textContent || '';
  if (!text.trim()) throw new Error('PRINT_CONTENT_MISSING');
  return text;
}

export function prepareManualPrintWindow(popup: Window, ticket: ReservedPrintTicket, ar: boolean): void {
  const text = manualTicketText(ticket.payload);
  const doc = popup.document;
  doc.title = `${ar ? 'تذكرة' : 'Ticket'} — ${ticket.station_code}`;
  const style = doc.createElement('style');
  const width = Number(ticket.payload.paperWidthMm) === 58 ? 58 : 80;
  style.textContent = `body{margin:0 auto;max-width:${width}mm;color:#000;background:#fff}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px monospace;padding:2mm}button{margin:12px;padding:12px}@media print{button{display:none}@page{size:${width}mm auto;margin:0}}`;
  doc.head.append(style);
  const button = doc.createElement('button');
  button.textContent = ar ? 'اختيار الطابعة والطباعة' : 'Choose printer and print';
  button.onclick = () => {
    button.disabled = true; // One dispatch per reservation, including a cancelled dialog.
    popup.print();
  };
  const content = doc.createElement('pre');
  content.textContent = text;
  doc.body.replaceChildren(button, content);
  popup.focus();
}
