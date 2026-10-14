import { describe, expect, it } from 'vitest';
import { validateTarget } from '../../scripts/db/read-index-target.mjs';
const expected = 'azzdesuowpdcoflmyezn';
const approved = { SUPABASE_PROJECT_REF: expected, JOHNAS_READ_INDEX_PRODUCTION_APPROVAL: 'owner-approved-johnas-read-indexes-20261014' };
const direct = `postgresql://postgres:placeholder@db.${expected}.supabase.co:5432/postgres?sslmode=verify-full`;
describe('read index target/approval guard', () => {
  it('requires separate production SQL approval and verified TLS', () => {
    expect(() => validateTarget(direct, { SUPABASE_PROJECT_REF: expected }, true)).toThrow('Separate owner SQL approval');
    expect(validateTarget(direct, approved, true)).toBe('johnas-production');
    expect(() => validateTarget(direct.replace('verify-full','require'), approved, true)).toThrow('Verified TLS required');
  });
  it('rejects another project, database and transaction-mode pooler', () => {
    expect(() => validateTarget(direct.replace(expected,'hvqlkapynjfjikqithvd'), approved, true)).toThrow('Unexpected database host');
    expect(() => validateTarget(direct.replace('/postgres?','/template1?'), approved, true)).toThrow('Unexpected production database');
    expect(() => validateTarget(`postgresql://postgres.${expected}:placeholder@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=verify-full`, approved, true)).toThrow('Unexpected database host');
  });
  it('permits only an owned disposable CI database on localhost', () => {
    const owned = 'postgresql://postgres:placeholder@localhost:5432/qa_read_indexes_' + 'a'.repeat(32);
    expect(validateTarget(owned, {CI:'true',GITHUB_ACTIONS:'true'}, true)).toBe('owned-local-ci');
    expect(() => validateTarget(owned, {}, true)).toThrow('Owned disposable CI');
    expect(() => validateTarget('postgresql://postgres:placeholder@localhost:5432/postgres', {CI:'true',GITHUB_ACTIONS:'true'}, true)).toThrow('Owned disposable CI');
  });
});
