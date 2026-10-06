#!/usr/bin/env node
// Catalog parity, with no operational RPC calls or table reads. A fresh migration
// reloads PostgREST's schema cache. This gate checks live definitions and sentinel
// routes; it does not individually exercise operational routes or their ACLs.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const SCHEMA_SENTINEL_RPC = '_production_schema_contract_kitchen_v1';
const METADATA_RPC = '_production_api_contract_v1';

function validateResults(results, expected, kind) {
  if (!Array.isArray(results) || results.length !== expected.length) {
    throw new Error(`Incomplete ${kind} metadata`);
  }
  const names = new Set(expected.map((item) => typeof item === 'string' ? item : item.name));
  if (names.size !== expected.length) throw new Error(`Duplicate ${kind} contract`);
  const missing = [];
  for (const result of results) {
    if (!result || !names.delete(result.name) || typeof result.present !== 'boolean') {
      throw new Error(`Invalid ${kind} metadata`);
    }
    if (!result.present) missing.push(`${kind} ${result.name}`);
  }
  return missing;
}

export async function runParity({ url, key, contract, fetchImpl = fetch }) {
  if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  async function call(name, body) {
    const res = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
    });
    // A denied, missing, failed or non-JSON endpoint cannot authorize publishing.
    if (res.status !== 200) throw new Error(`Unverifiable ${name}: HTTP ${res.status}`);
    return res.json();
  }
  const metadata = await call(METADATA_RPC, { p_contract: { rpcs: contract.rpcs, tables: contract.tables } });
  if (metadata?.version !== 1 || metadata.valid !== true) throw new Error('Invalid metadata contract');
  const missing = [
    ...validateResults(metadata.rpcs, contract.rpcs, 'rpc'),
    ...validateResults(metadata.tables, contract.tables, 'table'),
  ];
  if (missing.length) throw new Error(`Missing or ambiguous database contract: ${missing.join(', ')}`);
  const schema = await call(SCHEMA_SENTINEL_RPC, {});
  if (schema !== true) throw new Error(`Missing/failed schema contract: ${SCHEMA_SENTINEL_RPC}`);
  return { rpcs: contract.rpcs.length, tables: contract.tables.length, requests: 2 };
}

async function main() {
  try {
    const contract = JSON.parse(readFileSync(resolve(ROOT, 'supabase/api-contract.json'), 'utf8'));
    const result = await runParity({ url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_ANON_KEY, contract });
    console.log(`PARITY OK: ${result.rpcs} RPC definitions, ${result.tables} relations and kitchen sentinel verified (${result.requests} requests).`);
  } catch (err) {
    console.error(`PARITY FAILED: ${err.message}`);
    console.error('Do NOT publish until the database contract is verified. No operational probe fallback.');
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
