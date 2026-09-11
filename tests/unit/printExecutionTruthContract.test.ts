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
  it('keeps authorization non-mutating and records only after an accepted execution attempt', () => {
    const authorizationMigration = read('supabase/migrations/20260910093914_print_execution_truth.sql');
    const submissionTruth = read('supabase/migrations/20260912002000_cloud_print_submission_truth.sql');
    const authorize = between(
      authorizationMigration,
      'CREATE OR REPLACE FUNCTION public.authorize_sale_print',
      'CREATE OR REPLACE FUNCTION public.record_sale_print',
    );
    const record = between(
      submissionTruth,
      'CREATE OR REPLACE FUNCTION public.record_sale_print',
      'CREATE OR REPLACE FUNCTION public.complete_cloud_print_job',
    );

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
    expect(record).toContain("'print_call_accepted_by_client', true");
    expect(record).toContain("'physical_print_confirmed', false");
    expect(record).not.toContain("'physical_print_confirmed', true");
    expect(submissionTruth).toContain('REVOKE ALL ON FUNCTION public.record_sale_print(uuid, uuid) FROM PUBLIC, anon');
  });

  it('records receipt submission only after Electron or Print Agent accepts execution', () => {
    const printing = read('src/features/pos/utils/printing.ts');
    const openWindow = between(printing, 'export function openPrintWindow', 'export async function buildReceiptHtml');
    const receiptBuilder = between(printing, 'export async function buildReceiptHtml', 'export function buildKitchenTicketHtml');

    expect(openWindow).toContain("const win = window.open('', '_blank'");
    expect(openWindow).toContain('if (!win) return false');
    expect(openWindow).toContain('accepted = await executeSilentPrint');
    expect(openWindow).toContain('if (accepted) {');
    expect(openWindow).toContain('await recordReceiptPrint(pending.authorization);');
    expect(openWindow.indexOf('accepted = await executeSilentPrint')).toBeLessThan(openWindow.indexOf('await recordReceiptPrint(pending.authorization);'));

    const fallback = openWindow.slice(openWindow.indexOf("console.warn('[receipt-print] local print not confirmed"));
    expect(fallback).toContain('win.print();');
    expect(fallback).not.toContain('recordReceiptPrint(');

    expect(receiptBuilder).toContain('await authorizeReceiptPrint(receipt)');
    expect(receiptBuilder).toContain('pendingReceiptPrints.set(printToken');
    expect(receiptBuilder).toContain('plainText: buildReceiptPlainText');
    expect(receiptBuilder).toContain('johns-print-auth');
    expect(receiptBuilder).not.toContain('window.print()');
  });

  it('treats missing or rejecting local Print Agent as failure, never success', () => {
    const localAgent = read('src/features/pos/services/localPrintAgent.ts');
    const executeDetailed = between(
      localAgent,
      'export async function executeSilentPrintDetailed',
      'export async function executeSilentPrint(options:',
    );
    const executeSilent = between(
      localAgent,
      'export async function executeSilentPrint(options:',
      'export async function executeCashDrawerKick',
    );
    const drawer = between(localAgent, 'export async function executeCashDrawerKick', '/**\n * Print each authoritative kitchen station group');
    const kitchen = between(localAgent, 'export async function printKitchenStationsLocally', 'export function suppressNextKitchenBrowserPopup');
    const agent = read('local-print-agent/agent.cjs');

    expect(executeDetailed).toContain("fetchWithTimeout(`${PRINT_AGENT_URL}/print`");
    expect(executeDetailed).toContain('if (!response.ok) return { success: false');
    expect(executeDetailed).toContain('return result.success');
    expect(executeDetailed).toContain('? { success: true }');
    expect(executeDetailed).toContain(': { success: false');
    expect(executeDetailed).toContain('catch (error)');
    expect(executeDetailed).toContain('return { success: false');
    expect(executeSilent).toContain('return (await executeSilentPrintDetailed(options)).success;');

    expect(drawer).toContain("fetchWithTimeout(`${PRINT_AGENT_URL}/drawer`");
    expect(drawer).toContain('if (!response.ok) return false');
    expect(drawer).toContain('return Boolean(result.success)');
    expect(drawer).toContain('catch {\n    return false;');

    expect(kitchen).toContain("fetchWithTimeout(`${PRINT_AGENT_URL}/health`)");
    expect(kitchen).toContain('if (!health.ok) return false');
    expect(kitchen).toContain('if (!configResponse.ok) return false');
    expect(kitchen).toContain('if (!response.ok) return false');
    expect(kitchen).toContain('return Boolean(result.success);');
    expect(kitchen).toContain('catch {\n        return false;');

    expect(agent).toContain("if (req.method === 'POST' && url.pathname === '/print')");
    expect(agent).toContain('await printText(printer, text);');
    expect(agent.indexOf('await printText(printer, text);')).toBeLessThan(agent.indexOf("return json(res, 200, { success: true, station, printer });"));
    expect(agent).toContain("if (req.method === 'POST' && url.pathname === '/drawer')");
    expect(agent).toContain('Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])');
    expect(agent).toContain('await kickDrawer(printer);');
    expect(agent.indexOf('await kickDrawer(printer);')).toBeLessThan(agent.indexOf("return json(res, 200, { success: true, printer });"));
    expect(agent).toContain("return json(res, 500, { success: false");
  });

  it('never promotes Windows print-call acceptance to physical print success', () => {
    const submissionTruth = read('supabase/migrations/20260912002000_cloud_print_submission_truth.sql');
    const complete = submissionTruth.slice(submissionTruth.indexOf('CREATE OR REPLACE FUNCTION public.complete_cloud_print_job'));

    expect(submissionTruth).toContain("CHECK (status IN ('pending', 'claimed', 'printing', 'submitted', 'printed', 'failed'))");
    expect(complete).toContain("SET status = 'submitted'");
    expect(complete).not.toContain("SET status = 'printed'");
    expect(complete).toContain("'print_call_accepted_by_cloud_agent', true");
    expect(complete).toContain("'physical_print_confirmed', false");
    expect(complete).not.toContain("'physical_print_confirmed', true");
    expect(complete).toContain("'status', 'submitted'");
  });

  it('keeps print status permission-first and branch scoped', () => {
    const migration = read('supabase/migrations/20260910093844_print_status_permission_first.sql');
    expect(migration).toContain("public.can_permission('pos.receipt.print')");
    expect(migration).toContain('public.user_may_access_branch');
    expect(migration).toContain("p_status = 'printed'");
    expect(migration).toContain('printed_at');
    expect(migration).toContain('REVOKE ALL');
  });
});
