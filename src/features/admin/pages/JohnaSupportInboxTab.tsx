import { useCallback, useEffect, useMemo, useState } from 'react';
import { Headphones, MessageCircle, RefreshCw, Send, UserRound, Bot } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

const API = 'https://premieros-agent-support-public.vercel.app/api/support/johna-inbox';
type Conversation = {
 id: string; mode: 'ai' | 'human'; createdAt: string; updatedAt: string;
};
type Message = {
 id: string; conversationId: string; role: 'customer' | 'assistant' | 'employee';
 body: string; createdAt: string;
};
type Snapshot = { conversations: Conversation[]; messages: Message[] };
const date = (value: string, ar: boolean) => new Date(value).toLocaleString(ar ? 'ar-EG' : 'en-GB', {
 year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
});

export function JohnaSupportInboxTab() {
 const { user, session } = useAuth();
 const { lang } = useLanguage();
 const ar = lang === 'ar';
 const [rows, setRows] = useState<Conversation[]>([]);
 const [messages, setMessages] = useState<Message[]>([]);
 const [selectedId, setSelectedId] = useState('');
 const [search, setSearch] = useState('');
 const [draft, setDraft] = useState('');
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [error, setError] = useState('');

 const selected = rows.find(c => c.id === selectedId);
 const visible = useMemo(() => rows.filter(c => c.id.includes(search.trim())), [rows, search]);
 const selectedMessages = useMemo(
  () => messages.filter(m => m.conversationId === selectedId),
  [messages, selectedId]
 );
 const preview = (conversationId: string) => {
  const last = [...messages].reverse().find(m => m.conversationId === conversationId);
  return last ? last.body.slice(0, 90) : (ar ? 'لم تبدأ الرسائل بعد' : 'No messages yet');
 };

 const api = useCallback(async (payload?: { conversationId: string; action: 'takeover' | 'release' | 'reply'; text?: string }) => {
  if (user?.role !== 'super_admin' || !session?.access_token)
   throw new Error(ar ? 'تحتاج إلى صلاحية المدير العام في Johna-S.' : 'Johna-S superadmin access required.');
  const res = await fetch(API, {
   method: payload ? 'POST' : 'GET', mode: 'cors', credentials: 'omit', cache: 'no-store',
   headers: {
    Authorization: 'Bearer ' + session.access_token,
    ...(payload ? { 'Content-Type': 'application/json' } : {})
   },
   ...(payload ? { body: JSON.stringify(payload) } : {})
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || (ar ? 'تعذر الاتصال بخدمة العملاء.' : 'Support unavailable.'));
  return data;
 }, [ar, session?.access_token, user?.role]);

 const refresh = useCallback(async (silent = false) => {
  if (!silent) setLoading(true);
  try {
   const data = await api() as Snapshot;
   setRows(data.conversations || []);
   setMessages(data.messages || []);
   setSelectedId(current => data.conversations.some(c => c.id === current)
    ? current : data.conversations[0]?.id || '');
   setError('');
  } catch (e) {
   setError(e instanceof Error ? e.message : (ar ? 'تعذر تحميل المحادثات.' : 'Failed to load chats.'));
  } finally {
   if (!silent) setLoading(false);
  }
 }, [api, ar]);

 useEffect(() => {
  if (user?.role !== 'super_admin' || !session?.access_token) {
   setLoading(false);
   return;
  }
  void refresh();
  const interval = window.setInterval(() => void refresh(true), 7000);
  return () => window.clearInterval(interval);
 }, [refresh, user?.role, session?.access_token]);

 const action = async (type: 'takeover' | 'release' | 'reply') => {
  if (!selectedId || saving || (type === 'reply' && !draft.trim())) return;
  setSaving(true);
  try {
   await api({ conversationId: selectedId, action: type, ...(type === 'reply' ? { text: draft.trim() } : {}) });
   if (type === 'reply') setDraft('');
   await refresh(true);
   setError('');
  } catch (e) {
   setError(e instanceof Error ? e.message : (ar ? 'لم تكتمل العملية.' : 'Action failed.'));
  } finally { setSaving(false); }
 };

 return <section className="space-y-4" dir={ar ? 'rtl' : 'ltr'}>
  <div className="rounded-2xl border border-ui-border bg-ui-surface p-4 flex flex-wrap items-start justify-between gap-3">
   <div className="flex items-center gap-3">
    <Headphones className="h-6 w-6 text-brand-600" />
    <div>
     <h2 className="text-lg font-black text-ui-text">{ar ? 'خدمة العملاء — محادثة موحدة' : 'Customer support — One conversation'}</h2>
     <p className="text-xs text-ui-subtle">{ar
      ? 'رسائل العميل وAGENT وموظف الدعم في محادثة واحدة. يمكن استلام المحادثة أو إعادتها للرد الآلي دون بدء محادثة جديدة.'
      : 'Customers, AGENT and human staff use one shared thread.'}</p>
    </div>
   </div>
   <button type="button" onClick={() => void refresh()} disabled={loading || saving}
    className="inline-flex items-center gap-2 rounded-xl border border-ui-border px-3 py-2 text-sm font-bold text-ui-text disabled:opacity-50">
    <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {ar ? 'تحديث' : 'Refresh'}
   </button>
  </div>
  {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  <div className="grid gap-3 lg:grid-cols-[320px_minmax(0,1fr)]">
   <div className="overflow-hidden rounded-2xl border border-ui-border bg-ui-surface">
    <div className="space-y-2 border-b border-ui-border p-3">
     <p className="text-sm font-bold">{ar ? 'محادثات العملاء' : 'Conversations'} ({visible.length})</p>
     <input aria-label={ar ? 'بحث برقم المحادثة' : 'Search by conversation ID'}
      placeholder={ar ? 'بحث برقم المحادثة' : 'Find conversation'}
      value={search} onChange={event => setSearch(event.target.value)}
      className="w-full rounded-lg border border-ui-border bg-ui-page px-3 py-2 text-sm" />
    </div>
    <div className="max-h-[560px] overflow-y-auto">
     {loading && rows.length === 0 && <p className="p-4 text-sm text-ui-muted">{ar ? 'تحميل المحادثات…' : 'Loading...'}</p>}
     {!loading && visible.length === 0 && <p className="p-4 text-sm text-ui-muted">{ar ? 'لا توجد محادثات بعد.' : 'No conversations yet.'}</p>}
     {visible.map(c => <button type="button" key={c.id} onClick={() => setSelectedId(c.id)}
      className={`w-full border-b border-ui-border p-3 text-start transition ${c.id === selectedId ? 'bg-ui-primary-soft' : 'hover:bg-ui-page-alt'}`}>
      <div className="flex items-center justify-between gap-2">
       <span className="inline-flex items-center gap-1.5 text-sm font-bold text-ui-text"><MessageCircle className="h-4 w-4" /> {ar ? 'محادثة عميل' : 'Customer chat'}</span>
       <span className={`rounded-lg px-2 py-1 text-[11px] font-bold ${c.mode === 'human' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>
        {c.mode === 'human' ? (ar ? 'موظف الدعم' : 'Human') : 'AGENT'}
       </span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-ui-muted">{preview(c.id)}</p>
      <time className="mt-1 block text-[11px] text-ui-subtle">{date(c.updatedAt, ar)}</time>
     </button>)}
    </div>
   </div>
   <div className="flex min-h-[520px] flex-col overflow-hidden rounded-2xl border border-ui-border bg-ui-surface">
    {selected ? <>
     <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ui-border p-3">
      <div>
       <p className="font-black">{ar ? 'محادثة العميل' : 'Customer conversation'}</p>
       <p className="text-[11px] text-ui-muted">{date(selected.createdAt, ar)}</p>
      </div>
      <div className="flex gap-2">
       {selected.mode === 'ai' ? <button type="button" disabled={saving}
        onClick={() => void action('takeover')}
        className="inline-flex items-center gap-1.5 rounded-xl bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900 disabled:opacity-50">
        <UserRound className="h-4 w-4" /> {ar ? 'استلام المحادثة' : 'Take over'}
       </button> : <button type="button" disabled={saving}
        onClick={() => void action('release')}
        className="inline-flex items-center gap-1.5 rounded-xl bg-sky-100 px-3 py-2 text-sm font-bold text-sky-900 disabled:opacity-50">
        <Bot className="h-4 w-4" /> {ar ? 'إعادة الرد إلى AGENT' : 'Return to AGENT'}
       </button>}
      </div>
     </div>
     <div aria-label={ar ? 'رسائل المحادثة' : 'Chat messages'} role="log" className="flex max-h-[530px] min-h-[350px] flex-1 flex-col gap-3 overflow-y-auto bg-ui-page-alt p-3">
      {selectedMessages.map(m => <div key={m.id} className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm leading-7 shadow-sm ${m.role === 'customer' ? 'self-start bg-ui-surface' : 'self-end bg-ui-primary-soft'}`}>
       <p className="text-[11px] font-bold text-ui-muted">{m.role === 'customer' ? (ar ? 'العميل' : 'Customer')
        : m.role === 'employee' ? (ar ? 'موظف الدعم' : 'Human support') : 'AGENT'}</p>
       <p className="whitespace-pre-wrap break-words">{m.body}</p>
       <time className="block text-[10px] text-ui-subtle">{date(m.createdAt, ar)}</time>
      </div>)}
      {!selectedMessages.length && <p className="text-sm text-ui-subtle">{ar ? 'لا توجد رسائل.' : 'No messages.'}</p>}
     </div>
     <form onSubmit={e => { e.preventDefault(); void action('reply'); }}
      className="flex gap-2 border-t border-ui-border p-3">
      <input value={draft} onChange={event => setDraft(event.target.value)}
       disabled={selected.mode !== 'human' || saving}
       maxLength={2000} aria-label={ar ? 'رد موظف الدعم' : 'Staff reply'}
       placeholder={selected.mode === 'human' ? (ar ? 'اكتب ردك للعميل...' : 'Reply to customer...') : (ar ? 'استلم المحادثة أولًا للرد' : 'Take over to reply')}
       className="min-w-0 flex-1 rounded-xl border border-ui-border bg-ui-page px-3 py-2 text-sm disabled:opacity-60"/>
      <button type="submit" disabled={selected.mode !== 'human' || saving || !draft.trim()}
       className="inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
       <Send className="h-4 w-4" /> {ar ? 'إرسال' : 'Send'}
      </button>
     </form>
    </> : <p className="m-auto p-5 text-sm text-ui-muted">{ar ? 'اختر محادثة للمتابعة.' : 'Select a conversation.'}</p>}
   </div>
  </div>
  <p className="text-xs text-ui-subtle">{ar ? 'التحديث تلقائي كل 7 ثوانٍ. الوصول للمدير العام في Johna-S فقط، ولا يلزم تسجيل دخول منفصل إلى AGENT.' : 'Auto-refresh every 7 seconds; Johna-S superadmin authorization only.'}</p>
 </section>;
}
