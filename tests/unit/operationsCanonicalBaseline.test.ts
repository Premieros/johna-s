import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Keep every quoted literal/operator unchanged while ignoring SQL layout/comments.
function tokens(sql: string): string[] {
  return (sql.match(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/|[a-zA-Z_]\w*|\d+(?:\.\d+)?|[^\s]/g) || [])
    .filter(token => !token.startsWith('--') && !token.startsWith('/*'));
}

describe('operations original SQL baseline', () => {
  it('proves the two accepted update_order source bodies have identical SQL tokens and literals', () => {
    const rollback = readFileSync('scripts/rollback/operations_stability_original_functions_20261015.sql', 'utf8');
    const original = rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION public.update_order'));
    const canonical = readFileSync('supabase/migrations/20260930193000_stale_client_duplicate_sent_line_guard.sql', 'utf8');
    const body = (sql: string) => sql.match(/AS (\$\w*\$)([\s\S]*?)\1/)![2];
    expect(tokens(body(original))).toEqual(tokens(body(canonical)));
  });
});
