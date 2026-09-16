import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const printing = fs.readFileSync(path.join(root, 'src/features/pos/utils/printing.ts'), 'utf8');
const hook = fs.readFileSync(path.join(root, 'src/features/pos/hooks/usePosOrderBase.ts'), 'utf8');

describe('kitchen ticket notes and paper height', () => {
  it('prints order and item notes in the kitchen ticket', () => {
    expect(printing).toContain('orderNote?: string | null');
    expect(printing).toContain('item-note');
    expect(printing).toContain('order-note');
    expect(hook).toContain('orderNote: orderNotes || null');
    expect(hook).toContain('note: i.notes || null');
    expect(hook).toContain('note: i.item_note || null');
  });

  it('uses compact content-based paper height instead of an 80mm minimum', () => {
    expect(printing).toContain('Math.max(45, Math.ceil(');
    expect(printing).not.toContain('Math.max(80, Math.ceil(');
    expect(printing).toContain('orderNoteLines');
    expect(printing).toContain('noteLines');
  });
});
