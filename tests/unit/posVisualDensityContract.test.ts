import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('POS visual operational cleanup contract', () => {
  it('keeps top counters compact while preserving accessible labels', () => {
    const topbar = read('src/features/pos/components/topbar/PosTopBar.tsx');
    expect(topbar).toContain('aria-label={`${isAr ? labelAr : labelEn}: ${value}`}');
    expect(topbar).toContain('min-h-9');
    expect(topbar).not.toContain('hidden 2xl:inline text-[10px] font-bold');
  });

  it('shows the occupied-table operator in a dedicated readable row', () => {
    const card = read('src/features/pos/components/tables/TableCard.tsx');
    expect(card).toContain('data-testid={`pos-table-operator-${table.id}`}');
    expect(card).toContain('title={operatorName}');
    expect(card).toContain('<span className="truncate">{operatorName}</span>');
  });
});
