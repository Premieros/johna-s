import { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { SUPPORT_ENABLED } from './protocol';
const Widget = lazy(() => import('./SupportWidget'));
export function SupportLauncher() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!SUPPORT_ENABLED || !user) return;
    let taps: number[] = [];
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Control' || event.repeat || (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable="true"]'))) return;
      taps = [...taps.filter(t => Date.now() - t < 2500), Date.now()];
      if (taps.length === 5) { taps = []; setOpen(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [user]);
  if (!SUPPORT_ENABLED || !user) return null;
  return <><button aria-label="الدعم المباشر" className="fixed bottom-4 end-4 z-[75] rounded-full bg-ui-primary px-4 py-3 text-white shadow-ui-lg" onClick={() => setOpen(true)}>الدعم</button>{open && <Suspense fallback={<p role="status" className="fixed bottom-20 end-4 z-[80] rounded bg-ui-surface p-3">جارٍ فتح الدعم…</p>}><Widget key={user.id} onClose={() => setOpen(false)} /></Suspense>}</>;
}
