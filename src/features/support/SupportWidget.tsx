import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useActiveBranchId } from '@/lib/activeBranch';
import { createRequest, readSession, changeSession } from './service';
import { sessionIsLive, type SupportSession } from './protocol';
import SupportSessionView from './SupportSessionView';
export default function SupportWidget({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const [branchId] = useActiveBranchId();
  const [session, setSession] = useState<SupportSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!session || session.operator_id) return;
    let disposed = false; let pending = false;
    const check = async () => {
      if (pending) return;
      pending = true;
      try { const next = await readSession(session.id); if (!disposed) { if (!sessionIsLive(next)) { setSession(null); setError('انتهى طلب الدعم'); } else if (next.operator_id) setSession(next); } }
      catch { if (!disposed) { setError('تعذر متابعة الطلب؛ أعد المحاولة'); setSession(null); } }
      finally { pending = false; }
    };
    const timer = window.setInterval(() => void check(), 3000);
    return () => { disposed = true; clearInterval(timer); };
  }, [session]);
  useEffect(() => { setSession(null); }, [branchId, user?.id]);
  async function request() {
    if (!branchId || !user || busy) return;
    setBusy(true); setError('');
    try { setSession(await createRequest(branchId)); }
    catch { setError('تعذر طلب الدعم. قد تكون الخدمة غير مفعلة أو يوجد طلب قائم.'); }
    finally { setBusy(false); }
  }
  return <aside dir="rtl" className="fixed bottom-20 end-3 z-[80] max-h-[80vh] w-[min(96vw,520px)] overflow-auto rounded-2xl border bg-ui-surface p-4 text-ui-text shadow-ui-lg" aria-label="طلب دعم مباشر">
    {session?.operator_id ? <SupportSessionView initial={session} viewer={false} onEnd={() => { setSession(null); onClose(); }} /> : <>
      <h2 className="text-lg font-bold">الدعم المباشر</h2>
      <p className="my-3">يمكن للمدير مشاهدة التبويب الحالي بعد موافقتك. تظهر له كل البيانات المعروضة؛ أغلق أي معلومات خاصة قبل المشاركة. التحكم بموافقة مستقلة، ويمكنك إنهاء الجلسة في أي وقت.</p>
      <p>لا كاميرا ولا ميكروفون ولا تسجيل للشاشة. مشاركة Chrome/Edge فقط في هذه النسخة.</p>
      {error && <p role="alert" className="text-ui-danger">{error}</p>}
      {session ? <><p role="status">طلبك {session.id.slice(0, 8)} في انتظار المدير</p><button onClick={() => { void changeSession(session.id, { state: 'closed' }).catch(() => {}); setSession(null); }}>إلغاء الطلب</button></> : <button className="my-3 rounded-xl bg-ui-primary px-4 py-3 text-white" disabled={!branchId || busy} onClick={() => void request()}>{busy ? 'جارٍ الطلب…' : 'طلب دعم مباشر'}</button>}
      <button className="mx-3 rounded border p-2" onClick={onClose}>إغلاق النافذة</button>
    </>}
  </aside>;
}
