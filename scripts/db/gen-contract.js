#!/usr/bin/env node
// ============================================================================
// Generates the frontend schema contract: the exact RPC calls (name + params)
// and supabase.from() table reads the frontend makes, in a single committed
// JSON file. This is the single source of truth that the parity gate
// (check-production-parity.js) and verify-schema.js consume, so the contract
// can never silently drift from the code.
//
//   node scripts/db/gen-contract.js [--check]
//
// Writes: supabase/api-contract.json
//   --check  exits 1 if the committed contract is stale (used by CI).
// ============================================================================

import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(__dirname, '..', '..');
const CONTRACT_FILE = join(ROOT, 'supabase', 'api-contract.json');
const checkMode = process.argv.includes('--check');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function readObjectBlock(content, openBracePos, endLimit = content.length) {
  let braceCount = 0;
  for (let i = openBracePos; i < endLimit; i++) {
    if (content[i] === '{') braceCount++;
    else if (content[i] === '}') {
      braceCount--;
      if (braceCount === 0) return content.slice(openBracePos + 1, i);
    }
  }
  return null;
}

function extractParamNames(paramBlock) {
  return [...new Set([...paramBlock.matchAll(/p_([\w]+)(?=\s*\??\s*:)/g)].map((x) => x[1]))].sort();
}

function resolveMethodParamBlock(content, matchIndex) {
  const textBefore = content.slice(0, matchIndex);
  const methodMatches = [...textBefore.matchAll(/(?:async\s+)?\w+\s*\(\s*p\s*:\s*(\{|[A-Za-z_$][\w$]*)/g)];
  if (methodMatches.length === 0) return null;

  const methodMatch = methodMatches[methodMatches.length - 1];
  const typeToken = methodMatch[1];

  if (typeToken === '{') {
    const openBracePos = methodMatch.index + methodMatch[0].lastIndexOf('{');
    return readObjectBlock(content, openBracePos, matchIndex);
  }

  const escapedType = typeToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const typePatterns = [
    new RegExp(`(?:export\\s+)?type\\s+${escapedType}\\s*=\\s*\\{`),
    new RegExp(`(?:export\\s+)?interface\\s+${escapedType}\\s*\\{`),
  ];
  for (const pattern of typePatterns) {
    const typeMatch = pattern.exec(content);
    if (!typeMatch) continue;
    const openBracePos = typeMatch.index + typeMatch[0].lastIndexOf('{');
    return readObjectBlock(content, openBracePos);
  }

  return null;
}

function extractRpcCalls() {
  const calls = new Map();
  for (const file of walk(join(ROOT, 'src', 'api', 'domains'))) {
    const content = readFileSync(file, 'utf8');
    const rpcMatches = [...content.matchAll(/rpc(?:<[^>]*>)?\('([\w_]+)',\s*p\)/g)];
    for (const match of rpcMatches) {
      const fn = match[1];
      const paramBlock = resolveMethodParamBlock(content, match.index);
      if (paramBlock !== null) calls.set(fn, extractParamNames(paramBlock));
    }
  }
  return calls;
}

function extractTables() {
  const tables = new Set();
  for (const file of walk(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/supabase\.from\('([\w]+)'\)/g)) tables.add(m[1]);
  }
  return [...tables].sort();
}

const contract = {
  generated_at: new Date().toISOString(),
  source: 'scripts/db/gen-contract.js (extracted from src/api/domains + src)',
  rpcs: [...extractRpcCalls().entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, params]) => ({ name, params })),
  tables: extractTables(),
};

const existing = (() => {
  try { return JSON.parse(readFileSync(CONTRACT_FILE, 'utf8')); } catch { return null; }
})();

if (checkMode) {
  const normalize = (c) => JSON.stringify({
    rpcs: [...(c.rpcs || [])].sort((a, b) => a.name.localeCompare(b.name)),
    tables: [...(c.tables || [])].sort(),
  });
  if (existing && normalize(existing) === normalize(contract)) {
    console.log(`CONTRACT OK: supabase/api-contract.json is up to date (${contract.rpcs.length} RPCs, ${contract.tables.length} tables).`);
    process.exit(0);
  }
  const existingRpc = new Set((existing?.rpcs || []).map((row) => `${row.name}(${[...(row.params || [])].sort().join(',')})`));
  const currentRpc = new Set(contract.rpcs.map((row) => `${row.name}(${row.params.join(',')})`));
  const existingTables = new Set(existing?.tables || []);
  const currentTables = new Set(contract.tables);
  const removedRpc = [...existingRpc].filter((value) => !currentRpc.has(value));
  const addedRpc = [...currentRpc].filter((value) => !existingRpc.has(value));
  const removedTables = [...existingTables].filter((value) => !currentTables.has(value));
  const addedTables = [...currentTables].filter((value) => !existingTables.has(value));
  console.error('CONTRACT STALE: supabase/api-contract.json does not match src. Run `node scripts/db/gen-contract.js`.');
  if (removedRpc.length) console.error(`RPCs no longer referenced: ${removedRpc.join(', ')}`);
  if (addedRpc.length) console.error(`RPCs newly referenced: ${addedRpc.join(', ')}`);
  if (removedTables.length) console.error(`Tables no longer referenced: ${removedTables.join(', ')}`);
  if (addedTables.length) console.error(`Tables newly referenced: ${addedTables.join(', ')}`);
  process.exit(1);
}

writeFileSync(CONTRACT_FILE, `${JSON.stringify(contract, null, 2)}\n`);
console.log(`Wrote supabase/api-contract.json (${contract.rpcs.length} RPCs, ${contract.tables.length} tables).`);