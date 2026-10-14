import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';
import { applyReviewedIndexes, indexes, validateTarget } from '../../scripts/db/read-index-review.mjs';
const original = getDbUrl();
let enabled = false;
try { enabled = process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' && ['localhost','127.0.0.1','[::1]'].includes(new URL(original).hostname); } catch { /* no database */ }
// Concurrent DDL/COMMIT proof owns a fresh disposable CI database only.
describe.skipIf(!enabled)('concurrent read-index builds and live queue writes', () => {
  let control: pg.Client, builder: pg.Client, writer: pg.Client, observer: pg.Client;
  let created = false;
  const name = 'qa_read_indexes_' + randomUUID().replace(/-/g, '');
  const selected = indexes.filter((x: {table: string}) => x.table === 'cloud_print_jobs');
  beforeAll(async () => {
    control = openDb(original); await control.connect();
    await control.query('CREATE DATABASE "' + name + '"'); created = true;
    const url = new URL(original); url.pathname = '/' + name;
    expect(validateTarget(url.toString(), process.env, true)).toBe('owned-local-ci');
    builder = openDb(url.toString()); writer = openDb(url.toString()); observer = openDb(url.toString());
    await Promise.all([builder.connect(), writer.connect(), observer.connect()]);
    await builder.query(`CREATE TABLE public.cloud_print_jobs (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, branch_id uuid NOT NULL,
      idempotency_key text NOT NULL,kind text NOT NULL,status text NOT NULL,
      attempts int NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(branch_id,idempotency_key))`);
    await builder.query(`INSERT INTO cloud_print_jobs(branch_id,idempotency_key,kind,status)
      SELECT '11111111-1111-1111-1111-111111111111','history:'||s,'receipt','submitted' FROM generate_series(1,20000)s`);
  });
  afterAll(async () => {
    if (writer) await writer.query('ROLLBACK').catch(() => {});
    for (const c of [builder,writer,observer]) if (c) await c.end().catch(() => {});
    if (created && control) await control.query('DROP DATABASE "' + name + '"');
    if (control) await control.end();
  });
  it('does not block enqueue/update while a concurrent build waits for a writer', async () => {
    await writer.query('BEGIN');
    await writer.query("INSERT INTO cloud_print_jobs(branch_id,idempotency_key,kind,status) VALUES('11111111-1111-1111-1111-111111111111','live-before','receipt','pending')");
    const buildPid = (await builder.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    const writePid = (await writer.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    let settled = false;
    const pending = applyReviewedIndexes(builder, selected).then((r: unknown) => { settled = true; return r; });
    void pending.catch(() => {}); // Assertions still await/reject the original promise below.
    const deadline = Date.now() + 5000;
    let blockedByWriter = false;
    while (Date.now() < deadline) {
      const row = (await observer.query('SELECT pg_blocking_pids($1) blockers', [buildPid])).rows[0];
      if (row.blockers.includes(writePid)) { blockedByWriter = true; break; }
      if (settled) break;
      await new Promise(done => setTimeout(done, 20));
    }
    expect(blockedByWriter).toBe(true);
    expect(settled).toBe(false);
    await writer.query("SET LOCAL statement_timeout='1s'");
    await writer.query("UPDATE cloud_print_jobs SET status='submitted',updated_at=clock_timestamp() WHERE idempotency_key='live-before'");
    await writer.query("INSERT INTO cloud_print_jobs(branch_id,idempotency_key,kind,status) VALUES('11111111-1111-1111-1111-111111111111','live-during','receipt','submitted')");
    await writer.query('COMMIT');
    expect(await pending).toEqual({ built: selected.map((x: {name: string}) => x.name) });
    expect((await observer.query("SELECT count(*)::int n FROM cloud_print_jobs WHERE idempotency_key LIKE 'live-%' AND status='submitted'")).rows[0].n).toBe(2);
  });
  it('stops before any DDL when an index name already exists', async () => {
    await expect(applyReviewedIndexes(builder, selected)).rejects.toThrow('Existing index requires reconciliation');
    const rows = (await observer.query('SELECT indisvalid,indisready FROM pg_index WHERE indexrelid IN (SELECT oid FROM pg_class WHERE relname=ANY($1))', [selected.map((x: {name: string}) => x.name)])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every(x => x.indisvalid && x.indisready)).toBe(true);
  });
});
