import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd(), 'src');
const allowedFiles = new Set([
  path.normalize('lib/format.ts'),
]);

const excludedPathFragments = [
  `${path.sep}printing${path.sep}`,
  `${path.sep}print${path.sep}`,
  `${path.sep}receipts${path.sep}`,
  `${path.sep}receipt${path.sep}`,
  `${path.sep}thermal${path.sep}`,
];

function collect(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collect(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function isExcluded(file: string): boolean {
  const rel = path.normalize(path.relative(root, file));
  if (allowedFiles.has(rel)) return true;
  return excludedPathFragments.some((fragment) => file.includes(fragment));
}

describe('global UI number formatting contract', () => {
  it('does not format displayed numbers with toFixed outside the central formatter or frozen printing scope', () => {
    const violations = collect(root)
      .filter((file) => !isExcluded(file))
      .filter((file) => fs.readFileSync(file, 'utf8').includes('.toFixed('))
      .map((file) => path.relative(process.cwd(), file).replace(/\\/g, '/'));

    expect(violations, `Use src/lib/format.ts helpers instead of direct toFixed() in UI:\n${violations.join('\n')}`).toEqual([]);
  });
});
