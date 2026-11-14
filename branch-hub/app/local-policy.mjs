// Public configuration only. Secrets and backend addresses never belong here.
export function validateLocalConfig(config, origin) {
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('Local pilot requires a loopback address');
  }
  if (config?.protocol !== 1 || config?.mode !== 'readiness-only' ||
      config?.branchId !== '0a54e71b-5ac1-42ec-a620-f0296637e79c' ||
      typeof config?.anonKey !== 'string' || config.anonKey.length < 20) {
    throw new Error('Local pilot configuration is missing or incompatible');
  }
  // Legacy JWT anon keys only for this isolated pilot; reject privileged keys.
  let claims;
  try { claims = JSON.parse(atob(config.anonKey.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { throw new Error('Invalid local anon key'); }
  if (claims.role !== 'anon') throw new Error('Only a public anon key is allowed');
  return Object.freeze({ url: `${url.origin}/local-api`, anonKey: config.anonKey, branchId: config.branchId });
}

export function localOnlyFetch(origin, fetchImpl) {
  return async (input, init) => {
    const requestUrl = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, origin);
    if (requestUrl.origin !== origin || !requestUrl.pathname.startsWith('/local-api/')) {
      throw new Error('Local API request outside the enrolled gateway');
    }
    return fetchImpl(input, { ...init, redirect: 'error' });
  };
}
