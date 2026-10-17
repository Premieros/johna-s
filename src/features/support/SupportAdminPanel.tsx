import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useCan } from '@/lib/permissions';
import { listRequests, changeSession } from './service';
import { type SupportSession } from './protocol';
import SupportSessionView from './SupportSessionView';
export default function SupportAdminPanel() {
  const { user } = useAuth();
  const can = useCan();
  const [requests, setRequests] = useState<SupportSession[]>([]);
  const [active, setActive] = useState<SupportSession | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!can('support.manage') || !user) return <p>لا تملك صلاحية الدعم المباشر.</p>;
  async function refresh() {
    setBusy(true); setError('');
    try { setRequests(await listRequests()); } catch { setError('تعذر تحميل طلبات الدعم. تحقق من تفعيل الخدمة وصلاحيتك.'); }
    finally { setBusy(false); }
  }
  async function join(session: SupportSession) {
    setBusy(true); setError('');
    try { setActive(await changeSession(session.id, { operator_id: user!.id, state: 'claimed' })); }
    catch { setError('تعذر الانضمام؛ قد يكون طلبًا منتهيًا أو استلمه مدير آخر.'); }
    finally { setBusy(false); }
  }
  return <section dir="rtl" className="space-y-4"><h2 className="text-xl font-bold">الدعم المباشر</h2>
    {active ? <SupportSessionView initial={active} viewer onEnd={() => { setActive(null); void refresh(); }} /> : <>
      <p>اطلب من الموظف الضغط على زر الدعم أو Ctrl خمس مرات. يبدأ العرض فقط بعد موافقته واختيار تبويبه. التحكم للتنقل والتمرير فقط.</p>
      <button className="rounded bg-ui-primary p-3 text-white" disabled={busy} onClick={() => void refresh()}>{busy ? 'جارٍ التحميل…' : 'تحميل طلبات الدعم'}</button>
      {error && <p role="alert" className="text-ui-danger">{error}</p>}
      {requests.map(session => <article key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"><div><p>طلب {session.id.slice(0, 8)}</p><p>الموظف: {session.requester_name} · {session.requester_id.slice(0, 8)}</p><p>الفرع: {session.branch_name}</p><time>{new Date(session.created_at).toLocaleString('ar-EG')}</time></div><button disabled={busy || Boolean(session.operator_id)} onClick={() => void join(session)}>{session.operator_id ? 'قيد الدعم' : 'الانضمام للدعم'}</button></article>)}
    </>}
  </section>;
}
