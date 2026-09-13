# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> هذا هو السجل الحي المختصر للمشروع. للتفاصيل التاريخية راجع `docs/STABILIZATION_WORK_LOG.md` و`docs/PLAN_CHECKPOINT_2026-09-13.md` و`docs/STABILIZATION_WORK_LOG_2026-09-13_ADDENDUM.md`.

آخر تحديث: **2026-09-13 — PR4 Purchases closure**

## الهوية الثابتة

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Published site: `https://premieros.github.io/johna-s/`
- ممنوع لمس أي Repository أو قاعدة أخرى.
- ممنوع استخدام `scpovyrqmsbiduanykod`.
- ممنوع تعديل `main` مباشرة أو Force Push.
- Super Admin فقط implicit bypass؛ باقي الأدوار Labels وAuthorization = Permission-First + branch/RLS.
- ممنوع تخفيف RLS أو الاختبارات.
- ممنوع reset/reseed/delete/rewrite لبيانات المستخدم أو الإعدادات أو الأرصدة لتسهيل الاختبار أو refactor.
- أي Migration: forward-only + append-only؛ لا تعديل Migration مطبقة.
- لا Production migration قبل Full Verify Green.
- قبل كل write/merge: اجلب أحدث `main` والفرع/PR وافحص أي عمل أحدث.

## المراحل

مغلق ومثبت:

- PR1 Architecture / Simplification Map ✅
- PR2 Inventory Contracts ✅
- PR3 Catalog 6A/6B/6C/6D ✅

الحالي:

- **PR4 Purchases End-to-End — PR #98 / `development/pr4-purchases`**

التالي فقط بعد إغلاق PR4 ونجاح post-merge Verify/Deploy:

1. PR5 Sales / POS / Tables / Kitchen / Payments
2. PR6 Shift / Finance / Reports
3. PR7 Confirmed Legacy Cleanup

`Premier Print Agent` / PR #78 مسار مستقل ولا يختلط بهذه المراحل.

## Baseline PR4

- بدأ من `main@658b86c91a120c7e634250758a38d4895ff72b9a` (PR #97 merge).
- Baseline: Verify main #1236 Full Green؛ Deploy #624 ✅.
- Implementation/test head `6841962e5c65b9356033370d645a13e4cbe1aec5` اجتاز Verify #1241 Full Green:
  - lint ✅
  - typecheck + test typecheck ✅
  - unit ✅
  - build ✅
  - Fresh DB migrations ✅
  - schema ✅
  - integration/security/RLS ✅
  - Browser Smoke ✅
- سجل الإغلاق التفصيلي: `docs/PR4_PURCHASES_CLOSURE.md`.
- لأن تحديث التوثيق غيّر HEAD، يلزم Full Verify أخير على الـHEAD النهائي قبل merge.

## PR4 — Purchases End-to-End

المسار:

`Purchase Request -> Submit/Approval -> RFQ/PO where applicable -> Receive -> Inventory/Ledger -> Supplier/Accounts -> Reports source`

المثبت مسبقًا ولم يُفتح بلا Regression: request/approval/PO transition، partial/full receive، over-receive guard، backorders، stock/journal effect، Permission-First drift sentinel، وتعديل الفواتير المكتملة بعقد Reverse -> Apply -> Recalculate -> Audit.

### Root cause المثبت

`receive_purchase_order` كان قد يصل إلى GRN/receipt writes قبل رفض Warehouse غير صالح في helper لاحق، ومع JSON validation failure كان يمكن ترك side effects جزئية.

### Fix

`supabase/migrations/20260913083000_purchase_receive_atomicity.sql`:

- Warehouse preflight قبل receipt allocation/writes.
- required + active + same branch.
- no branch/warehouse fallback.
- PO `FOR UPDATE` يبقى قبل receive writes.
- valid receive يكتب للمخزن الصحيح فقط.
- لا delete/reset/reseed/backfill/rewrite لبيانات موجودة.

### Regression

`tests/integration/purchase_receive_atomicity.test.ts` يثبت missing/cross-branch warehouse fail-closed، correct warehouse stock، Supplier/AP association، completed retry بدون duplicate side effects، وبقاء row lock.

`tests/integration/purchase_cancellation_contract.test.ts` يثبت الإلغاء قبل approval بلا stock/accounting effects ومنع الإلغاء بعد approval بـ`BAD_TRANSITION`.

لا dedupe تخميني بالكمية/hash: نفس كمية partial receive قد تكون استلامًا فعليًا جديدًا، ولا يوجد request-id مستقل يميز replay بأمان.

## UX Acceptance Gate

**UX Acceptance Gate: For every active phase, review affected screens/dialogs for missing required actions, duplicate controls/content, unclear labels/status/help, and unnecessary steps. Apply small behavior-preserving UX improvements within the phase scope. Do not broaden into redesign or alter authorization/business rules.**

في PR4: تمت مراجعة `ReceivingPage` لتحسين رسائل الاستلام الملموسة وتحديد كمية الإدخال بالمتبقي دون تغيير Authorization أو Business Logic، وبقي Arabic-first/RTL. لا redesign واسع ولا فتح Reports/POS بلا Regression.

## Data Preservation Lock

- Production ليست test environment.
- لا حذف أو تصفير أو إعادة Seed.
- لا تعديل يدوي لبيانات Production لتجاوز مشكلة.
- لا cross-branch ولا cross-warehouse fallback.
- أي تغيير تاريخي للبيانات يحتاج سببًا مثبتًا وmapping واضحًا ونطاقًا مستقلاً.

## التنفيذ القياسي

`Baseline -> Root cause -> Small change -> Focused tests -> Integration/Regression -> Full Verify -> Merge -> Verify main -> Deploy`

لا يُغيّر Business Logic صحيح لإرضاء اختبار خاطئ.

## متطلبات ثابتة للمراحل التالية

- Arabic-first RTL + touch-friendly.
- Permission-First؛ Super Admin فقط implicit bypass.
- granular POS permissions تشمل view/create/edit/pay/split/transfer/receipt/send-kitchen.
- `send_to_kitchen` هو نقطة خصم المخزون؛ first send مرة ثم delta، وretry لا يكرر consumption.
- approval system enforced.
- username يظهر على الطاولة المشغولة وما يخص المستخدم حيث يلزم.
- printer management فقط لصاحب صلاحية الإعدادات.
- print once + controlled reprint، ولا physical print success كاذب.
- لا network/offline ambiguity تتحول إلى sale/payment success وهمي.
- Reports compact/tabular + filters + Excel export.
- guided prerequisite routing بدل raw errors حيث أمكن.

## NEXT ACTION

1. حدّث `STABILIZATION_WORK_LOG.md` بإغلاق PR4.
2. Full Verify على HEAD النهائي لـPR #98.
3. إذا Green: راجع diff/mergeability، حوّل PR من Draft، وادمج بـexpected head SHA.
4. تحقق من Verify main وDeploy بعد الدمج.
5. لا تبدأ PR5 قبل نجاح post-merge gates.
