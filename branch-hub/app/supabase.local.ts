import { createClient } from '@supabase/supabase-js';
// @ts-expect-error Standalone runtime policy is also exercised by native Node tests.
import { validateLocalConfig, localOnlyFetch } from './local-policy.mjs';

const response = await fetch('/local-config.json', { cache: 'no-store', redirect: 'error' });
if (!response.ok) throw new Error('لم يتم تجهيز اتصال النسخة المحلية بعد.');
const config = validateLocalConfig(await response.json(), window.location.origin);

// Real GoTrue authentication only: no fabricated sessions, users, or permission claims.
export const supabase = createClient(config.url, config.anonKey, {
  auth: {
    storageKey: `johnas-local-${config.branchId}-auth-v1`,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
  global: { fetch: localOnlyFetch(window.location.origin, window.fetch.bind(window)) },
});
