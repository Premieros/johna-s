import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const toastSource = readFileSync('src/components/Toast.tsx', 'utf8');

describe('sent-item approval user-facing error contract', () => {
  it('maps internal sent-item guard codes to a safe Arabic POS instruction', () => {
    expect(toastSource).toContain("'SENT_ITEM_APPROVAL_REQUIRED'");
    expect(toastSource).toContain("'SENT_ITEM_CHANGE_REQUIRES_VOID'");
    expect(toastSource).toContain("'SENT_ITEM_VOID_INCOMPLETE'");
    expect(toastSource).toContain('استخدم إلغاء الصنف (Void)');
    expect(toastSource).toContain('سجل إرسال المطبخ والمخزون غير متزامن');
    expect(toastSource).toContain('normalizeToastMessage(message, type)');
  });
});
