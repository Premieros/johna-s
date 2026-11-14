// Lexical source inventory, not a live catalog or a dependency/parity proof.
// Reads repository files only. Never reads .env, credentials or a database.
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../../', import.meta.url));
function files(directory, pattern) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const path = join(directory, item.name);
    return item.isDirectory() ? files(path, pattern) : pattern.test(item.name) ? [path] : [];
  }).sort();
}
const source = files(join(root, 'src'), /\.(ts|tsx)$/);
const migrations = files(join(root, 'supabase/migrations'), /\.sql$/);
const report = {
  format: 1,
  repository: 'Premieros/johna-s',
  limitations: 'Lexical references only; dynamic SQL, ALTER/DROP and overload resolution require manual/catalog review. No production connection or complete dependency proof.',
  sources: [], rpcCalls: [], literalFromTargets: [],
  migrationFiles: migrations.length, functionCreateStatements: 0, triggerCreateStatements: 0,
  extensions: [], sqlFeatures: {},
};
for (const path of source) {
  const text = readFileSync(path, 'utf8');
  const file = relative(root, path).replaceAll('\\', '/');
  const before = report.rpcCalls.length + report.literalFromTargets.length;
  for (const match of text.matchAll(/\brpc(?:<[\s\S]{0,600}?>)?\(\s*['"]([a-z][a-z0-9_]*)['"]/g)) {
    report.rpcCalls.push({ name: match[1], file, line: text.slice(0, match.index).split('\n').length });
  }
  for (const match of text.matchAll(/\.from\(\s*['"]([a-z][a-z0-9_]*)['"]/g)) {
    report.literalFromTargets.push({ name: match[1], file, line: text.slice(0, match.index).split('\n').length });
  }
  if (before !== report.rpcCalls.length + report.literalFromTargets.length) report.sources.push({ file, sha256: createHash('sha256').update(text).digest('hex') });
}
const extensions = new Set();
const features = {
  jsonb: /\bjsonb\b/i, numeric: /\bnumeric\b/i, row_locks: /\bFOR\s+(?:NO\s+KEY\s+)?UPDATE\b/i,
  advisory_locks: /\bpg_(?:try_)?advisory_/i, auth_uid: /\bauth\.uid\s*\(/i,
  security_definer: /\bSECURITY\s+DEFINER\b/i, cloud_http: /\bnet\.http_/i,
  scheduling: /\bcron\./i,
};
for (const path of migrations) {
  const text = readFileSync(path, 'utf8');
  report.functionCreateStatements += [...text.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/gi)].length;
  report.triggerCreateStatements += [...text.matchAll(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\b/gi)].length;
  for (const match of text.matchAll(/\bCREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z0-9_-]+)/gi)) extensions.add(match[1].toLowerCase());
  for (const [name, pattern] of Object.entries(features)) if (pattern.test(text)) report.sqlFeatures[name] = (report.sqlFeatures[name] || 0) + 1;
}
report.extensions = [...extensions].sort();
report.distinctRpcNames = new Set(report.rpcCalls.map(item => item.name)).size;
report.distinctFromTargets = new Set(report.literalFromTargets.map(item => item.name)).size;
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node branch-hub/tools/audit-source.mjs [--out path]');
if (args.length) {
  mkdirSync(dirname(args[1]), { recursive: true });
  writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ distinctRpcNames: report.distinctRpcNames, distinctFromTargets: report.distinctFromTargets, migrationFiles: report.migrationFiles, extensions: report.extensions, output: args[1] }));
} else console.log(JSON.stringify(report, null, 2));
