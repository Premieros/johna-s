# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> هذا هو السجل الحي المختصر للمشروع. للتفاصيل التاريخية راجع `docs/STABILIZATION_WORK_LOG.md` و`docs/PLAN_CHECKPOINT_2026-09-13.md` و`docs/STABILIZATION_WORK_LOG_2026-09-13_ADDENDUM.md`.

آخر تحديث: **2026-09-13 — PR5 Sales/POS/Kitchen closeout**

> **تصحيح الحالة الحالية — 2026-09-13:** الأقسام الخاصة بـPR5 أدناه محفوظة كسجل تاريخي وليست المرحلة الحالية. PR5 (#99) وPR6 (#100) تم دمجهما، ثم تم دمج PR #101. المرحلة الحالية هي **PR7 Confirmed Legacy Cleanup** على `development/pr7-confirmed-legacy-cleanup`، وPR الحالي هو **#105**. Baseline الحالي `main@2ba3deab61b519a6950656efb4badbc1880f4e19`. Implementation head `35e59c0f273c1557a69ab75060054efca103d5fd` اجتاز Verify #1279 Full Green، وملف الإغلاق الحالي هو `docs/PR7_CONFIRMED_LEGACY_CLEANUP_CLOSURE.md`. PR #103 وPR #78 مساران منفصلان ولا يختلطان بـPR7. لا يتم دمج PR7 قبل Full Verify على final PR head وموافقة المستخدم الصريحة.

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
- PR4 Purchases End-to-End — PR #98 ✅ merged; post-merge Verify main #1245 + Deploy #625 Green

الحالي:

- **PR5 Sales / POS / Tables / Kitchen / Payments — PR #99 / `development/pr5-sales-pos-kitchen`**

التالي فقط بعد إغلاق PR5 ونجاح post-merge Verify/Deploy:

1. PR6 Shift / Finance / Reports
2. PR7 Confirmed Legacy Cleanup

`Premier Print Agent` / PR #78 مسار مستقل ولا يختلط بهذه المراحل.

## Baseline PR5

- بدأ من `main@eaed1c4aee771d2f5ed3c5722e2f1daedcddd0ca` بعد إغلاق PR4.
- Baseline post-merge لـPR4: Verify main #1245 Full Green؛ Deploy #625 ✅؛ Production API parity ✅؛ Browser Smoke ✅.
- لا Production write ولا migration جديدة في PR5.

## PR5 — Sales / POS / Tables / Kitchen / Payments

المسار المدقق:

`POS order -> table/operator ownership -> send_to_kitchen -> inventory delta -> payment/settlement -> offline/reconciliation safeguards`

### العقود المثبتة ولم تُفتح بلا Regression

- Permission-First بصلاحيات POS منفصلة مثل view/create/edit/pay/split/transfer/receipt/send-kitchen؛ لا role-name authorization جديد.
- `send_to_kitchen` هو authority لاستهلاك Kitchen ويقفل الطلب بـ`FOR UPDATE` قبل حساب الـpositive unsent delta.
- `inventory_warehouse_id` يثبت على الطلب؛ لا silent cross-warehouse switch لطلب قائم في Kitchen/settlement.
- إعادة الإرسال بدون زيادة كمية = no-op ولا تكرر الخصم.
- Normal/Split settlement لا يعيدان خصم ما استهلكه Kitchen Send.
- Split payment atomic.
- Offline/reconciliation لا يحوّل rejection/ambiguous online failure إلى sale/payment success وهمي ويحافظ على idempotency/cashier identity.
- occupied table/order ownership وoperator display يبقون scoped ولا يوسعون `users.view`.

### Gap المثبت

التغطية السابقة لم تثبت صراحة سباقًا حقيقيًا بين جلستين PostgreSQL مستقلتين تستدعيان `send_to_kitchen` لنفس الطلب بينما الجلسة الأولى ما زالت تحتفظ بقفل صف الطلب.

### Change

`tests/integration/kitchen_send_concurrency.test.ts` فقط:

- Session A ترسل للمطبخ وتبقي transaction مفتوحة.
- Session B تستدعي نفس RPC لنفس order وتثبت أنها تنتظر القفل.
- بعد Commit لـA، Session B تستكمل كـsuccessful no-op (`items_sent_count = 0`).
- المخزون ينقص مرة واحدة فقط.
- KDS / `order_kitchen_sends` ينتج صفًا واحدًا فقط، بلا duplicate.

الاختبار نجح على Fresh DB؛ لذلك لم يتم تغيير SQL أو Business Logic أو إضافة migration.

سجل الإغلاق التفصيلي: `docs/PR5_SALES_POS_KITCHEN_CLOSURE.md`.

## UX Acceptance Gate

**UX Acceptance Gate: For every active phase, review affected screens/dialogs for missing required actions, duplicate controls/content, unclear labels/status/help, and unnecessary steps. Apply small behavior-preserving UX improvements within the phase scope. Do not broaden into redesign or alter authorization/business rules.**

في PR5 تمت مراجعة POS/Kitchen/Payments/Tables مع الحفاظ على Arabic-first/RTL والصلاحيات. لم يظهر UX Regression مثبت يحتاج تغييرًا، لذلك لم يُدخل redesign أو cosmetic change بلا سبب.

## Data Preservation Lock

- Production ليست test environment.
- لا حذف أو تصفير أو إعادة Seed.
- لا تعديل يدوي لبيانات Production لتجاوز مشكلة.
- لا cross-branch ولا cross-warehouse fallback.
- أي تغيير تاريخي للبيانات يحتاج سببًا مثبتًا وmapping واضحًا ونطاقًا مستقلاً.

## التنفيذ القياسي

`Baseline -> Root cause -> Small change -> Focused tests -> Integration/Regression -> Full Verify -> Merge -> Verify main -> Deploy`

لا يُغيّر Business Logic صحيح لإرضاء اختبار خاطئ أو لمجرد توسيع حجم PR.

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

1. حدّث سجلات PR5 (`STABILIZATION_WORK_LOG` / addendum) بدون حذف التاريخ.
2. Full Verify على documentation-complete HEAD لـPR #99.
3. إذا Green: راجع diff/mergeability، حوّل PR من Draft، وادمج بـexpected head SHA.
4. تحقق من Verify main وDeploy بعد الدمج.
5. لا تبدأ PR6 قبل نجاح post-merge gates.
