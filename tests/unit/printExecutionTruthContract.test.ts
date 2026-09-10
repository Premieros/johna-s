import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  expect(startAt).toBeGreaterThanOrEqual(0);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(endAt).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe('print execution truth contract', () => {
  it('keeps authorization non-mutating and records only in the execution RPC', () => {
    const migration = read('supabase/migrations/20260910006000_print_execution_truth.sql');
    const authorize = between(
      migration,
      'CREATE OR REPLACE FUNCTION public.authorize_sale_print',
      'CREATE OR REPLACE FUNCTION public.record_sale_print',
    );
    const record = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.record_sale_print'));

    expect(authorize).not.toContain('INSERT INTO public.sale_print_events');
    expect(authorize).not.toContain('INSERT INTO public.audit_log');
    expect(authorize).not.toContain("SET status = 'consumed'");
    expect(authorize).toContain("public.can_permission('pos.receipt.print')");
    expect(authorize).toContain("public.can_permission('pos.reprint')");
    expect(authorize).toContain('public.user_may_access_branch(v_sale.branch_id)');

    expect(record).toContain('FOR UPDATE');
    expect(record).toContain('INSERT INTO public.sale_print_events');
    expect(record).toContain('INSERT INTO public.audit_log');
    expect(record).toContain("SET status = 'consumed', consumed_at = now()");
    expect(record).toContain("'execution_confirmed_by_client', true");
    expect(record).toContain('REVOKE ALL ON FUNCTION public.record_sale_print(uuid, uuid) FROM anon');
  });

  it('does not persist a receipt print before the browser print path runs', () => {
    const printing = read('src/features/pos/utils/printing.ts');
    const openWindow = between(printing, 'export function openPrintWindow', 'export async function buildReceiptHtml');
    const receiptBuilder = between(printing, 'export async function buildReceiptHtml', 'export function buildKitchenTicketHtml');

    expect(openWindow).toContain("const win = window.open('', '_blank'");
    expect(openWindow).toContain('if (!win) return false');
    expect(openWindow).toContain('win.print();');
    expect(openWindow).toContain('await recordReceiptPrint(authorization);');
    expect(openWindow.indexOf('win.print();')).toBeLessThan(openWindow.indexOf('await recordReceiptPrint(authorization);'));

    expect(receiptBuilder).toContain('await authorizeReceiptPrint(receipt)');
    expect(receiptBuilder).toContain('pendingReceiptPrints.set(printToken, authorization)');
    expect(receiptBuilder).toContain('johns-print-auth');
    expect(receiptBuilder).not.toContain('window.print()');
  });

  it('treats missing or rejecting local Print Agent as failure, never success', () => {
    const localAgent = read('src/features/pos/services/localPrintAgent.ts');
    const executeSilent = between(localAgent, 'export async function executeSilentPrint', 'export async function executeCashDrawerKick');
    const kitchen = between(localAgent, 'export async function printKitchenStationsLocally', 'export function suppressNextKitchenBrowserPopup');
    const agent = read('local-print-agent/agent.cjs');

    expect(executeSilent).toContain("fetchWithTimeout(`${PRINT_AGENT_URL}/print`");
    expect(executeSilent).toContain('if (!response.ok) return false');
    expect(executeSilent).toContain('return Boolean(result.success)');
    expect(executeSilent).toContain('catch {\n    return false;');

    expect(kitchen).toContain("fetchWithTimeout(`${PRINT_AGENT_URL}/health`)");
    expect(kitchen).toContain('if (!health.ok) return false');
    expect(kitchen).toContain('if (!configResponse.ok) return false');
    expect(kitchen).toContain('if (!response.ok) return false');
    expect(kitchen).toContain('if (!result.success) return false');
    expect(kitchen).toContain('catch {\n    return false;');

    expect(agent).toContain("if (req.method === 'POST' && url.pathname === '/print')");
    expect(agent).toContain('await printText(printer, text);');
    expect(agent.indexOf('await printText(printer, text);')).toBeLessThan(agent.indexOf("return json(res, 200, { success: true, station, printer });"));
    expect(agent).toContain("return json(res, 500, { success: false");
  });

  it('keeps print status permission-first and branch scoped', () => {
    const migration = read('supabase/migrations/20260910005000_print_status_permission_first.sql');
    expect(migration).toContain("public.can_permission('pos.receipt.print')");
    expect(migration).toContain('public.user_may_access_branch');
    expect(migration).toContain("p_status = 'printed'");
    expect(migration).toContain('printed_at');
    expect(migration).toContain('REVOKE ALL');
  });
});
