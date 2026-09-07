import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

let client: pg.Client;
let canRun = false;

beforeAll(async () => {
  const dbUrl = getDbUrl();
  if (!dbUrl) return;
  try {
    client = openDb(dbUrl);
    await client.connect();
    canRun = true;
  } catch {
    canRun = false;
  }
}, 30_000);

afterAll(async () => {
  if (client) await client.end().catch(() => {});
});

describe('shift and drawer manager approval', () => {
  it('installs force-close as a server-authoritative one-time approval flow', async () => {
    if (!canRun) return;
    const r = await client.query(`
      SELECT pg_get_functiondef('public.force_close_shift(uuid,numeric,text)'::regprocedure) AS def
    `);
    expect(r.rowCount).toBe(1);
    const def = String(r.rows[0].def || '');
    const compactDef = def.replace(/\s+/g, '');
    expect(def).toContain("action_type = 'force_close_shift'");
    expect(def).toContain("entity_type = 'shift'");
    expect(compactDef).toContain("payload->>'actual_amount'");
    expect(def).toContain("status = 'consumed'");
    expect(def).toContain('FORCE_CLOSE_APPROVAL_CONSUME_FAILED');
    expect(def).toContain("UPDATE public.shifts");
    expect(def).toContain("COALESCE(operation_type, '') IN ('sale', 'cash_in')");
    expect(def).toContain("COALESCE(operation_type, '') IN ('refund', 'expense', 'cash_out')");
  });

  it('installs open-drawer authorization without forging a cash movement', async () => {
    if (!canRun) return;
    const r = await client.query(`
      SELECT pg_get_functiondef('public.authorize_open_drawer(uuid,text)'::regprocedure) AS def
    `);
    expect(r.rowCount).toBe(1);
    const def = String(r.rows[0].def || '');
    expect(def).toContain("action_type = 'open_drawer'");
    expect(def).toContain("entity_type = 'shift'");
    expect(def).toContain("status = 'consumed'");
    expect(def).toContain('OPEN_DRAWER_APPROVAL_CONSUME_FAILED');
    expect(def).toContain('open_drawer_authorized');
    expect(def).toContain("'hardware_action_required', true");
    expect(def).not.toContain('INSERT INTO public.shift_operations');
  });
});
