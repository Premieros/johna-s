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
  it('keeps the permission name from structured RPC errors', () => {
    const msg = userFacingErrorMessage(
      { error: 'PERMISSION_DENIED', permission: 'pos.payment.take' },
      'ar',
    );
    expect(msg).toContain('تحصيل المدفوعات');
    expect(msg).toContain('pos.payment.take');
  });

  it('translates common POS/KDS operational codes instead of exposing raw codes', () => {
    expect(userFacingErrorMessage('POS_KDS_VIEW_REQUIRED', 'ar')).toContain('شاشة المطبخ');
    expect(userFacingErrorMessage('POS_KDS_UPDATE_REQUIRED', 'ar')).toContain('تحديث حالة المطبخ');
    expect(userFacingErrorMessage('TABLE_BUSY', 'ar')).toContain('الطاولة');
    expect(userFacingErrorMessage('ORDER_NOT_FOUND', 'ar')).toContain('الطلب');
    expect(userFacingErrorMessage('BRANCH_REQUIRED', 'ar')).toContain('الفرع');
    expect(userFacingErrorMessage('RAW_MATERIAL_NOT_IN_BRANCH', 'ar')).toContain('خامات');
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

  it('explains work authorization revocation without exposing a technical code', () => {
    const ar = userFacingErrorMessage('WORK_AUTHORIZATION_REQUIRED', 'ar');
    const en = userFacingErrorMessage('WORK_AUTHORIZATION_REQUIRED', 'en');
    expect(ar).toContain('تصريح العمل');
    expect(ar).toContain('موافقة المسؤول');
    expect(ar).not.toContain('WORK_AUTHORIZATION_REQUIRED');
    expect(en).toContain('Work authorization');
  });

  it('explains sent-item ownership void failures instead of showing a generic system error', () => {
    expect(userFacingErrorMessage('ORDER_OPERATOR_REQUIRED', 'ar')).toContain('مستخدم آخر');
    expect(userFacingErrorMessage('SENT_ITEM_NOT_FOUND', 'ar')).toContain('الصنف المرسل');
    expect(userFacingErrorMessage('VOID_QUANTITY_EXCEEDS_SENT', 'ar')).toContain('كمية الإلغاء');
  });

  it('explains transfer and controlled cancellation failures instead of falling back to the generic system error', () => {
    expect(userFacingErrorMessage('REASON_REQUIRED', 'ar')).toContain('سبب');
    expect(userFacingErrorMessage('SENT_ORDER_CANCEL_REQUIRES_CONTROLLED_VOID', 'ar')).toContain('Void');
    expect(userFacingErrorMessage('TARGET_ORDER_OPERATOR_REQUIRED', 'ar')).toContain('مستخدم آخر');
    expect(userFacingErrorMessage('TARGET_ORDER_NOT_FOUND', 'ar')).toContain('الطلب الهدف');
    expect(userFacingErrorMessage('CROSS_BRANCH_ORDER_ITEM_MOVE', 'ar')).toContain('فرعين');
    expect(userFacingErrorMessage('ORDER_TRANSFER_RPC_REQUIRED', 'ar')).toContain('زر النقل');
    expect(userFacingErrorMessage('TRANSACTION_FAILED', 'ar')).toContain('لم يتم اعتماد تغيير جزئي');
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
  it('does not expose unknown uppercase technical codes in English', () => {
    const msg = userFacingErrorMessage('SOME_NEW_INTERNAL_CODE', 'en');
    expect(msg).toContain('system error');
    expect(msg).not.toContain('SOME_NEW_INTERNAL_CODE');
  });

  it('keeps ownership errors action-neutral instead of demanding unrelated permissions', () => {
    const msg = userFacingErrorMessage('ORDER_OPERATOR_REQUIRED', 'ar');
    expect(msg).toContain('مستخدم آخر');
    expect(msg).toContain('الإجراء الحالي');
    expect(msg).not.toContain('إدارة ونقل');
  });


  it('provides English messages when the UI is English', () => {
    expect(userFacingErrorMessage('EMAIL_TAKEN', 'en')).toContain('already used');
    expect(userFacingErrorMessage('TARGET_OUT_OF_SCOPE', 'en')).toContain('branch');
  });
});
