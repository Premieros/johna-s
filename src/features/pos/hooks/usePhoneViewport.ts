import { useEffect, useState } from 'react';

/** Match Tailwind's phone-only range; tablet and desktop retain their current UI. */
export function usePhoneViewport() {
  const [phone, setPhone] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 639px)');
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return phone;
}
