import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd(), 'src');

const excludedPathFragments = [
  `${path.sep}printing${path.sep}`,
  `${path.sep}print${path.sep}`,
  `${path.sep}receipts${path.sep}`,
  `${path.sep}receipt${path.sep}`,
  `${path.sep}thermal${path.sep}`,
];

function collectUiFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectUiFiles(full);
    return /\.tsx$/.test(entry.name) ? [full] : [];
  });
}

function isFrozenPrintingScope(file: string): boolean {
  return excludedPathFragments.some((fragment) => file.includes(fragment));
}

function isCalculationRounding(line: string): boolean {
  return line.includes('Number((') && line.includes('.toFixed(');
}

describe('global UI number formatting contract', () => {
  it('does not format displayed numbers with toFixed outside the central formatter or frozen printing scope', () => {
    const violations = collectUiFiles(root)
      .filter((file) => !isFrozenPrintingScope(file))
      .flatMap((file) => fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap((line, index) => {
        if (!line.includes('.toFixed(') || isCalculationRounding(line)) return [];
        const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
        return [`${rel}:${index + 1}`];
      }));

    expect(violations, `Use src/lib/format.ts helpers instead of direct toFixed() in UI:\n${violations.join('\n')}`).toEqual([]);
  });
});
