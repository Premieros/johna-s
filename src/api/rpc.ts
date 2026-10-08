import { supabase } from '@/lib/supabase';
import type { ApiError, ApiResult } from './types';

export const rpc = async <R>(name: string, args: object, signal?: AbortSignal): ApiResult<R> => {
  const query = (supabase.rpc as unknown as (n: string, a: object) => PromiseLike<{ data: unknown; error: ApiError | null }> & { abortSignal?: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: ApiError | null }> })(name, args);
  signal?.throwIfAborted();
  const res = await (signal && query.abortSignal ? query.abortSignal(signal) : query);
  return { data: (res.data as R | null) ?? null, error: res.error };
};
