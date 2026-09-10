import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const extractBalancedBlock = (source: string, openingBrace: number): string => {
  expect(source[openingBrace]).toBe('{');
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openingBrace, index + 1);
  }

  throw new Error('Unbalanced source block');
};

const extractFunctionBody = (source: string, functionName: string): string => {
  const sourceFile = ts.createSourceFile('payment.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === functionName,
  );
  if (!declaration?.body) throw new Error(`Function ${functionName} was not found`);
  return declaration.body.getText(sourceFile);
};

describe('sale financial authority contract', () => {
  it('uses process_sale as the only online sale write path', () => {
    const posApi = read('src/api/domains/pos.ts');
    expect(posApi).toContain("return rpc<RpcResult>('process_sale', p)");
    expect(posApi).not.toContain("from('sales').insert");
    expect(posApi).not.toContain("from('sale_items').insert");
    expect(posApi).not.toContain('Direct Sale Processing Fallback');
  });

  it('queues only an explicit offline sale into the durable central outbox', () => {
    const payment = read('src/features/pos/services/payment.ts');
    const processSale = extractFunctionBody(payment, 'processSaleForOrder');
    const queueSale = extractFunctionBody(payment, 'queueOfflineSale');

    expect(queueSale).toContain('await enqueueOfflineSale({');
    expect(queueSale).toContain('client_id: id');
    expect(queueSale).toContain('payload: p as unknown as Record<string, unknown>');
    expect(queueSale).toContain("if (!p.p_shift_id) throw new Error('SHIFT_REQUIRED_OFFLINE')");

    const explicitOfflineCondition = "if (!splitPayments && typeof navigator !== 'undefined' && !navigator.onLine)";
    const explicitOfflineStart = processSale.indexOf(explicitOfflineCondition);
    expect(explicitOfflineStart).toBeGreaterThanOrEqual(0);
    const explicitOffline = extractBalancedBlock(processSale, processSale.indexOf('{', explicitOfflineStart));
    expect(explicitOffline).toContain('await queueOfflineSale(p)');
    expect(explicitOffline).toContain('pending_sync: true');
    expect(explicitOffline).toContain('offline: true');
    expect(processSale.match(/queueOfflineSale\(p\)/g)).toHaveLength(1);
  });

  it('does not convert authoritative server rejection or ambiguous online failure into offline success', () => {
    const payment = read('src/features/pos/services/payment.ts');
    const processSale = extractFunctionBody(payment, 'processSaleForOrder');

    const onlineMarker = 'const settlementPayload = resolvedShift.payload;';
    const onlineMarkerStart = processSale.indexOf(onlineMarker);
    expect(onlineMarkerStart).toBeGreaterThanOrEqual(0);
    const onlineTryStart = processSale.indexOf('try {', onlineMarkerStart + onlineMarker.length);
    expect(onlineTryStart).toBeGreaterThanOrEqual(0);
    const onlineTryCatch = processSale.slice(onlineTryStart);
    expect(onlineTryCatch).not.toContain('queueOfflineSale(p)');
    expect(onlineTryCatch).toContain('A server rejection');
    expect(onlineTryCatch).toContain('the server may have');

    const splitTenderBranchStart = processSale.indexOf('if (splitPayments)');
    expect(splitTenderBranchStart).toBeGreaterThanOrEqual(0);
    const splitTenderBranch = extractBalancedBlock(processSale, processSale.indexOf('{', splitTenderBranchStart));
    expect(splitTenderBranch).toContain('processSplitSaleForOrder');
    expect(splitTenderBranch).not.toContain('queueOfflineSale');

    const splitSale = extractFunctionBody(payment, 'processSplitSaleForOrder');
    expect(splitSale).not.toContain('queueOfflineSale');
    expect(splitSale).not.toContain('enqueueOfflineSale');
    expect(splitSale).toContain('Split payment requires an online connection.');
  });

  it('blocks raw authenticated inserts and clamps applied payment server-side', () => {
    const migration = read('supabase/migrations/20260902060000_sale_financial_authority.sql');
    expect(migration).toContain('CREATE POLICY auth_insert_sales');
    expect(migration).toContain('CREATE POLICY auth_insert_sale_items');
    expect(migration.match(/WITH CHECK \(false\)/g)).toHaveLength(2);
    expect(migration).toContain('LEAST(GREATEST(COALESCE(p_paid_amount, 0), 0), v_total)');
  });
});
