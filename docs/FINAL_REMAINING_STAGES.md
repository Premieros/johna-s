# FINAL REMAINING STAGES — Countdown to Handover

> هذا الملف هو عدّاد المراحل المتبقية حتى التسليم النهائي.
> Source of truth التفصيلي للأخطاء: `docs/FINAL_BUG_REGISTER.md`.
> أحدث Production checkpoint: `docs/HANDOVER_CHECKPOINT_2026-09-06.md`.

## الحالة الحالية
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` فقط
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@8b671fca36d60a200e743a2192581d83c3fa1f6e` — PR #46.
- PR #46 Verify #864 ✅ / merged-main Verify #865 ✅ / Deploy #577 ✅.
- Production SECURITY DEFINER legacy search-path deviations: **0** ✅.
- Stage 6 مغلقة بالكامل ولا تعاد إلا عند Regression مثبت.

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
لا يحسب أي Runtime defect قبل إثباته. العمل الحالي منقسم إلى batches صغيرة قابلة للتحقق، ولا يتم دمج مشاكل مختلفة في refactor واسع.

### 4.1 Shift Cash Integrity + Branch Scope — ACTIVE via PR #47
الهدف:
- منع direct authenticated DML على `shift_operations` خارج RPCs الموثوقة.
- توحيد معادلة expected cash بين get/close/force-close.
- استخدام canonical branch access ومنع cross-branch status oracle.
- الحفاظ على shared branch shift contract وPermission-First.

الإغلاق يتطلب:
`Regression -> Full Verify -> Merge -> Production migration/parity -> Post-Check -> merged-main Verify -> Deploy`.

### 4.2 POS Operator Ownership & Table Transfer — QUEUED بعد إغلاق 4.1
العقد التشغيلي الرسمي:
1. الوردية مفتوحة على مستوى الفرع ومشتركة بين المستخدمين المخولين، وليست Shift مستقلًا لكل كاشير.
2. أي مستخدم نشط يملك `shifts.open` + branch access يستطيع فتح Shift الفرع؛ إذا كانت مفتوحة يعاد نفس shift.
3. أي مستخدم يملك صلاحيات POS اللازمة يستطيع العمل على شاشة البيع داخل فرعه.
4. كل Order جديد ينسب افتراضيًا إلى `auth.uid()`؛ لا يسمح للمستخدم العادي بانتحال `cashier_id` لمستخدم آخر.
5. صاحب الطلب فقط يستطيع تعديل/استكمال/دفع/إلغاء/تحريك طلبه وفق الصلاحيات التفصيلية اللازمة.
6. طاولة Dine-in تستمد مالك التشغيل من الطلب المفتوح/المعلق المرتبط بها؛ لا نكرر owner داخل `dining_tables` بلا حاجة ما لم يثبت احتياج مستقل.
7. باقي مستخدمي الفرع يمكنهم رؤية أن الطاولة مشغولة واسم الموظف المسؤول عنها، لكن لا يمكنهم العمل عليها.
8. نقل الطلب/الطاولة من مستخدم إلى آخر يحتاج صلاحية نقل مستقلة ومحددة، وليس اسم دور مثل `manager`.
9. النقل يجب أن يثبت أن source user / target user / order / table كلها ضمن نفس الفرع المصرح، مع Audit واضح للمالك القديم والجديد والمنفذ والوقت والسبب إن كان مطلوبًا.
10. Super Admin فقط يحتفظ بالـimplicit bypass؛ بقية الأدوار Labels فقط.
11. Enforcement يجب أن يكون Server-Side/RPC/RLS-safe؛ إخفاء الأزرار في الواجهة وحده غير كافٍ.
12. جميع مسارات create/update/hold/payment/cancel/table-transfer/item-transfer التي تلمس Order مفتوح تخضع لنفس ownership contract، لمنع bypass عبر RPC أقدم أو direct table DML.

النقاط المؤكدة التي يجب إغلاقها في 4.2:
- `create_order(...)` يقبل حاليًا `p_cashier_id` ويمكنه نسبة الطلب لغير المستدعي دون عقد delegation واضح.
- `update_order(...)` يتحقق من الفرع لكنه لا يفرض أن المستدعي هو `orders.cashier_id` أو يملك override/transfer permission.
- table/order transfer paths الحالية تعتمد branch scope أكثر من owner + transfer permission.
- RLS الحالية على `orders` و`dining_tables` branch-scoped، لذلك يجب مراجعة direct UPDATE/INSERT paths حتى لا تتجاوز ownership RPCs.

اختبارات الإغلاق المطلوبة:
- User A وUser B في نفس الفرع ونفس الشفت.
- كلاهما يستطيع POS حسب صلاحياته.
- A ينشئ Order/Table؛ B يراه occupied باسم A لكنه لا يعدله/يدفعه/يلغيه/ينقله دون صلاحية.
- caller cannot spoof `cashier_id` عند إنشاء order.
- مستخدم يملك transfer permission يستطيع نقل Order/Table من A إلى B داخل نفس الفرع.
- مستخدم بلا transfer permission يفشل دون كشف معلومات إضافية.
- cross-branch target/source يفشل fail-closed.
- بعد النقل B يصبح owner التشغيلي، وA يفقد سلطة التعديل العادية.
- Audit + KDS + inventory + payment attribution لا تتكسر بعد النقل.

### 4.3 Remaining Published Operating Cycle
بعد 4.1 و4.2:
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

العمل النشط: **Stage 4.1 / PR #47 — Shift Cash Integrity**. بعد إغلاقها مباشرة يبدأ **Stage 4.2 — POS Operator Ownership & Table Transfer** قبل استكمال بقية دورة Runtime.
