import { describe, expect, it } from 'vitest';
import { userFacingErrorMessage } from '../../src/lib/userFacingError';

describe('userFacingErrorMessage', () => {
  it('explains role assignment permission failures to Arabic users', () => {
    const msg = userFacingErrorMessage(
      'PERMISSION_DENIED: cannot assign role containing permission pos.payment.take',
      'ar',
    );
    expect(msg).toContain('لا يمكنك تعيين هذا الدور');
    expect(msg).toContain('تحصيل المدفوعات');
    expect(msg).toContain('pos.payment.take');
  });

  it('explains explicit required permissions', () => {
    expect(userFacingErrorMessage('PERMISSION_DENIED:users.create', 'ar'))
      .toContain('إنشاء المستخدمين');
  });

  it('prefers sent-item approval codes over the generic approval substring', () => {
    const msg = userFacingErrorMessage(
      'SENT_ITEM_APPROVAL_REQUIRED: use the controlled void path',
      'ar',
    );
    expect(msg).toContain('أُرسل للمطبخ');
    expect(msg).not.toBe('هذه العملية تحتاج موافقة قبل تنفيذها.');
  });

  it('explains branch scope errors', () => {
    expect(userFacingErrorMessage('TARGET_OUT_OF_SCOPE', 'ar')).toContain('فرع');
    expect(userFacingErrorMessage('BRANCH_ACCESS_DENIED', 'ar')).toContain('الفروع المسموح');
  });

  it('explains sent-item ownership void failures instead of showing a generic system error', () => {
    expect(userFacingErrorMessage('ORDER_OPERATOR_REQUIRED', 'ar')).toContain('مستخدم آخر');
    expect(userFacingErrorMessage('SENT_ITEM_NOT_FOUND', 'ar')).toContain('الصنف المرسل');
    expect(userFacingErrorMessage('VOID_QUANTITY_EXCEEDS_SENT', 'ar')).toContain('كمية الإلغاء');
  });

  it('explains POS transfer and cancellation guard codes without falling back to the generic system error', () => {
    const cases = [
      ['REASON_REQUIRED', 'سبب'],
      ['SENT_ORDER_CANCEL_REQUIRES_CONTROLLED_VOID', 'Void'],
      ['TARGET_ORDER_OPERATOR_REQUIRED', 'الطاولة المستهدفة'],
      ['TARGET_ORDER_NOT_FOUND', 'الطلب'],
      ['CROSS_BRANCH_ORDER_ITEM_MOVE', 'فرع'],
      ['ORDER_TRANSFER_RPC_REQUIRED', 'النقل'],
      ['POS_ADMIN_PERMISSION_REQUIRED', 'المستخدمين الآخرين'],
      ['BRANCH_MISMATCH', 'فرع'],
      ['ORDER_ITEM_NOT_FOUND', 'الصنف'],
      ['ORDER_ITEMS_REQUIRED', 'صنف'],
      ['TARGET_TABLE_NOT_FOUND', 'الطاولة'],
      ['SAME_TABLE', 'طاولة مختلفة'],
      ['SOURCE_NOT_DINE_IN', 'الصالة'],
      ['NUMBERING_FAILED', 'رقم'],
      ['TRANSACTION_FAILED', 'لم يتم اعتماد التغيير'],
    ] as const;

    for (const [code, expected] of cases) {
      const message = userFacingErrorMessage(code, 'ar');
      expect(message).toContain(expected);
      expect(message).not.toContain('خطأ في النظام');
    }
  });

  it('explains inventory and purchase relationship errors', () => {
    expect(userFacingErrorMessage('INSUFFICIENT_STOCK', 'ar')).toContain('المخزون');
    expect(userFacingErrorMessage('WAREHOUSE_BRANCH_MISMATCH', 'ar')).toContain('المستودع');
    expect(userFacingErrorMessage('SUPPLIER_BRANCH_MISMATCH', 'ar')).toContain('المورد');
  });

  it('explains common database constraint errors without exposing SQL', () => {
    const duplicate = userFacingErrorMessage(
      'duplicate key value violates unique constraint "users_username_key" (SQLSTATE 23505)',
      'ar',
    );
    expect(duplicate).toContain('سجل بنفس البيانات');
    expect(duplicate).not.toContain('SQLSTATE');

    const foreignKey = userFacingErrorMessage(
      'update or delete violates foreign key constraint (23503)',
      'ar',
    );
    expect(foreignKey).toContain('مرتبط ببيانات أخرى');
  });

  it('explains RLS and network errors', () => {
    expect(userFacingErrorMessage('new row violates row-level security policy', 'ar'))
      .toContain('صلاحية الوصول');
    expect(userFacingErrorMessage('Failed to fetch', 'ar')).toContain('الاتصال بالخادم');
  });

  it('preserves already-friendly Arabic messages', () => {
    const friendly = 'لا يمكن إغلاق الشفت قبل إنهاء الطلبات المفتوحة.';
    expect(userFacingErrorMessage(friendly, 'ar')).toBe(friendly);
  });

  it('returns a safe generic message for unknown technical errors', () => {
    const msg = userFacingErrorMessage('PostgREST PGRST999 internal parser failure', 'ar');
    expect(msg).toContain('خطأ في النظام');
    expect(msg).not.toContain('PGRST999');
  });

  it('provides English messages when the UI is English', () => {
    expect(userFacingErrorMessage('EMAIL_TAKEN', 'en')).toContain('already used');
    expect(userFacingErrorMessage('TARGET_OUT_OF_SCOPE', 'en')).toContain('branch');
  });
});
