import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLocalConfig, localOnlyFetch } from '../app/local-policy.mjs';

const config = (role = 'anon') => ({ protocol: 1, mode: 'readiness-only', branchId: '0a54e71b-5ac1-42ec-a620-f0296637e79c', anonKey: `header.${btoa(JSON.stringify({ role }))}.signature` });
test('local settings reject production origins, missing enrollment and privileged keys', () => {
  assert.equal(validateLocalConfig(config(), 'http://127.0.0.1:58120').url, 'http://127.0.0.1:58120/local-api');
  for (const origin of ['https://azzdesuowpdcoflmyezn.supabase.co', 'http://192.168.1.4', 'file:///tmp/index.html']) assert.throws(() => validateLocalConfig(config(), origin));
  for (const value of [{}, { ...config(), branchId: 'another-branch' }, config('service_role')]) assert.throws(() => validateLocalConfig(value, 'http://localhost:58120'));
});
test('SDK transport blocks cloud requests and redirects before sending', async () => {
  const sent = [];
  const fetch = localOnlyFetch('http://localhost:58120', async (...args) => { sent.push(args); return new Response('{}'); });
  for (const url of ['https://azzdesuowpdcoflmyezn.supabase.co/auth/v1/token', '/outside', '/local-api-evil/auth']) await assert.rejects(fetch(url));
  assert.equal(sent.length, 0);
  await fetch('http://localhost:58120/local-api/auth/v1/token', { method: 'POST' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].redirect, 'error');
});
