import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOperation, verifyOperation, classifyReplay, MAX_OPERATION_BYTES } from '../prototype/operation-contract.mjs';

const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const context = { branchId: id(1), deviceId: id(2), userId: id(3) };
const input = () => ({ operationId: id(4), sequence: 1, kind: 'sale.commit', createdAt: '2026-11-14T00:00:00.000Z', payload: { total: '105.50', lines: [{ quantity: '1.250', price: '84.40' }] } });

test('lost ACK retries retain identity, frozen amounts and deterministic digest', () => {
  const command = input();
  const first = createOperation(context, command);
  command.payload.total = '999.00';
  assert.equal(first.payload.total, '105.50');
  assert.throws(() => { first.payload.total = '2.00'; }, TypeError);
  const persisted = JSON.parse(JSON.stringify(first));
  assert.equal(verifyOperation(context, persisted), true);
  assert.equal(classifyReplay(context, first, persisted), 'duplicate');
  assert.equal(classifyReplay(context, null, persisted), 'new');
});

test('changed body cannot reuse an operation ID even after recomputing a valid digest', () => {
  const first = createOperation(context, input());
  const changed = input(); changed.payload.total = '1.00';
  assert.throws(() => classifyReplay(context, first, createOperation(context, changed)), /REUSED_WITH_DIFFERENT_CONTENT/);
  assert.throws(() => verifyOperation(context, { ...first, payload: changed.payload }), /DIGEST_MISMATCH/);
});

test('branch, device and user scope cannot be overridden by command or replay', () => {
  const operation = createOperation(context, input());
  for (const key of ['branchId', 'deviceId', 'userId']) {
    assert.throws(() => createOperation(context, { ...input(), [key]: id(99) }), /UNEXPECTED_COMMAND_FIELDS/);
    assert.throws(() => verifyOperation({ ...context, [key]: id(99) }, operation), /FOREIGN_OPERATION_SCOPE/);
  }
});

test('unsupported protocol, command kind, unsafe sequence and unknown fields fail closed', () => {
  const operation = createOperation(context, input());
  assert.throws(() => verifyOperation(context, { ...operation, version: 2 }), /UNSUPPORTED_PROTOCOL/);
  assert.throws(() => createOperation(context, { ...input(), kind: 'arbitrary.sql' }), /UNSUPPORTED_OPERATION/);
  for (const sequence of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => createOperation(context, { ...input(), sequence }), /INVALID_DEVICE_SEQUENCE/);
  assert.throws(() => verifyOperation(context, { ...operation, secret: 'unexpected' }), /ENVELOPE_FIELDS/);
});

test('fractional numbers, non-JSON values, cycles and invalid timestamps are rejected', () => {
  for (const value of [0.1, NaN, Infinity, undefined, new Date(), 1n]) assert.throws(() => createOperation(context, { ...input(), payload: { value } }));
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => createOperation(context, { ...input(), payload: cycle }), /CYCLIC/);
  assert.throws(() => createOperation(context, { ...input(), createdAt: '2026-02-30T00:00:00.000Z' }), /INVALID_ORIGIN_TIME/);
});

test('canonical object ordering is stable and operation size is bounded', () => {
  const a = createOperation(context, { ...input(), payload: { b: '2.00', a: '1.00' } });
  const b = createOperation(context, { ...input(), payload: { a: '1.00', b: '2.00' } });
  assert.equal(a.digest, b.digest);
  assert.throws(() => createOperation(context, { ...input(), payload: { text: 'x'.repeat(MAX_OPERATION_BYTES) } }), /TOO_LARGE/);
});
