import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useActiveBranchId } from '@/lib/activeBranch';
import { useCan } from '@/lib/permissions';
import { audit, changeSession, readSession, readSignals, signal } from './service';
import { createSupportPeer, captureOwnTab } from './peer';
import { parseSupportCommand, sessionIsLive, SUPPORT_ROUTES, type SupportSession } from './protocol';

export default function SupportSessionView({ initial, viewer, onEnd }: { initial: SupportSession; viewer: boolean; onEnd: () => void }) {
  const { user } = useAuth();
  const [branchId] = useActiveBranchId();
  const can = useCan();
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState(initial);
  const [status, setStatus] = useState('في انتظار موافقة الموظف على مشاركة التبويب');
  const [error, setError] = useState('');
  const [controlAsked, setControlAsked] = useState(false);
  const [controlEnabled, setControlEnabled] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const control = useRef(false);
  const ended = useRef(false);
  const consentEpoch = useRef(0);
  const path = useRef(location.pathname);
  const navigateRef = useRef(navigate);
  const onEndRef = useRef(onEnd);
  navigateRef.current = navigate;
  onEndRef.current = onEnd;
  path.current = location.pathname;
  const allowed = viewer ? can('support.manage') && user?.id === initial.operator_id : user?.id === initial.requester_id && branchId === initial.branch_id;
  const stopRef = useRef<() => void>(() => {});
  function stopLocal() {
    control.current = false;
    ++consentEpoch.current;
    ended.current = true;
    channel.current?.close(); channel.current = null;
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    const oldPeer = peer.current; peer.current = null;
    if (oldPeer) { oldPeer.onconnectionstatechange = null; oldPeer.close(); }
    if (video.current) video.current.srcObject = null;
  }
  stopRef.current = () => {
    if (ended.current) return;
    stopLocal();
    void changeSession(initial.id, { state: 'closed' }).catch(() => {});
    onEndRef.current();
  };
  useEffect(() => {
    if (!allowed || !user || !sessionIsLive(initial)) { stopRef.current(); return; }
    ended.current = false;
    let cancelled = false;
    let cursor = 0;
    let reading = false;
    const candidates: RTCIceCandidateInit[] = [];
    const pendingDescriptions: RTCSessionDescriptionInit[] = [];
    const fail = () => { if (!cancelled) { setError('انقطع الاتصال؛ أُوقفت المشاركة والتحكم'); stopRef.current(); } };
    let connection: RTCPeerConnection;
    try { connection = createSupportPeer(initial.id, fail); } catch { fail(); return; }
    peer.current = connection;
    function attach(dc: RTCDataChannel) {
      channel.current = dc;
      dc.onopen = () => setStatus('متصل — المشاهدة بموافقة الموظف');
      dc.onclose = fail;
      dc.onmessage = event => {
        if (cancelled || ended.current || typeof event.data !== 'string' || event.data.length > 512) return;
        if (viewer) {
          if (event.data === 'control-granted') setControlEnabled(true);
          if (event.data === 'control-revoked') setControlEnabled(false);
          return;
        }
        if (event.data === 'request-control') { if (stream.current) setControlAsked(true); return; }
        if (!control.current || !SUPPORT_ROUTES.has(path.current)) return;
        const command = parseSupportCommand(event.data);
        if (command?.type === 'navigate') navigateRef.current(command.path);
        if (command?.type === 'scroll') window.scrollBy({ top: command.delta, behavior: 'smooth' });
      };
    }
    if (viewer) {
      attach(connection.createDataChannel('support-navigation'));
      connection.ontrack = event => { if (video.current) { video.current.srcObject = new MediaStream([event.track]); void video.current.play().catch(() => {}); } };
      connection.addTransceiver('video', { direction: 'recvonly' });
      void (async () => { const offer = await connection.createOffer(); await connection.setLocalDescription(offer); if (!cancelled) await signal(initial.id, { type: 'offer', sdp: offer }); })().catch(fail);
    } else connection.ondatachannel = event => attach(event.channel);
    async function consumeOffer(description: RTCSessionDescriptionInit) {
      await connection.setRemoteDescription(description);
      const sender = connection.getTransceivers().find(t => t.receiver.track.kind === 'video')?.sender;
      if (sender && stream.current) { sender.setStreams(stream.current); await sender.replaceTrack(stream.current.getVideoTracks()[0]); }
      for (const candidate of candidates.splice(0)) await connection.addIceCandidate(candidate);
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      await signal(initial.id, { type: 'answer', sdp: answer });
    }
    async function poll() {
      if (reading || cancelled) return;
      reading = true;
      try {
        const next = await readSession(initial.id);
        if (cancelled) return;
        if (!sessionIsLive(next) || next.operator_id !== initial.operator_id) { stopRef.current(); return; }
        setSession(next);
        const messages = await readSignals(initial.id, cursor, user!.id);
        if (cancelled) return;
        for (const message of messages) {
          cursor = Math.max(cursor, message.id);
          const payload = message.payload;
          if (payload.type === 'offer' && !viewer && payload.sdp) {
            if (stream.current) await consumeOffer(payload.sdp);
            else pendingDescriptions.push(payload.sdp);
          } else if (payload.type === 'answer' && viewer && payload.sdp && !connection.remoteDescription) {
            await connection.setRemoteDescription(payload.sdp);
            for (const candidate of candidates.splice(0)) await connection.addIceCandidate(candidate);
          } else if (payload.type === 'ice' && payload.candidate) {
            if (connection.remoteDescription) await connection.addIceCandidate(payload.candidate);
            else if (candidates.length < 100) candidates.push(payload.candidate);
          }
        }
        if (!viewer && stream.current && pendingDescriptions.length && !connection.remoteDescription) await consumeOffer(pendingDescriptions.shift()!);
      } catch { fail(); } finally { reading = false; }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    const expiry = window.setTimeout(() => stopRef.current(), Math.max(0, Date.parse(initial.expires_at) - Date.now()));
    const unload = () => stopLocal();
    const privacy = new MutationObserver(() => { if (stream.current && document.querySelector('input[type="password"], [data-support-private]')) stopRef.current(); });
    privacy.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['type', 'data-support-private'] });
    window.addEventListener('pagehide', unload);
    return () => { cancelled = true; privacy.disconnect(); clearInterval(timer); clearTimeout(expiry); window.removeEventListener('pagehide', unload); stopLocal(); };
  }, [initial.id, initial.operator_id, initial.branch_id, initial.expires_at, initial, user, allowed, viewer]);

  useEffect(() => {
    if (!viewer && !SUPPORT_ROUTES.has(location.pathname)) {
      control.current = false;
      setControlEnabled(false);
      if (channel.current?.readyState === 'open') channel.current.send('control-revoked');
      if (stream.current) stopRef.current();
    }
  }, [location.pathname, viewer]);

  async function share() {
    if (busy || !SUPPORT_ROUTES.has(path.current)) return;
    if (document.querySelector('input[type="password"], [data-support-private]')) { setError('أغلق الحقول الخاصة قبل المشاركة'); return; }
    const epoch = consentEpoch.current;
    setBusy(true); setError('');
    try {
      const media = await captureOwnTab(() => stopRef.current());
      if (epoch !== consentEpoch.current || ended.current || !SUPPORT_ROUTES.has(path.current) || document.querySelector('input[type="password"], [data-support-private]')) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const sender = peer.current?.getTransceivers().find(t => t.receiver.track.kind === 'video')?.sender;
      // The viewer's offer may arrive after the user grants capture.
      if (sender) await sender.replaceTrack(media.getVideoTracks()[0]);
      else peer.current?.addTrack(media.getVideoTracks()[0], media);
      await audit(initial.id, 'view_granted');
      setSession(await changeSession(initial.id, { state: 'sharing' }));
      setSharing(true); setStatus('المشاركة نشطة — الدعم يشاهد هذا التبويب فقط');
    } catch (e) { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setError(e instanceof Error ? e.message : 'تعذر بدء المشاركة'); }
    finally { setBusy(false); }
  }
  async function grantControl() {
    const epoch = ++consentEpoch.current;
    try {
      await audit(initial.id, 'control_granted');
      if (epoch !== consentEpoch.current || ended.current || !sharing || !stream.current || !SUPPORT_ROUTES.has(path.current) || channel.current?.readyState !== 'open') return;
      control.current = true; setControlEnabled(true); setControlAsked(false); channel.current.send('control-granted');
    } catch { setError('تعذر تسجيل موافقة التحكم'); }
  }
  function revoke() {
    ++consentEpoch.current;
    control.current = false; setControlEnabled(false); setControlAsked(false);
    if (channel.current?.readyState === 'open') channel.current.send('control-revoked');
    void audit(initial.id, 'control_revoked').catch(() => {});
  }
  function send(value: string) { if (channel.current?.readyState === 'open') channel.current.send(value); }
  return <section dir="rtl" className="space-y-3 rounded-2xl border border-ui-primary bg-ui-surface p-4 shadow-ui-lg" aria-label="جلسة الدعم المباشر">
    <div className="flex justify-between gap-3"><strong>الدعم المباشر · {session.id.slice(0, 8)}</strong><button className="rounded-lg bg-ui-danger px-3 py-2 text-white" onClick={() => stopRef.current()}>إنهاء الجلسة فورًا</button></div>
    <p role="status">{status}</p><p>المدير المتصل: {session.operator_name || session.operator_id?.slice(0, 8)}</p><p className="text-xs text-ui-muted">تنتهي الجلسة خلال 20 دقيقة. لا تسجيل للشاشة. التحكم في هذه النسخة للتنقل والتمرير فقط؛ البيع والطباعة والتعديل محظورة.</p>
    {error && <p role="alert" className="text-ui-danger">{error}</p>}
    {viewer ? <>
      <video ref={video} autoPlay playsInline muted className="max-h-[60vh] w-full rounded-xl bg-black" aria-label="تبويب الموظف المباشر" />
      <button className="rounded-lg border p-2" disabled={session.state !== 'sharing'} onClick={() => { send('request-control'); void audit(initial.id, 'control_requested').catch(() => {}); }}>طلب التحكم</button>
      <p>{controlEnabled ? 'الموظف سمح بالتحكم' : 'المشاهدة فقط — التحكم يحتاج موافقة الموظف'}</p>
      {controlEnabled && <div className="flex flex-wrap gap-2">{[...SUPPORT_ROUTES].map(route => <button className="rounded border p-2" key={route} onClick={() => send(JSON.stringify({ type: 'navigate', path: route }))}>{route}</button>)}<button onClick={() => send(JSON.stringify({ type: 'scroll', delta: -500 }))}>تمرير لأعلى</button><button onClick={() => send(JSON.stringify({ type: 'scroll', delta: 500 }))}>تمرير لأسفل</button></div>}
    </> : <>
      {!sharing && <button className="rounded-lg bg-ui-primary p-3 text-white" disabled={busy || !session.operator_id || !SUPPORT_ROUTES.has(location.pathname)} onClick={() => void share()}>أوافق على المشاهدة — مشاركة التبويب الحالي</button>}
      {!SUPPORT_ROUTES.has(location.pathname) && <p>المشاركة متوقفة في هذه الصفحة لحماية الإجراءات الحساسة. افتح لوحة التحكم أولًا.</p>}
      {controlAsked && !controlEnabled && <div><p>الدعم يطلب التحكم في التنقل والتمرير. هل توافق؟</p><button onClick={() => void grantControl()}>السماح بالتحكم</button><button onClick={() => setControlAsked(false)}>رفض</button></div>}
      {controlEnabled && <button className="rounded border p-2" onClick={revoke}>إيقاف التحكم والإبقاء على المشاهدة</button>}
    </>}
  </section>;
}
