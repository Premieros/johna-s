import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

// Fail closed: only this small documentation allowlist may skip runtime checks.
export function classifyPaths(paths, event = 'push') {
  const docsOnly = paths.length > 0 && paths.every(path =>
    /^docs\/[^\0]+\.md$/.test(path) || /^(README|CHANGELOG)\.md$/.test(path));
  return !(docsOnly && ['push', 'pull_request'].includes(event));
}
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const output = runtime => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `runtime=${runtime}\n`);
};
export function verifyPlan(plan, expectedSha) {
  if (plan.version !== 1 || !/^[a-f0-9]{40}$/.test(expectedSha || '') || plan.sha !== expectedSha
    || typeof plan.event !== 'string' || typeof plan.runtime !== 'boolean' || !Array.isArray(plan.paths)
    || plan.paths.some(path => typeof path !== 'string')
    || (plan.runtime === false && classifyPaths(plan.paths, plan.event))) {
    throw new Error('INVALID_VERIFIED_SCOPE_PLAN');
  }
  return plan.runtime;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, file] = process.argv.slice(2);
  if (mode === 'plan') {
    const sha = git(['rev-parse', 'HEAD']);
    const base = process.env.CI_SCOPE_BASE || '';
    let paths = [];
    let runtime = true;
    // No base (manual run/new branch) => full verification, never a guessed skip.
    if (/^[a-f0-9]{40}$/.test(base) && !/^0+$/.test(base)) {
      paths = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean);
      runtime = classifyPaths(paths, process.env.GITHUB_EVENT_NAME);
    }
    const plan = { version: 1, sha, event: process.env.GITHUB_EVENT_NAME, runtime, paths };
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(plan));
    output(runtime);
    console.log(JSON.stringify(plan));
  } else if (mode === 'verify') {
    const runtime = verifyPlan(JSON.parse(readFileSync(file, 'utf8')), process.env.VERIFIED_SHA);
    output(runtime);
    console.log(`Verified source scope: runtime=${runtime}`);
  } else throw new Error('Expected plan|verify and a plan file');
}
