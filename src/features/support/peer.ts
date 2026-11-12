import { signal } from './service';
/** ICE config is supplied at deployment; TURN credentials must be short-lived. */
export function createSupportPeer(sessionId: string, onFailure: () => void) {
  const configured = import.meta.env.VITE_LIVE_SUPPORT_ICE_SERVERS as string | undefined;
  const iceServers = configured ? JSON.parse(configured) as RTCIceServer[] : [];
  const peer = new RTCPeerConnection({ iceServers });
  peer.onicecandidate = event => { if (event.candidate) void signal(sessionId, { type: 'ice', candidate: event.candidate.toJSON() }).catch(onFailure); };
  peer.onconnectionstatechange = () => { if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) onFailure(); };
  return peer;
}
type CaptureDevices = MediaDevices & { setCaptureHandleConfig?: (value: { handle: string; exposeOrigin: boolean; permittedOrigins: string[] }) => void };
type CaptureTrack = MediaStreamTrack & { getCaptureHandle?: () => { handle: string; origin?: string } | null };
/** Fail closed: selecting a different tab, window or monitor stops capture. */
export async function captureOwnTab(onStop: () => void): Promise<MediaStream> {
  const devices = navigator.mediaDevices as CaptureDevices;
  if (!devices?.setCaptureHandleConfig) throw new Error('يلزم Chrome أو Edge يدعم مشاركة التبويب والتحقق من هويته');
  const handle = crypto.randomUUID();
  devices.setCaptureHandleConfig({ handle, exposeOrigin: true, permittedOrigins: [location.origin] });
  const stream = await devices.getDisplayMedia({ video: { frameRate: { max: 10 }, width: { max: 1600 } }, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions);
  const track = stream.getVideoTracks()[0] as CaptureTrack;
  const valid = () => track.getSettings().displaySurface === 'browser' && track.getCaptureHandle?.()?.handle === handle && track.getCaptureHandle?.()?.origin === location.origin;
  if (!valid()) { stream.getTracks().forEach(t => t.stop()); throw new Error('اختر تبويب Johna’s الحالي فقط'); }
  track.addEventListener('ended', onStop, { once: true });
  track.addEventListener('capturehandlechange', () => { if (!valid()) { stream.getTracks().forEach(t => t.stop()); onStop(); } });
  return stream;
}
