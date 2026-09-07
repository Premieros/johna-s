# FINAL REMAINING STAGES — Countdown to Handover

> هذا الملف هو عدّاد المراحل المتبقية حتى التسليم النهائي.
> Source of truth التفصيلي للأخطاء: `docs/FINAL_BUG_REGISTER.md`.
> Production checkpoint المرجعي: `docs/HANDOVER_CHECKPOINT_2026-09-06.md`.

## الحالة الحالية
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` فقط
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@85e6ce1df0f12b7eaca73ca283bef41a6703b828` — PR #48.
- Production SECURITY DEFINER legacy search-path deviations: **0** ✅.
- Stage 6: **CLOSED ✅**.
- Stage 4.1 Shift Cash Integrity + Branch Scope: **CLOSED ✅**.
- Stage 4.2 POS Operator Ownership & Table Transfer: **CLOSED ✅**.
- Stage 4.3 Remaining Published Operating Cycle: **ACTIVE 🟠**.

# المتبقي: 5 مراحل

## 5 → P0-C Auth Password Hardening 🔴
المؤكد حاليًا:
- Supabase Auth `Leaked Password Protection` ما زالت disabled.

الإغلاق يتطلب:
- تفعيل الحماية إذا سمحت المنصة/الخطة.
- اختبار Login / Create User / Password Update / Reset حسب العقد الحالي.
- إعادة Security Advisor.
- توثيق أي قيد منصة بدل ادعاء الإغلاق.

## 4 → P1-A Published Runtime / UI Zero-Drift Audit — ACTIVE 🟠
لا يحسب أي Runtime defect قبل إثباته. العمل منقسم إلى batches صغيرة قابلة للتحقق، ولا يتم دمج مشاكل مختلفة في refactor واسع.

### 4.1 Shift Cash Integrity + Branch Scope — CLOSED ✅
Evidence:
- PR #47 ✅.
- pre-merge Verify #875 Full Green ✅.
- merged `main@952c9954cbbebf760c44d75706ec569aac28a7bb` ✅.
- Production migration `shift_cash_integrity_and_scope` applied ✅.
- Production post-check ✅.
- merged-main Verify #876 Full Green ✅.
- Deploy #578 ✅.

### 4.2 POS Operator Ownership & Table Transfer — CLOSED ✅
العقد التشغيلي المحمي:
1. الوردية مشتركة على مستوى الفرع.
2. POS Permission-First، وSuper Admin فقط implicit bypass.
3. الطلب الجديد ينسب إلى `auth.uid()` ولا يسمح بانتحال cashier عاديًا.
4. صاحب الطلب فقط يعمل على الطلب المفتوح/المعلق وفق صلاحية الفعل المطلوبة.
5. مالك تشغيل طاولة Dine-in مشتق من الطلب النشط.
6. المستخدم الآخر يرى occupied + label الموظف فقط، ولا يستطيع تشغيل الطلب.
7. نقل المالك يحتاج `pos.order.transfer` مع same-branch fail-closed وأثر Audit.
8. KDS/item transfer/payment/status/direct DML fallbacks تخضع لنفس ownership contract.
9. shared-shift sale attribution محفوظ بدون duplicate shift operation.

Closure evidence:
- PR #48 ✅.
- final pre-merge head `c981cde7e919613399e41016924952ac965cbc00`.
- pre-merge Verify #887 / run `34156244462`: Full Green ✅ بما فيه Browser Smoke.
- merged `main@85e6ce1df0f12b7eaca73ca283bef41a6703b828` ✅.
- Production migrations applied on `azzdesuowpdcoflmyezn` ✅:
  - `20260907194314_pos_operator_ownership`
  - `20260907194337_pos_kitchen_send_ownership`
  - `20260907194427_pos_operator_rpc_ownership_hardening`
  - `20260907194454_pos_sale_shift_attribution`
- Production post-check: triggers/RPC grants/search_path/Stage 4.1 shift_operations privilege non-regression ✅.
- merged-main Verify #888 / run `34156540119`: Full Green ✅ including Fresh DB, Security/RLS and Browser Smoke.
- Deploy #579 / run `34156540094`, attempt 2: Production parity ✅ + Pages deploy ✅.
- `development/final-handover` fast-forwarded non-force to verified main before opening Stage 4.3 ✅.

### 4.3 Remaining Published Operating Cycle — ACTIVE 🟠
نختبر من الـcheckpoint ونحسب فقط الانحرافات المثبتة، بالترتيب:
- Login/bootstrap.
- opening balance / shared shift behavior.
- POS order types: Dine-in / Take Away / Drive Thru / Delivery / Quick Order.
- Send to Kitchen once / delta send / KDS lifecycle.
- inventory consumption وعدم double deduction.
- Cash/Card + discounts/voids/returns.
- hold/resume / split / merge / transfer حسب العقود.
- shift close + report + day-close/offline path حيث ينطبق.
- products / recipes / components / costing.
- reports.
- guided routing للخطوات الإلزامية.
- Desktop/Mobile + RTL/LTR + navigation.

قاعدة Stage 4.3:
- لا إعادة فتح 4.1/4.2 بدون Regression مثبت.
- كل defect جديد يجب أن يكون reproduced أو مثبت بعقد مباشر قبل إضافته إلى Bug Register.
- إصلاح root cause واحد في batch صغيرة، ثم Full Verify قبل الدمج/Production.

## 3 → P2 Printing Finalization 🟡
`set_print_status(uuid,text)` search-path defect مغلق بالفعل بواسطة PR #46؛ المتبقي Functional Runtime فقط.

الإغلاق الوظيفي يتطلب:
- cashier/kitchen/barista stations.
- fallback station behavior.
- first print/reprint تحت صلاحيات واضحة.
- منع duplicate print غير المصرح به.
- receipt + kitchen ticket.
- shift close report + day close report.
- cross-branch isolation.
- offline behavior حيث ينطبق.

## 2 → Release Hardening / Protection / Final Gates 🟠
المؤكد حاليًا:
- `main` غير Protected / لا توجد required checks مفروضة على الفرع.

الإغلاق يتطلب:
- Full Verify نهائي.
- Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Production parity.
- verified-main deploy فقط.
- Runtime smoke كامل.
- تفعيل branch protection إن سمحت صلاحيات GitHub، أو توثيق القيد وعدم الادعاء بالإغلاق.

## 1 → Final Handover + Cleanup + Zero-Drift Report 🟢
الإغلاق يتطلب:
- `Published Site = Verified Main = Production DB Contract = Zero Drift`.
- تحديث checkpoint/HANDOVER النهائي.
- مزامنة السجلات وعدم ترك documentation drift.
- تنظيف scoped فقط بعد التأكد من عدم وجود عمل غير مدمج.
- إبقاء `main` و`development/final-handover` كفروع دائمة.

# قاعدة العدّ التنازلي
`5 → 4 → 3 → 2 → 1 → 0`

لا تنخفض مرحلة إلا بعد:
`Regression → Full Verify → Merge → Production migration/parity عند الحاجة → Post-Check → merged-main Verify → Deploy/Runtime verification`.

# قواعد الإصلاح والتنظيف
1. إصلاح الجذر الذي يزيل عدة أعراض متكررة أفضل من ترقيع كل عرض منفصل.
2. لا يتم جمع مشاكل مختلفة تحت تغيير واسع غير مبرر.
3. إزالة التكرار/التعليقات/الاختبارات القديمة داخل نطاق الإصلاح فقط.
4. لا broad refactor غير مرتبط.
5. لا حذف أو إضعاف RLS/tests.
6. Super Admin فقط implicit bypass؛ باقي الأدوار Labels.
7. قبل كل WRITE: إعادة جلب HEAD ومراجعة commits المتوازية.
8. لا force push.
9. لا Production DDL قبل Full Verify.
10. تحديث `FINAL_BUG_REGISTER.md` والـcheckpoint بعد كل batch مغلق أو عند اعتماد عقد تشغيلي جديد مؤثر على خطة التسليم.

# الحالة التالية مباشرة
**Remaining = 5**

العمل النشط: **Stage 4.3 — Remaining Published Operating Cycle**، بدءًا من Login/bootstrap ثم shared shift ثم دورة POS/KDS/inventory/payment الكاملة، مع تسجيل الانحرافات المثبتة فقط.