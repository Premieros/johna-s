import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { join } from 'node:path';

const root = process.argv[2] || 'dist-local';
const html = await readFile(join(root, 'index.html'), 'utf8');
assert.match(html, /Content-Security-Policy/);
assert.match(html, /connect-src 'self'/);
assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/);
let foundLocal = false;
for (const name of await readdir(join(root, 'assets'))) {
  if (!name.endsWith('.js')) continue;
  const text = await readFile(join(root, 'assets', name), 'utf8');
  assert.doesNotMatch(text, /azzdesuowpdcoflmyezn\.supabase\.co/, `Cloud client leaked into ${name}`);
  if (text.includes('/local-config.json')) foundLocal = true;
}
assert.ok(foundLocal, 'The original application did not include the local client');
console.log('PASS: original app includes local client, CSP and no production client endpoint');
