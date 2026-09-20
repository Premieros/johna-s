import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

describe.skipIf(!dbUrl)('thermal print payload guard', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    await client.end().catch(() => {});
  });

  it('converts legacy HTML/CSS into plain thermal text', async () => {
    const html = `<!doctype html><html><head><style>* { box-sizing:border-box; } body { width:80mm; }</style></head>
      <body><h2>PAYMENT RECEIPT</h2><div>Invoice: Johna's-TEST</div><div>Total: 123 EGP</div></body></html>`;
    const { rows } = await client.query<{ payload: { text?: string; html?: string } }>(
      `SELECT public._normalize_thermal_print_payload($1::jsonb) AS payload`,
      [JSON.stringify({ html, paperWidthMm: 80, copies: 1 })],
    );
    expect(rows[0].payload.html).toBeUndefined();
    expect(rows[0].payload.text).toContain('PAYMENT RECEIPT');
    expect(rows[0].payload.text).toContain("Invoice: Johna's-TEST");
    expect(rows[0].payload.text).toContain('Total: 123 EGP');
    expect(rows[0].payload.text).not.toContain('box-sizing');
    expect(rows[0].payload.text).not.toContain('<style');
  });

  it('keeps canonical text authoritative and strips redundant HTML', async () => {
    const { rows } = await client.query<{ payload: { text?: string; html?: string } }>(
      `SELECT public._normalize_thermal_print_payload(
        '{"text":"READY RECEIPT","html":"<style>bad</style><div>bad</div>","copies":1}'::jsonb
      ) AS payload`,
    );
    expect(rows[0].payload.text).toBe('READY RECEIPT');
    expect(rows[0].payload.html).toBeUndefined();
  });

  it('preserves fixed template metadata while keeping canonical text authoritative', async () => {
    const template = {
      version: 1,
      kind: 'customer',
      isAr: false,
      paperWidthMm: 80,
      storeName: "JOHNA'S",
      storeSubtitle: 'RESTAURANT',
      title: 'OPEN CHECK',
      meta: [],
      itemsHeading: 'ITEMS',
      items: [],
    };
    const { rows } = await client.query<{ payload: { text?: string; html?: string; template?: unknown } }>(
      `SELECT public._normalize_thermal_print_payload($1::jsonb) AS payload`,
      [JSON.stringify({ text: 'READY RECEIPT', html: '<div>legacy</div>', template, copies: 1 })],
    );
    expect(rows[0].payload.text).toBe('READY RECEIPT');
    expect(rows[0].payload.html).toBeUndefined();
    expect(rows[0].payload.template).toEqual(template);
  });

  it('installs a queue-boundary trigger for receipt and report jobs', async () => {
    const { rows } = await client.query<{ def: string }>(
      `SELECT pg_get_triggerdef(oid) AS def
       FROM pg_trigger
       WHERE tgrelid='public.cloud_print_jobs'::regclass
         AND tgname='trg_normalize_cloud_thermal_print_job'
         AND NOT tgisinternal`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain('BEFORE INSERT OR UPDATE OF payload, kind');
    expect(rows[0].def).toContain('normalize_cloud_thermal_print_job()');
  });
});
