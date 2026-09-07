# FINAL REMAINING STAGES — Countdown to Handover

> هذا الملف هو عدّاد المراحل المتبقية حتى التسليم النهائي.
> Source of truth التفصيلي للأخطاء: `docs/FINAL_BUG_REGISTER.md`.
> Production checkpoint المرجعي: `docs/HANDOVER_CHECKPOINT_2026-09-06.md`.

## الحالة الحالية
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` فقط
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@952c9954cbbebf760c44d75706ec569aac28a7bb` — PR #47.
- Stage 4.1 Verify #875 ✅ / merged-main Verify #876 ✅ / Deploy #578 ✅.
- Production SECURITY DEFINER legacy search-path deviations: **0** ✅.
- Stage 6 مغلقة بالكامل ولا تعاد إلا عند Regression مثبت.
- Stage 4.1 Shift Cash Integrity + Branch Scope: **CLOSED ✅**.
- Stage 4.2 POS Operator Ownership & Table Transfer: **PRE-MERGE FULL GREEN ✅ via PR #48 / Verify #885**.

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
تم الإغلاق على Production:
- منع direct authenticated DML على `shift_operations` خارج RPCs الموثوقة.
- توحيد معادلة expected cash بين get/close/force-close.
- canonical branch access ومنع cross-branch status oracle.
- الحفاظ على shared branch shift contract وPermission-First.

Evidence:
- PR #47 ✅.
- pre-merge Verify #875 Full Green ✅.
- merged `main@952c9954cbbebf760c44d75706ec569aac28a7bb` ✅.
- Production migration `shift_cash_integrity_and_scope` applied ✅.
- Production post-check ✅.
- merged-main Verify #876 Full Green ✅.
- Deploy #578 ✅.

### 4.2 POS Operator Ownership & Table Transfer — PRE-MERGE FULL GREEN ✅
العقد التشغيلي الرسمي:
1. الوردية مفتوحة على مستوى الفرع ومشتركة بين المستخدمين المخولين، وليست Shift مستقلًا لكل كاشير.
2. أي مستخدم نشط يملك `shifts.open` + branch access يستطيع فتح Shift الفرع؛ إذا كانت مفتوحة يعاد نفس shift.
3. أي مستخدم يملك صلاحيات POS اللازمة يستطيع العمل على شاشة البيع داخل فرعه.
4. كل Order جديد ينسب إلى `auth.uid()`؛ لا يسمح للمستخدم العادي بانتحال `cashier_id` لمستخدم آخر.
5. صاحب الطلب فقط يستطيع تعديل/استكمال/دفع/إلغاء/تحريك طلبه وفق الصلاحيات التفصيلية اللازمة.
6. طاولة Dine-in تستمد مالك التشغيل من الطلب المفتوح/المعلق المرتبط بها.
7. باقي مستخدمي الفرع يمكنهم رؤية أن الطاولة مشغولة واسم الموظف المسؤول عنها، لكن لا يمكنهم العمل عليها.
8. نقل الطلب/الطاولة من مستخدم إلى آخر يحتاج `pos.order.transfer`، وليس اسم دور.
9. النقل يثبت أن source user / target user / order / table ضمن نفس الفرع المصرح، مع Audit للمالك القديم والجديد والمنفذ والوقت.
10. Super Admin فقط يحتفظ بالـimplicit bypass؛ بقية الأدوار Labels فقط.
11. Enforcement Server-Side/RPC/RLS-safe؛ إخفاء الأزرار وحده غير كافٍ.
12. create/update/hold/payment/cancel/table-transfer/item-transfer التي تلمس Order مفتوح تخضع لنفس ownership contract.

المغلق في كود PR #48:
- pinning ownership لإنشاء الطلب على authenticated operator.
- owner-only mutation guards لمسارات الطلب وعناصره والتحريك التشغيلي للطاولة.
- dedicated audited `transfer_order_operator` بصلاحية `pos.order.transfer` وsame-branch fail-closed.
- منع kitchen delta/send من مستخدم غير المالك قبل النقل.
- إزالة direct-DML fallbacks من floor-plan API؛ RPC هو authority ويفشل مغلقًا.
- عرض narrow operator label للطاولة المشغولة.
- ownership hardening لمسارات status/payment/item transfer.
- shared-shift sale attribution للمستخدم الذي يملك `shifts.manage` بدون duplicate shift operation.
- Browser Smoke mock محدث لعقد `get_pos_order_operator_labels` بدل تغيير runtime سليم.

Pre-merge evidence:
- PR #48 head verified: `bfc50500c1db23eefbc67967a402101555d51e1d`.
- Verify #885 / run `34155863941`: **Full Green ✅**.
- Frontend/API/lint/typecheck/unit/build ✅.
- Fresh migrations + schema ✅.
- Integration + Security/RLS ✅.
- Browser Smoke / Playwright ✅.

الإغلاق المتبقي فقط:
`Merge -> Production migrations/parity -> Production Post-Check -> merged-main Verify + Browser Smoke -> Deploy`.

لا تعتبر Stage 4.2 CLOSED قبل اكتمال هذه السلسلة.

### 4.3 Remaining Published Operating Cycle — NEXT بعد إغلاق 4.2
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

العمل النشط: **Stage 4.2 / PR #48 — POS Operator Ownership & Table Transfer** في بوابة الإغلاق بعد pre-merge Full Green. بعد اكتمال Merge + Production parity + merged-main Verify + Deploy يبدأ **Stage 4.3 — Remaining Published Operating Cycle**.