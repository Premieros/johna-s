// Isolated A0 protocol prototype. No network, database or production imports.
// The caller MUST obtain scope from a future authenticated/enrolled hub session.
// This module validates envelopes; it does not authenticate a user or execute POS.
import { createHash } from 'node:crypto';

export const PROTOCOL_VERSION = 1;
export const MAX_OPERATION_BYTES = 64 * 1024;
export const OPERATION_KINDS = Object.freeze(['sale.commit', 'sale.reverse', 'kitchen.send', 'print.intent']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ['operationId', 'sequence', 'kind', 'createdAt', 'payload'];
const ENVELOPE_KEYS = ['version', 'branchId', 'deviceId', 'userId', ...KEYS, 'digest'];
const fail = code => { throw new Error(code); };

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value, allowed, code) {
  if (!object(value) || Object.keys(value).length !== allowed.length
    || Object.keys(value).some(key => !allowed.includes(key))) fail(code);
}

function canonical(value, seen = new Set(), depth = 0) {
  if (depth > 32) fail('PAYLOAD_TOO_DEEP');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    // Fractional financial values must be represented as decimal strings in v1.
    if (!Number.isSafeInteger(value)) fail('UNSAFE_NUMBER_USE_DECIMAL_STRING');
    return JSON.stringify(value);
  }
  if (!object(value) && !Array.isArray(value)) fail('NON_JSON_PAYLOAD');
  if (seen.has(value)) fail('CYCLIC_PAYLOAD');
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) fail('SPARSE_OR_EXTENDED_ARRAY');
    result = '[' + value.map(item => canonical(item, seen, depth + 1)).join(',') + ']';
  } else {
    result = '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], seen, depth + 1)).join(',') + '}';
  }
  seen.delete(value);
  return result;
}

function scope(context) {
  exactKeys(context, ['branchId', 'deviceId', 'userId'], 'INVALID_VERIFIED_CONTEXT');
  for (const key of ['branchId', 'deviceId', 'userId']) if (!UUID.test(context[key] || '')) fail('INVALID_SCOPE_ID');
}

function fields(input) {
  if (!UUID.test(input.operationId || '')) fail('INVALID_OPERATION_ID');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) fail('INVALID_DEVICE_SEQUENCE');
  if (!OPERATION_KINDS.includes(input.kind)) fail('UNSUPPORTED_OPERATION_KIND');
  if (typeof input.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.createdAt)
    || !Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt) fail('INVALID_ORIGIN_TIME');
  if (!object(input.payload)) fail('INVALID_PAYLOAD');
}

function fingerprint(unsigned) {
  const encoded = canonical(unsigned);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_OPERATION_BYTES) fail('OPERATION_TOO_LARGE');
  return createHash('sha256').update(encoded).digest('hex');
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function createOperation(verifiedContext, input) {
  scope(verifiedContext);
  exactKeys(input, KEYS, 'UNEXPECTED_COMMAND_FIELDS');
  fields(input);
  const unsigned = { version: PROTOCOL_VERSION, ...verifiedContext, ...input };
  const digest = fingerprint(unsigned);
  // Detached immutable snapshot: later UI edits must not change a queued command.
  return freeze(JSON.parse(canonical({ ...unsigned, digest })));
}

export function verifyOperation(verifiedContext, operation) {
  scope(verifiedContext);
  exactKeys(operation, ENVELOPE_KEYS, 'INVALID_ENVELOPE_FIELDS');
  if (operation.version !== PROTOCOL_VERSION) fail('UNSUPPORTED_PROTOCOL_VERSION');
  for (const key of ['branchId', 'deviceId', 'userId']) if (operation[key] !== verifiedContext[key]) fail('FOREIGN_OPERATION_SCOPE');
  fields(operation);
  const { digest, ...unsigned } = operation;
  if (typeof digest !== 'string' || digest !== fingerprint(unsigned)) fail('OPERATION_DIGEST_MISMATCH');
  return true;
}

export function classifyReplay(verifiedContext, existing, incoming) {
  verifyOperation(verifiedContext, incoming);
  if (!existing) return 'new';
  verifyOperation(verifiedContext, existing);
  if (existing.operationId !== incoming.operationId) fail('WRONG_REPLAY_RECORD');
  if (existing.digest !== incoming.digest) fail('OPERATION_ID_REUSED_WITH_DIFFERENT_CONTENT');
  return 'duplicate';
}
