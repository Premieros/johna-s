# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف ثم يجلب HEAD الحالي لـ`main` والفرع/PR المستهدف قبل أي تعديل، لأن نماذج أخرى قد تعمل بالتوازي.

آخر تحديث: **2026-09-12 — Backend Simplification Program (PR 1 merged / PR 2 pending)**

> **برنامج التبسيط النشط الحالي:** الحفاظ على كل Feature ظاهرة للمستخدم وهوية المشروع، وتبسيط البنية الخلفية فقط — إزالة الازدواج الداخلي، المسارات الميتة ببديل مثبت، والـ layers التاريخية، دون حذف أي Feature مستخدمة ودون فقد بيانات Production.
> **خريطة التصنيف الكاملة**: `docs/SIMPLIFICATION_MAP.md` (مخرَج PR 1 — جرد + تصنيف KEEP/MERGE/HIDE/LEGACY/REMOVE-LATER).
> ترتيب التنفيذ: **PR1** Map+Audit ✅ **مدمج** → **PR2** Inventory contracts (فعالة #86) → **PR3** Catalog → **PR4** Purchases → **PR5** Sales/POS/Kitchen → **PR6** Finance/Reports → **PR7** Legacy cleanup المؤكد.
> **PR 2:** `docs/INVENTORY_CONTRACTS.md` — عقود المخزون/التوفر canonical (توثيقي فقط؛ rebase فوق `main` المحدّث). أي تغيير سلوك لاحق يأتي في PR مستقل بإذن صريح.
> الفرع النشط: `development/inventory-contracts`. الـ migrations تضاف **forward-only** ولا تُعدَّل المطبَّقة؛ أي حذف بعد إثبات عدم الاستخدام و Regression Green.
> سجل التنفيذ التفصيلي: `docs/STABILIZATION_WORK_LOG.md`.

> إضافة داخل مسار Root Stage B: **Negative Raw-Material Inventory (sell-through allowance)** قيد الإغلاق — migration `20260911160000_negative_raw_material_inventory.sql` + عقود واختبارات + واجهة POS؛ سجل التنفيذ في `docs/STABILIZATION_WORK_LOG.md`.

## 1) الهوية الثابتة — غير قابلة للخلط

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Published site: `https://premieros.github.io/johna-s/`
- أي مشروع/مستودع آخر مثل `55` / `pos.v2` / `v4` / ZIP خارجي = **READ-ONLY REFERENCE ONLY**.
- ممنوع استخدام Supabase `scpovyrqmsbiduanykod` لهذا المشروع.
- ممنوع تعديل `main` مباشرة أو Force Push.
- ممنوع تشغيل Production migration قبل Full Verify Green وقرار نشر صريح.
- ممنوع تخفيف RLS أو حذف/إضعاف الاختبارات لإجبار CI على النجاح.
- Super Admin فقط implicit bypass.
- كل الأدوار الأخرى Labels فقط؛ Authorization = Permission-First + branch/RLS.
- قبل أي write: اجلب HEAD الحالي لـ`main` والفرع/PR المستهدف وافحص أي commits أحدث.
- عند الدمج استخدم expected SHA guard متى أمكن.

## 2) Baseline الحالي

- latest verified `main` عند إعادة ترتيب الخطة: `c462b2014671ed6a4cc003006c8ad87bf848cd21`.
- فرع التثبيت الحالي بعد إغلاق Stage 1: `development/stabilization-phase-2`.
- Stage 1 — Purchase Requests Permission Stabilization: **VERIFIED / Full Green** على Verify #1076 قبل تحديث هذه الخطة.
- PR #68 ما زال غير مدمج وقت إعادة ترتيب الخطة.
- Production Supabase لم تُطبق عليها migration بسبب Stage 1.
- `main` غير محمي حاليًا؛ يبقى Governance Risk ويعالج دون تعطيل المسار الوظيفي الحرج.
- لا تفترض أن أي SHA أعلاه ما زال الأحدث لاحقًا؛ fetch إلزامي قبل كل كتابة/دمج.

## 3) الهدف التنفيذي الجديد — أسرع طريق جذري آمن

بدل حل الشاشات واحدة واحدة، العمل من **الجذور المشتركة إلى النتائج**. أي عقد مشترك يُغلق مرة واحدة باختبارات Regression ثم يُعاد استخدامه في كل الوحدات التابعة.

الترتيب الإلزامي:

`Identity/Permissions/Branch/RLS -> Inventory/Ledger -> Purchases -> POS/Kitchen/Payments -> Shift/Reports -> Printing/Offline -> Cleanup`

### لماذا هذا الترتيب؟

- الصلاحيات والفروع/RLS تؤثر على كل شاشة، لذلك تُحسم أولًا.
- المخزون والـLedger هما المصدر المشترك للشراء، التوافر، الاستهلاك، الإرجاع والتقارير.
- المشتريات تغذي المخزون؛ لا نختبر POS availability قبل تثبيت الاستلام والمخزون.
- POS/Kitchen/Payments تعتمد على الهوية والمخزون والعقود المالية.
- Shift/Reports يجب أن تقرأ نتائج تشغيل مثبتة، لا بيانات غير مستقرة.
- Printing/Offline طبقة توصيل/مزامنة بعد ثبات المعاملة الأساسية.
- Cleanup يأتي أخيرًا بعد وجود Regression Safety Net.

## 4) قواعد التنفيذ السريع — إلزامية

### 4.1 Root cause قبل UI patch

عند ظهور مشكلة:

`UI symptom -> API/RPC -> Permission -> branch/RLS -> tables/ledger -> side effect -> test`

لا نصلح العرض فقط إذا كان السبب في العقد الخلفي.

### 4.2 اختبار واحد قد يغلق عدة شاشات

الأولوية لاختبارات العقود المشتركة، مثل:

- Permission-First helper/RPC contracts.
- branch + warehouse isolation.
- inventory posting/ledger idempotency.
- payment idempotency.
- kitchen delta/stock consumption.

### 4.3 PR صغير لكن Stage مجمّعة حول Dependency واحدة

PR واحد لا يجمع نطاقات غير مترابطة، لكن يمكن أن يغطي أكثر من شاشة عندما يكون **نفس العقد المشترك** هو السبب.

### 4.4 Test first عند تعديل سلوك قائم

`prove current/expected contract -> fix -> focused tests -> Full Verify`

### 4.5 لا حذف Legacy قبل الإثبات

`usage search -> contract map -> regression coverage -> remove -> Full Verify`

### 4.6 لا نجاح وهمي

- network/offline ambiguity لا تتحول إلى sale/payment success.
- غياب/فشل Print Agent لا يسجل physical print success.
- retry لا يكرر stock consumption أو payment أو ledger posting.

## 5) ROOT STAGE A — Identity / Permissions / Branch / RLS

**الأولوية: P0 — أول جذر مشترك**

### المطلوب

- Authentication identity ثابتة.
- `user -> allowed branches` مصدر واحد واضح.
- Permission-First لجميع العمليات؛ لا role-name authorization لغير Super Admin.
- approvals لها permissions وعقد Backend واضح، لا UI-only protection.
- settings/printer management لا يظهر إلا بالصلاحية المناسبة.
- warehouse operations تحمل branch + warehouse scope صريح.
- لا `branches[0]` fallback ولا cross-branch fallback.

### Regression contracts

- View Only دون Create/Edit.
- Pay Only دون منح إنشاء غير مطلوب.
- `pos.send_kitchen` مستقل.
- `pos.receipt.print` مستقل.
- same permission works regardless of role label.
- branch A user cannot read/write branch B data unless explicitly granted.

### شرط الإغلاق

Full Green + لا role-name auth drift + لا branch fallback مثبت.

## 6) ROOT STAGE B — Inventory / Ledger / Availability

**الأولوية: P0 — المصدر التشغيلي المشترك**

### الترتيب الداخلي

1. Raw Materials + immutable unit contract.
2. Manufactured Units / product composition.
3. Warehouses + branch/warehouse identity.
4. Purchase/receive posting into stock.
5. Transfers idempotently بين المخازن.
6. Availability من المصدر الصحيح للمخزن/BOM.
7. Ledger consistency مع كل حركة.

### العقود الثابتة

- المنتج نفسه لا يملك وحدة قياس خامات.
- raw material unit إلزامية عند الإنشاء وغير قابلة للتغيير بعد ذلك.
- `Inventory Units` يمكن عرضها كـ«المصنعات» مع إبقاء أسماء DB الداخلية.
- لا cross-branch stock fallback.
- transfer لا يخلق أو يضاعف stock.
- receive/retry لا يكرر stock أو ledger.

### شرط الإغلاق

دورة `setup -> receive -> transfer -> availability -> ledger` خضراء على Fresh DB.

## 7) ROOT STAGE C — Purchases End-to-End

مرجع الواجهة المنشورة:
`https://premieros.github.io/johna-s/#/purchases/requests`

Stage 1 أغلق Permission إنشاء Purchase Request. المتبقي هنا دورة المشتريات نفسها:

`Purchase Request -> Submit/Approval -> RFQ/PO as applicable -> Receive -> Inventory/Ledger -> Supplier/Account impact -> Reports source`

### يجب إثبات

- status transitions صحيحة.
- approval/reject permission contract صريح.
- branch + warehouse scope.
- requested vs received quantities.
- partial receive/backorder.
- duplicate receive protection.
- cancellation after/no receipt حسب العقد.
- supplier/account impact مرة واحدة فقط.
- لا بيانات فرع آخر.

### شرط الإغلاق

E2E مشتريات واحد يغطي الدورة كاملة + Full Green.

## 8) ROOT STAGE D — POS / Tables / Kitchen / Payments

### الترتيب الداخلي

1. POS granular permissions.
2. order create/edit + hold/resume.
3. Dining/table occupancy + operator username.
4. `send_to_kitchen` first send + delta changes.
5. stock consumption عند `send_to_kitchen` فقط.
6. KDS/station routing.
7. split/merge/transfer approvals.
8. partial/split payments.
9. returns/voids/partial voids.

### عقود لا تقبل الكسر

- first send مرة واحدة، ثم delta فقط.
- retry لا يسبب double consumption.
- View Only وPay Only حقيقيان.
- payment retry/offline ambiguity لا يعطي success وهمي.
- كل كيان مرتبط بالمستخدم يعرض اسمه حيث يلزم وضمن النطاق المسموح.

### شرط الإغلاق

Critical POS E2E أخضر من order حتى payment وreceipt contract.

## 9) ROOT STAGE E — Shift / Close / Reports

### المطلوب

- open shift/open balance.
- sales by shift.
- sales by user/operator.
- cash/card totals.
- drawer reconciliation.
- close shift/day.
- reports تقرأ المصدر المعاملي الصحيح ولا تعيد حساب أرقام مختلفة.
- صفحة تقارير واحدة compact/tabular، filters + Excel export، بدون charts.

### شرط الإغلاق

Totals للطلبات/الدفع/الشفت/التقارير متطابقة في E2E واحد.

## 10) ROOT STAGE F — Printing / Offline / Mobile

### Printing

- branch/station routing.
- cashier/kitchen/barista routing حسب الإعداد.
- queue success != physical print success.
- Print Agent failure لا يسجل completed كاذبًا.
- print once + controlled reprint.

### Offline/Reconciliation

- انقطاع الشبكة لا ينتج sale/payment نجاحًا وهميًا.
- retry/reconcile idempotent.
- close shift/day offline فقط حسب العقد المثبت.

### Mobile UX

- critical navigation/touch flows فقط؛ لا إعادة تصميم واسعة قبل استقرار الوظائف.

### شرط الإغلاق

Browser/mobile smoke + offline/reconciliation regression + printing truthfulness contract.

## 11) Critical E2E واحد يربط المراحل

بدل اختبارات متفرقة فقط، نبني ونوسع نفس الدورة الحرجة تدريجيًا:

`Login -> Branch -> Warehouse -> Raw/Manufactured/Product setup -> Purchase Request -> Purchase/Receive -> Availability -> Open Shift -> Order -> Send to Kitchen -> KDS -> Payment -> Receipt -> Close Shift -> Reports`

كل Root Stage تضيف جزءًا لهذه الدورة؛ لا نعيد بناء الاختبار من الصفر في كل مرحلة.

## 12) أعمال تسير بالتوازي ولا تعطل المسار الحرج

### Branch inventory cleanup

لكل فرع: `Merged / Superseded / Unique useful / Unknown`.

- لا حذف حسب العمر/الاسم.
- أي unique useful work يُستخرج إلى PR صغير من أحدث baseline.
- `Premieros-patch-1` مصنف حاليًا **Superseded/Dangerous — DO NOT MERGE** حتى اكتمال التدقيق.

### Governance

- محاولة حماية `main` عبر Ruleset/Branch Protection إن سمحت صلاحيات GitHub.
- عدم تعطيل إصلاحات P0 الوظيفية إذا لم تتوفر صلاحيات الإدارة.

### Contract Map

يُبنى فقط للعقود التي نلمسها فعليًا أولًا، بدل توثيق 18 نطاقًا بالكامل قبل بدء الإصلاح. الشكل الثابت:

`UI -> service/API/RPC -> tables/views -> permission -> RLS/branch scope -> side effects -> tests`

## 13) Safe Cleanup — بعد الجذور فقط

بعد وجود Regression Safety Net:

- duplicated helpers.
- dead components.
- obsolete RPCs.
- dangerous fallbacks.
- temporary adapters.
- unused imports/routes.

**Cleanup لا يغير business behavior إلا كتغيير مستقل ومثبت.**

## 14) Production Readiness & Rollout

قبل أي Final handover أو Production migration:

1. latest `main` fetched.
2. no unexplained drift.
3. locked Supabase identity ✅
4. frontend API contract ✅
5. lint ✅
6. typecheck app + tests ✅
7. unit ✅
8. build ✅
9. Fresh DB canonical migrations ✅
10. schema ✅
11. Integration ✅
12. Security/RLS ✅
13. Browser Smoke ✅
14. Critical E2E ✅
15. Offline/Reconciliation ✅
16. Printing truthfulness ✅
17. migration plan + rollback path إن وجدت migration.
18. explicit approval قبل أي Production write.

## 15) متطلبات ثابتة لا يجوز كسرها

- Arabic-first RTL، Touch-friendly.
- Permission-First؛ لا تستخدم أسماء roles كAuthorization.
- Super Admin فقط implicit bypass.
- Branch isolation عبر RLS على كل business data.
- `send_to_kitchen` هو نقطة خصم المخزون.
- POS granular permissions تشمل على الأقل:
  - `pos.view`
  - `pos.order.create`
  - `pos.order.edit`
  - `pos.payment.take`
  - `pos.order.split`
  - `pos.order.transfer`
  - `pos.receipt.print`
  - `pos.send_kitchen`
  - `pos.pay`
- Approval system enforced للعمليات الحساسة حسب العقد.
- Printer management لا يظهر إلا لصاحب صلاحية الإعدادات المناسبة.
- Hold/Resume، split، merge/transfer، print once + controlled reprint.
- لا network/offline ambiguity تتحول إلى sale/payment success وهمي.

## 16) Definition of Done

لا تعتبر Stabilization مغلقة إلا عندما:

- كل Root Stage A-F Full Green.
- Critical E2E يغطي الدورة الكاملة.
- لا cross-branch fallback.
- لا role-name authorization لغير Super Admin.
- source-of-truth التشغيلي لكل نطاق حرج واضح ومختبر.
- لا فرع/PR مجهول الغرض عند الإغلاق النهائي.
- الموقع المنشور يمر Browser Smoke + Critical E2E.
- Production DB لم تتعرض لأي migration غير verified.

## 17) NEXT ACTION — المسار المختصر الإلزامي

1. لا تبدأ Branch Cleanup كعمل حاجب للمشروع؛ اجعله Parallel housekeeping.
2. أغلق/ادمج Stage 1 فقط بعد التأكد من أحدث HEAD وCI وحالة PR #68 وفق مسار الدمج الآمن.
3. ابدأ مباشرة **ROOT STAGE A — Identity / Permissions / Branch / RLS** عبر contract search واختبارات مشتركة، وليس شاشة شاشة.
4. أول deviation مثبت داخل Stage A يُصلح من الجذر مع Regression test يغطي كل المستهلكين الممكنين.
5. بعد Full Green انتقل إلى Stage B، ثم C، ثم D، ثم E، ثم F دون إعادة فتح المغلق إلا Regression مثبت.
6. لا Production migration دون Full Verify Green + سبب موثق + موافقة صريحة.

لا تلمس أي مستودع أو قاعدة بيانات أخرى.
