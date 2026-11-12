import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import {
  listDelayedPrintTickets, reserveManualPrintTicket, finishManualPrintTicket,
  manualPrintError, prepareManualPrintWindow, type DelayedPrintTicket,
} from '../../services/manualPrintRecovery';

export function ManualPrintRecovery({ branchId, onClose }: { branchId: string; onClose: () => void }) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const allowed = can('pos.print_recovery');
  const [tickets, setTickets] = useState<DelayedPrintTicket[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reserved, setReserved] = useState<{ id: string; agentId: string } | null>(null);
  const running = useRef(false);
  const scope = useRef(branchId);
  scope.current = branchId;
  const refresh = useCallback(async () => {
    if (!allowed || !branchId) return;
    setBusy(true); setError('');
    try {
      const rows = await listDelayedPrintTickets(branchId);
      if (scope.current === branchId) setTickets(rows);
    } catch (e) { if (scope.current === branchId) setError(manualPrintError(e, ar)); }
    finally { if (scope.current === branchId) setBusy(false); }
  }, [allowed, branchId, ar]);
  useEffect(() => { void refresh(); }, [refresh]);

  const print = async (ticket: DelayedPrintTicket) => {
    if (!allowed || running.current || reserved) return;
    // Open during the actual click, before RPC, so popup denial cannot reserve a ticket.
    const popup = window.open('', '_blank', 'popup,width=460,height=720');
    if (!popup) { setError(manualPrintError(new Error('POPUP_BLOCKED'), ar)); return; }
    popup.opener = null;
    const agentId = crypto.randomUUID();
    running.current = true; setBusy(true); setError(''); setNotice('');
    let claimed = false;
    try {
      const job = await reserveManualPrintTicket(ticket.id, agentId);
      claimed = true;
      setReserved({ id: ticket.id, agentId });
      prepareManualPrintWindow(popup, job, ar);
    } catch (e) {
      popup.close();
      // A reserve transport failure is ambiguous: never print from list data or retry it.
      if (claimed) {
        try { await finishManualPrintTicket(ticket.id, agentId, false); setReserved(null); }
        catch { /* Keep confirmation controls; unknown work must never be replayed. */ }
      }
      setError(manualPrintError(e, ar));
    } finally { running.current = false; setBusy(false); }
  };
  const confirm = async (confirmed: boolean) => {
    if (!allowed || !reserved || running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      await finishManualPrintTicket(reserved.id, reserved.agentId, confirmed);
      setReserved(null);
      setNotice(ar ? (confirmed ? 'تم تسجيل تسليم التذكرة للطباعة.' : 'النتيجة غير مؤكدة؛ أُوقف التكرار التلقائي. راجع الورقة قبل إعادة الطباعة.')
        : (confirmed ? 'Ticket submission recorded.' : 'Outcome uncertain; automatic retry stopped. Check the paper before reprinting.'));
      await refresh();
    } catch (e) { setError(manualPrintError(e, ar)); }
    finally { running.current = false; setBusy(false); }
  };
  return <Modal open title={ar ? 'طباعة يدوية للتذاكر المتأخرة' : 'Manual delayed ticket printing'} onClose={() => { if (!busy) onClose(); }} size="lg">
    <p className="mb-3 text-sm text-ui-muted">{ar ? 'استخدم جهاز الفرع المتصل بالطابعة. اختر الطابعة الصحيحة من نافذة المتصفح. تظهر تذاكر آخر 24 ساعة التي تأخرت 15 ثانية ولم يستلمها الوكيل. التذاكر الجاري تنفيذها أو المرسلة تحتاج مسار إعادة الطباعة.' : 'Use the branch computer connected to the printer. Select the correct printer in the browser dialog. Shows never-claimed tickets from the last 24 hours delayed at least 15 seconds. In-progress/submitted tickets require the reprint flow.'}</p>
    {error && <p role="alert" className="mb-3 text-ui-danger">{error}</p>}
    {notice && <p role="status" className="mb-3">{notice}</p>}
    {reserved ? <div className="space-y-3 rounded-xl border border-ui-border p-4">
      <p>{ar ? 'بعد الطباعة من النافذة الجديدة، أكد النتيجة خلال 10 دقائق. فتح النافذة وحده لا يعني أن الورقة طُبعت. لا تعاود الضغط على طباعة للتذكرة نفسها.' : 'After printing in the new window, confirm within 10 minutes. Opening the window does not confirm paper output. Do not print this ticket again.'}</p>
      <Button disabled={busy || !allowed} onClick={() => void confirm(true)}>{ar ? 'تمت الطباعة' : 'Printed'}</Button>{' '}
      <Button variant="outline" disabled={busy || !allowed} onClick={() => void confirm(false)}>{ar ? 'ألغيت أو لم أتأكد' : 'Cancelled or unsure'}</Button>
    </div> : <>
      <Button variant="outline" disabled={busy || !allowed} onClick={() => void refresh()}>{ar ? 'تحديث القائمة' : 'Refresh list'}</Button>
      {!busy && !tickets.length && <p className="my-4">{ar ? 'لا توجد تذاكر متأخرة مؤهلة للطباعة اليدوية.' : 'No delayed tickets eligible for manual printing.'}</p>}
      <div className="mt-3 space-y-2">{tickets.map(ticket => <div key={ticket.id} className="flex items-center justify-between gap-3 rounded-xl border border-ui-border p-3">
        <div>{ticket.context && <p className="font-bold">{ticket.context}</p>}<p>{ticket.station_code} · {ticket.kind === 'kitchen' ? (ar ? 'المطبخ' : 'Kitchen') : (ar ? 'إيصال / تقرير' : 'Receipt / report')}</p><p className="text-xs text-ui-muted">{new Date(ticket.created_at).toLocaleString(ar ? 'ar-EG' : 'en-GB')} · {ticket.id.slice(0, 8)}</p></div>
        <Button disabled={busy || !allowed} onClick={() => void print(ticket)}>{ar ? 'طباعة يدوية' : 'Print manually'}</Button>
      </div>)}</div>
    </>}
  </Modal>;
}
