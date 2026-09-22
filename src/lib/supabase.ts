import { createClient } from '@supabase/supabase-js';
import { postgrestDedupingFetch } from './postgrestDedupingFetch';

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ||
  'https://azzdesuowpdcoflmyezn.supabase.co';
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
  '';

if (!supabaseUrl) {
  throw new Error('Supabase URL is missing. Please set VITE_SUPABASE_URL.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey || 'placeholder-anon-key-for-build', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  global: {
    fetch: postgrestDedupingFetch,
  },
});

