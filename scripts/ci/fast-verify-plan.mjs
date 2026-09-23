#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const run = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function resolveBase() {
  const explicit = process.env.FAST_VERIFY_BASE_SHA?.trim();
  if (explicit) return explicit;
  try {
    return run(['merge-base', 'HEAD', 'origin/main']);
  } catch {
    try {
      return run(['rev-parse', 'HEAD^']);
    } catch {
      return run(['rev-parse', 'HEAD']);
    }
  }
}

const base = resolveBase();
const diff = run(['diff', '--name-only', base + '...HEAD']);
const changed = diff.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);

const matches = (file, patterns) => patterns.some((re) => re.test(file));

const appPatterns = [
  /^src\//,
  /^tests\/(unit|components)\//,
  /^package(-lock)?\.json$/,
  /^tsconfig.*\.json$/,
  /^vite\.config\./,
  /^eslint\.config\./,
  /^supabase\/api-contract\.json$/,
  /^scripts\/db\/gen-contract\.js$/,
];

const dbPatterns = [
  /^supabase\/migrations\//,
  /^supabase\/ci\//,
  /^tests\/integration\//,
  /^scripts\/db\//,
];

const appChanged = changed.some((file) => matches(file, appPatterns));
const dbChanged = changed.some((file) => matches(file, dbPatterns));

const integrationTests = changed
  .filter((file) => /^tests\/integration\/.*\.test\.(ts|tsx|js|jsx)$/.test(file))
  .sort();

const unitTests = changed
  .filter((file) => /^tests\/(unit|components)\/.*\.test\.(ts|tsx|js|jsx)$/.test(file))
  .sort();

const output = process.env.GITHUB_OUTPUT;
if (!output) {
  console.log(JSON.stringify({ base, changed, appChanged, dbChanged, integrationTests, unitTests }, null, 2));
  process.exit(0);
}

const write = (key, value) => appendFileSync(output, key + '=' + value + '\n');
write('base_sha', base);
write('app_changed', String(appChanged));
write('db_changed', String(dbChanged));
write('integration_tests', integrationTests.join(' '));
write('unit_tests', unitTests.join(' '));
write('changed_count', String(changed.length));

console.log('Fast Verify base: ' + base);
console.log('Changed files: ' + changed.length);
for (const file of changed) console.log(' - ' + file);
console.log('App checks: ' + appChanged);
console.log('DB checks: ' + dbChanged);
console.log('Targeted integration tests: ' + (integrationTests.length ? integrationTests.join(', ') : '(none)'));
