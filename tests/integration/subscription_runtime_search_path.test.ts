import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { getDbUrl, openDb } from './db';

const dbUrl = getDbUrl();

const targets = [
  ['submit_instapay_payment', 'p_branch_id uuid, p_plan_id text, p_amount numeric, p_billing_period text, p_reference text, p_receipt_url text'],
  ['review_instapay_payment', 'p_payment_id uuid, p_approve boolean, p_rejection_reason text'],
  ['subscription_expired', 'p_branch_id uuid'],
  ['subscription_settings_get', ''],
  ['super_admin_remove_branch_override', 'p_branch_id uuid, p_feature_key text'],
] as const;

describe.skipIf(!dbUrl)('subscription runtime SECURITY DEFINER hardening', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = openDb(dbUrl!);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.end().catch(() => {});
  });

  it('uses public, pg_temp search_path and preserves authenticated-only execute', async () => {
    for (const [name, args] of targets) {
      const row = await client.query<{
        config: string[] | null;
        authenticated_execute: boolean;
        anon_execute: boolean;
      }>(
        `SELECT p.proconfig AS config,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = $1
           AND pg_get_function_identity_arguments(p.oid) = $2`,
        [name, args],
      );

      expect(row.rows, `${name}(${args})`).toHaveLength(1);
      expect(row.rows[0].config ?? [], `${name} search_path`).toContain('search_path=public, pg_temp');
      expect(row.rows[0].authenticated_execute, `${name} authenticated execute`).toBe(true);
      expect(row.rows[0].anon_execute, `${name} anon execute`).toBe(false);
    }
  });

  it('preserves the existing authorization and delegation contracts', async () => {
    const rows = await client.query<{ name: string; definition: string }>(
      `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = ANY($1::text[])`,
      [[
        'submit_instapay_payment',
        'review_instapay_payment',
        'subscription_expired',
        'subscription_settings_get',
        'super_admin_remove_branch_override',
      ]],
    );

    const byName = new Map(rows.rows.map((row) => [row.name, row.definition]));

    const submit = byName.get('submit_instapay_payment') ?? '';
    expect(submit).toContain('auth.uid()');
    expect(submit).toContain('public.is_super_admin()');
    expect(submit).toContain('own_branch <> p_branch_id');

    expect(byName.get('review_instapay_payment')).toContain('public.is_super_admin()');
    expect(byName.get('subscription_settings_get')).toContain('public.is_super_admin()');
    expect(byName.get('subscription_expired')).toContain('public.subscription_status(p_branch_id)');

    const removeOverride = byName.get('super_admin_remove_branch_override') ?? '';
    expect(removeOverride).toMatch(/(?:public\.)?is_super_admin\(\)/);
  });
});
