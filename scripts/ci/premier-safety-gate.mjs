import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Keep this gate fast: no npm install, database connection, or browser startup.
// CI already runs the full verification suites on runtime changes.
const forbiddenAgentPath = /^(?:print-agent(?:-v[0-9]+)?|print_agent)(?:\/|$)/i;
const criticalPaths = [
  /^supabase\/(?:migrations|functions|ci)\//,
  /^\.github\/workflows\//,
  /^scripts\/(?:db|ci)\//,
  /^src\/.*(?:print|kitchen|order|shift|payment|auth|permission|inventory|stock|cost|account|warehouse|financial)/i,
];

export function evaluateSafety(paths, body) {
  const errors = [];
  const agentFiles = paths.filter(path => forbiddenAgentPath.test(path));
  if (agentFiles.length) {
    errors.push('Restaurant print-agent files are protected. Remove these edits; a separately authorized exception requires an explicit change to the safety policy.');
  }
  const highRisk = paths.some(path => criticalPaths.some(pattern => pattern.test(path)));
  if (highRisk) {
    for (const field of ['Impact', 'Verification', 'Rollback']) {
      const match = (body || '').match(new RegExp('^' + field + ':[ \t]*(.*)$', 'mi'));
      const value = match?.[1]?.trim() || '';
      if (value.length < 15 || /^(?:todo|tbd|none|n\/a|\[.*\]|<!--.*-->)$/i.test(value)) {
        errors.push('High-risk change requires a specific ' + field + ': declaration in the PR body.');
      }
    }
    const production = (body || '').match(/^Production status:[ \t]*(.*)$/mi)?.[1]?.trim();
    if (!['No production changes', 'Requires separate approval'].includes(production)) {
      errors.push('Set Production status: No production changes OR Requires separate approval.');
    }
  }
  return { highRisk, agentFiles, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
    console.log('Premier safety gate: PR-only; existing production gates remain in force.');
    process.exit(0);
  }
  const base = process.env.CI_SCOPE_BASE || '';
  if (!/^[a-f0-9]{40}$/.test(base) || !process.env.GITHUB_EVENT_PATH) {
    throw new Error('Missing trusted PR base SHA or GitHub event payload.');
  }
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const paths = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const result = evaluateSafety(paths, event.pull_request?.body || '');
  console.log('Premier safety gate: ' + paths.length + ' changed files, high-risk=' + result.highRisk);
  for (const error of result.errors) console.error('SAFETY GATE: ' + error);
  if (result.errors.length) process.exit(1);
}
