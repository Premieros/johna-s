import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureOwnTab } from '@/features/support/peer';
vi.mock('@/features/support/service', () => ({ signal: vi.fn() }));
const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
afterEach(() => { if (original) Object.defineProperty(navigator,'mediaDevices',original); else Reflect.deleteProperty(navigator,'mediaDevices'); });
function fixture(kind = 'browser', same = true) {
  let handle = ''; let current = same;
  const stop = vi.fn(); const listeners: Record<string, () => void> = {};
  const track = { stop, getSettings: () => ({displaySurface: kind}), getCaptureHandle: () => ({handle: current ? handle : 'another-tab', origin: location.origin}), addEventListener: (event: string, callback: () => void) => { listeners[event] = callback; } };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const getDisplayMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator,'mediaDevices',{ configurable:true,value:{setCaptureHandleConfig: (config: {handle:string}) => {handle=config.handle;},getDisplayMedia}});
  return {stop,stream,listeners,getDisplayMedia,changeTab: () => { current=false; listeners.capturehandlechange(); }};
}
describe('support current-tab identity gate', () => {
  it('rejects unsupported capture before requesting any media', async () => {
    const capture = vi.fn(); Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getDisplayMedia:capture}});
    await expect(captureOwnTab(vi.fn())).rejects.toThrow(); expect(capture).not.toHaveBeenCalled();
  });
  it.each(['monitor','window'])('stops %s capture immediately', async kind => {
    const f=fixture(kind); await expect(captureOwnTab(vi.fn())).rejects.toThrow(); expect(f.stop).toHaveBeenCalledOnce();
  });
  it('rejects another browser tab', async () => {
    const f=fixture('browser',false); await expect(captureOwnTab(vi.fn())).rejects.toThrow(); expect(f.stop).toHaveBeenCalledOnce();
  });
  it('accepts only the matching tab and stops on later identity change', async () => {
    const f=fixture(); const onStop=vi.fn(); expect(await captureOwnTab(onStop)).toBe(f.stream);
    expect(f.getDisplayMedia.mock.calls[0][0].audio).toBe(false);
    f.changeTab(); expect(f.stop).toHaveBeenCalledOnce(); expect(onStop).toHaveBeenCalledOnce();
  });
});
