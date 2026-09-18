import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { getDbUrl, openDb } from './db';
import { seedRlsFixture, type RlsIds } from './rls';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('Z-report server payload normalization', () => {
  let client: pg.Client;
  let ids: RlsIds;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
    await client.query('BEGIN');
    ids = await seedRlsFixture(client);

    await client.query(
      `UPDATE public.roles
       SET permissions = CASE
         WHEN COALESCE(permissions, '[]'::jsonb) ? 'shifts.report.shift' THEN permissions
         ELSE COALESCE(permissions, '[]'::jsonb) || '["shifts.report.shift"]'::jsonb
       END
       WHERE role = 'branch_manager'`,
    );
  });

  afterAll(async () => {
    await client.query('ROLLBACK').catch(() => {});
    await client.end().catch(() => {});
  });

  it('converts a cached HTML-only report into safe thermal text at enqueue time', async () => {
    const legacyHtml = `<!doctype html>
      <html><head><style>* { box-sizing:border-box; } body { width:80mm; }</style></head>
      <body>
        <h2>RLS A</h2>
        <div>Z-Report</div>
        <div><span>Net Sales:</span><span>123.45 EGP</span></div>
      </body></html>`;

    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [ids.users.branch_manager]);
    const enqueued = await client.query<{ result: { success: boolean; job_id: string } }>(
      `SELECT public.enqueue_cloud_report_print($1, $2::jsonb, $3) AS result`,
      [
        ids.branchA,
        JSON.stringify({ html: legacyHtml, paperWidthMm: 80, copies: 1 }),
        `zreport-legacy-${randomUUID()}`,
      ],
    );
    await client.query('RESET ROLE');

    expect(enqueued.rows[0].result.success).toBe(true);
    const jobId = enqueued.rows[0].result.job_id;
    const { rows } = await client.query<{
      kind: string;
      station_code: string;
      payload: { text?: string; html?: string; paperWidthMm?: number };
    }>(
      `SELECT kind, station_code, payload FROM public.cloud_print_jobs WHERE id=$1`,
      [jobId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('report');
    expect(rows[0].station_code).toBe('cashier');
    expect(rows[0].payload.html).toBeUndefined();
    expect(rows[0].payload.text).toContain('Z-Report');
    expect(rows[0].payload.text).toContain('Net Sales: 123.45 EGP');
    expect(rows[0].payload.text).not.toContain('box-sizing');
    expect(rows[0].payload.text).not.toContain('<style');
    expect(rows[0].payload.paperWidthMm).toBe(80);
  });

  it('keeps canonical text reports as text and strips any redundant HTML fallback', async () => {
    const { rows } = await client.query<{ payload: { text?: string; html?: string } }>(
      `SELECT public._normalize_cloud_report_payload(
         '{"text":"READY Z REPORT","html":"<style>bad</style><div>bad</div>","paperWidthMm":80}'::jsonb
       ) AS payload`,
    );

    expect(rows[0].payload.text).toBe('READY Z REPORT');
    expect(rows[0].payload.html).toBeUndefined();
  });
});
