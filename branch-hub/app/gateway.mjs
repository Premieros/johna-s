import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { validateLocalConfig } from './local-policy.mjs';

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function localBackend(value) {
  const url = new URL(value);
  // IP literals only: no DNS rebinding or remote backend configuration.
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Backend must be a loopback HTTP origin');
  return url.origin;
}
async function boundedBody(stream, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error('Body exceeds gateway limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// No executable default and no environment loading: enrollment must call this explicitly.
export async function createReadinessGateway({ publicConfig, authOrigin, restOrigin, staticDirectory }) {
  validateLocalConfig(publicConfig, 'http://127.0.0.1');
  const auth = localBackend(authOrigin), rest = localBackend(restOrigin);
  const root = await realpath(staticDirectory);
  const descriptor = { protocol: 1, mode: 'readiness-only', branchId: publicConfig.branchId, anonKey: publicConfig.anonKey };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const respond = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(req.socket.remoteAddress)) return respond(403, { error: 'LOCAL_PEER_REQUIRED' });
      if (req.headers.host !== new URL(origin).host) return respond(403, { error: 'LOCAL_HOST_REQUIRED' });
      if (req.headers.origin && req.headers.origin !== origin) return respond(403, { error: 'LOCAL_ORIGIN_REQUIRED' });
      const url = new URL(req.url, origin);
      if (url.pathname === '/local-config.json' && req.method === 'GET') return respond(200, descriptor);
      if (url.pathname.startsWith('/local-api/')) {
        const path = url.pathname.slice('/local-api'.length);
        const isAuthRead = req.method === 'GET' && ['/auth/v1/user', '/auth/v1/settings', '/auth/v1/health'].includes(path);
        const isAuthWrite = req.method === 'POST' && ['/auth/v1/token', '/auth/v1/logout'].includes(path);
        const isDataRead = ['GET', 'HEAD'].includes(req.method) && /^\/rest\/v1\/[a-z_][a-z0-9_]*$/.test(path);
        if (!isAuthRead && !isAuthWrite && !isDataRead) return respond(403, { error: 'LOCAL_BUSINESS_WRITES_DISABLED' });
        if (isAuthWrite && req.headers.origin !== origin) return respond(403, { error: 'LOCAL_ORIGIN_REQUIRED' });
        if (path === '/auth/v1/token' && !['password', 'refresh_token'].includes(url.searchParams.get('grant_type'))) return respond(403, { error: 'LOCAL_AUTH_FLOW_DISABLED' });
        const headers = { apikey: descriptor.anonKey, 'content-type': 'application/json' };
        if (req.headers.authorization) headers.authorization = req.headers.authorization;
        // Do not forward cookies, Host, arbitrary profile headers or service credentials.
        const body = isAuthWrite ? await boundedBody(req, 65536) : undefined;
        const target = isDataRead ? rest + path.slice('/rest/v1'.length) : auth + path.slice('/auth/v1'.length);
        const upstream = await fetch(target + url.search, { method: req.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(10000) });
        const bytes = upstream.body ? await boundedBody(upstream.body, 2 * 1024 * 1024) : Buffer.alloc(0);
        res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' });
        return res.end(bytes);
      }
      if (!['GET', 'HEAD'].includes(req.method)) return respond(405, { error: 'METHOD_DISABLED' });
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { return respond(400, { error: 'INVALID_PATH' }); }
      if (pathname.includes('\0') || pathname.includes('\\')) return respond(400, { error: 'INVALID_PATH' });
      const file = await realpath(resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname)));
      if (!file.startsWith(root + sep)) return respond(403, { error: 'INVALID_PATH' });
      const type = TYPES[extname(file)];
      if (!type) return respond(404, { error: 'NOT_FOUND' });
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': type }); res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      // Never disclose upstream credentials, passwords, paths or internal errors.
      if (!res.headersSent) respond(503, { error: 'LOCAL_SERVICE_UNAVAILABLE' }); else res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 40;
  return server;
}
