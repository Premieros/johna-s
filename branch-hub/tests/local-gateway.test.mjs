import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadinessGateway } from '../app/gateway.mjs';

const publicConfig = { protocol: 1, mode: 'readiness-only', branchId: '0a54e71b-5ac1-42ec-a620-f0296637e79c', anonKey: `header.${btoa(JSON.stringify({ role: 'anon' }))}.signature` };
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

test('gateway proxies only real local auth routes and table reads, never business writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'johnas-gateway-'));
  await writeFile(join(root, 'index.html'), '<html>Original app fixture</html>');
  const requests = [];
  const backend = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url === '/user?redirect-test=1') { res.writeHead(302, { location: 'https://example.invalid/' }); return res.end(); }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ backendResponse: true }));
  });
  const backendOrigin = await listen(backend);
  const gateway = await createReadinessGateway({ publicConfig, authOrigin: backendOrigin, restOrigin: backendOrigin, staticDirectory: root });
  const origin = await listen(gateway);
  t.after(async () => { await close(gateway); await close(backend); await rm(root, { recursive: true, force: true }); });
  const descriptor = await (await fetch(origin + '/local-config.json')).json();
  assert.deepEqual(descriptor, publicConfig);
  const page = await fetch(origin);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.match(await page.text(), /Original app fixture/);
  const login = await fetch(origin + '/local-api/auth/v1/token?grant_type=password', { method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'do-not-forward=value' }, body: JSON.stringify({ email: 'synthetic@example.invalid', password: 'synthetic-test-only' }) });
  assert.equal(login.status, 200);
  assert.deepEqual(await login.json(), { backendResponse: true });
  assert.equal(requests[0].url, '/token?grant_type=password');
  assert.equal(requests[0].headers.cookie, undefined);
  assert.equal(requests[0].headers.apikey, publicConfig.anonKey);
  await fetch(origin + '/local-api/rest/v1/users?id=eq.fixture', { headers: { authorization: 'Bearer synthetic-access-token' } });
  assert.equal(requests[1].headers.authorization, 'Bearer synthetic-access-token');
  assert.equal(requests[1].url, '/users?id=eq.fixture');
  for (const path of ['/local-api/rest/v1/rpc/process_sale', '/local-api/rest/v1/sales', '/local-api/auth/v1/admin/users', '/local-api/auth/v1/signup', '/local-api/auth/v1/token?grant_type=client_credentials']) {
    assert.equal((await fetch(origin + path, { method: 'POST', headers: { origin }, body: '{}' })).status, 403);
  }
  assert.equal((await fetch(origin + '/local-api/rest/v1/rpc/process_sale')).status, 403);
  assert.equal((await fetch(origin + '/local-api/auth/v1/token?grant_type=password', { method: 'POST', body: '{}' })).status, 403);
  assert.equal((await fetch(origin + '/local-api/auth/v1/user', { headers: { origin: 'https://foreign.invalid' } })).status, 403);
  assert.equal(requests.length, 2);
  assert.equal((await fetch(origin + '/local-api/auth/v1/user?redirect-test=1')).status, 503);
  await close(backend);
  const offline = await fetch(origin + '/local-api/auth/v1/user');
  assert.equal(offline.status, 503);
  assert.deepEqual(await offline.json(), { error: 'LOCAL_SERVICE_UNAVAILABLE' });
});

test('gateway rejects remote upstreams and symlinks escaping the static build', async t => {
  const root = await mkdtemp(join(tmpdir(), 'johnas-gateway-path-'));
  const outside = await mkdtemp(join(tmpdir(), 'johnas-gateway-private-'));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const options = { publicConfig, authOrigin: 'http://127.0.0.1:1', restOrigin: 'http://127.0.0.1:2', staticDirectory: root };
  for (const authOrigin of ['https://azzdesuowpdcoflmyezn.supabase.co', 'http://localhost:8000', 'http://127.0.0.1:8000/auth']) await assert.rejects(createReadinessGateway({ ...options, authOrigin }));
  await writeFile(join(outside, 'private.json'), '{"secret":"must-not-leak"}');
  // File symlinks may require elevated privileges on Windows; directory junctions do not.
  await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const gateway = await createReadinessGateway(options);
  const origin = await listen(gateway); t.after(() => close(gateway));
  const escaped = await fetch(origin + '/escape/private.json');
  assert.equal(escaped.status, 403);
  assert.doesNotMatch(await escaped.text(), /must-not-leak/);
});
