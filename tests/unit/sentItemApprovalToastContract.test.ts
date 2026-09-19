import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const toastSource = readFileSync('src/components/Toast.tsx', 'utf8');
const errorSource = readFileSync('src/lib/userFacingError.ts', 'utf8');

describe('sent-item approval user-facing error contract', () => {
  it('maps internal sent-item guard codes to safe Arabic POS instructions through the central translator', () => {
    expect(toastSource).toContain('userFacingErrorMessage');
    expect(toastSource).toContain('normalizeToastMessage(message, type)');
    expect(errorSource).toContain('SENT_ITEM_APPROVAL_REQUIRED:');
    expect(errorSource).toContain('SENT_ITEM_CHANGE_REQUIRES_VOID:');
    expect(errorSource).toContain('SENT_ITEM_VOID_INCOMPLETE:');
    expect(errorSource).toContain('استخدم إلغاء الصنف (Void)');
    expect(errorSource).toContain('تعذر مزامنة سجل إرسال المطبخ مع المخزون');
  });
});
