import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const workspace = fs.readFileSync(path.join(root, 'src/features/pos/pages/PosWorkspacePage.tsx'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'src/features/pos/components/order/CurrentOrderPanel.tsx'), 'utf8');
const voidModal = fs.readFileSync(path.join(root, 'src/features/pos/components/order/VoidItemModal.tsx'), 'utf8');

describe('sent-item edit safety contract', () => {
  it('blocks normal edits that reduce or change an already-sent line', () => {
    expect(workspace).toContain('sentQty > 0 && (identityChanged || item.quantity < sentQty)');
    expect(workspace).toContain('استخدم زر إلغاء الصنف (Void) أولًا');
  });

  it('keeps sent-line normal edit disabled so void is the controlled reduction path', () => {
    expect(panel).toContain('disabled={sent.sentQty > 0}');
    expect(panel).toContain("sent.sentQty > 0 ? (isAr ? 'مرسل' : 'Sent')");
  });

  it('explains direct-vs-approval void behavior accurately', () => {
    expect(voidModal).toContain('canDirectVoid: boolean');
    expect(voidModal).toContain('لديك صلاحية Void المباشرة');
    expect(voidModal).toContain('لا تملك صلاحية Void المباشرة');
    expect(voidModal).toContain('طلب موافقة على الإلغاء');
  });
});
