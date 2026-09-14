# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

آخر تحديث: **2026-09-15 — Status/Branch Registry Unification**

> هذا الملف هو **المصدر التنفيذي الوحيد للحقيقة**. أي Plan/Report/Closure/Addendum/Work Log أقدم هو مرجع تاريخي فقط ما لم يُذكر صراحة هنا أنه ACTIVE.

## الهوية الثابتة

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Published site: `https://premieros.github.io/johna-s/`
- ممنوع لمس أي Repository أو قاعدة أخرى.
- ممنوع استخدام `scpovyrqmsbiduanykod`.
- ممنوع تعديل `main` مباشرة أو Force Push.
- Super Admin فقط implicit bypass؛ باقي الأدوار Authorization = Permission-First + branch/RLS.
- ممنوع تخفيف RLS أو الاختبارات.
- ممنوع reset/reseed/rewrite لبيانات المستخدم أو الإعدادات أو الأرصدة لتسهيل الاختبار أو refactor.
- أي Migration: forward-only + append-only؛ لا تعديل Migration مطبقة.
- لا Production migration قبل Full Verify Green وموافقة صريحة منفصلة.
- قبل كل write/merge: اجلب أحدث `main` والفرع/PR وافحص أي عمل أحدث أو متوازٍ.

## Current verified baseline

- `main@5ec2e6267eae07cab4cd2283ebd5b95b90935293`
- آخر Merge على `main`: PR #125 — branch-scoped kitchen station hardening.
- PR #125 دخل بعد Full Verify #1370 Green.
- لم يتم تنفيذ Production migration ضمن Merge #125.

## العمل النشط الوحيد الآن

### PR #126 — ACTIVE / DRAFT / FULL VERIFY GREEN

- Branch: `development/kds-branch-fixture-stabilization`
- HEAD وقت تحديث السجل: `5f05954a7eea2a190469ffee522affd8c9ad8fb2`
- الهدف: إصلاح regression محدد في KDS station authorization بعد branch-scoping.
- Scope الحالي ضيق: fixture branch scoping + append-only compatibility migration للـstation resolution داخل branch الطلب.
- مجمّد وغير مسموح لمسه ضمن هذا PR: Print Agent/IPC/queues، `send_to_kitchen`، inventory deduction، pricing/payment، station-code format، Production DB.
- Verify #1373: **SUCCESS / Full Green**.
- **لا Merge إلا بعد مراجعة HEAD وعدم تحرك `main` وموافقة صريحة.**

## Branch governance — منع الدمج الخطأ

- السجل الرسمي لحالة الفروع: `docs/BRANCH_STATUS_REGISTRY.md`.
- **أي `development/*` غير مذكور هناك كـACTIVE = INACTIVE/HISTORICAL وغير صالح للدمج.**
- لا يُعاد فتح فرع قديم أو نسخه إلى فرع جديد إلا بعد Regression مثبت وتحديث هذا الملف أولًا.
- وجود فرع على GitHub لا يعني أنه جزء من خطة التشغيل الحالية.
- لا Merge لأي فرع تاريخي بالاعتماد على اسمه أو كونه سابقًا Green.

## قاعدة الحفاظ على الشغال — Preservation First

المرحلة التالية بعد إغلاق الدمج الحالي هي **Stabilization/Cleanup Audit فقط**، وليست إعادة بناء أو Refactor واسع.

1. نثبت أحدث `main` كـbaseline غير قابل للتغيير أثناء الفحص.
2. نراجع كل الإصلاحات من بداية خطة التبسيط حتى آخر Merge.
3. لا نغيّر أي Business Logic شغال لمجرد التنظيف.
4. لا نحذف Legacy أو wrapper أو migration أو route إلا بعد إثبات عدم الاستخدام + Regression coverage.
5. كل تعديل صغير ومعزول ويملك test يثبت السبب والإصلاح.
6. أي Regression جديد يوقف التوسع في Scope حتى يُفهم سببه.
7. الطباعة الحالية لا تُعاد هندستها ضمن مرحلة التنظيف؛ أي تغيير عليها يحتاج Scope وموافقة منفصلين.
8. بيانات المستخدم وProduction خارج الاختبار والتنظيف.

## خطة التثبيت والتنظيف بعد الدمج الحالي

### Phase A — Freeze & Evidence

- التقاط HEAD لـ`main` بعد Merge الحالي وVerify/Deploy المرتبطين به.
- جرد كل migrations/RPC/routes/modules التي تغيرت منذ خطة التبسيط.
- جرد Full Verify وProduction migration parity؛ لا نفترض أن Merge = Production migration.

### Phase B — Module Boundary Audit

نثبت عمليًا أن الموديولات وحدودها صحيحة بدون إعادة بناء:

- Auth / Users / Permissions
- Branch / Warehouse context
- Catalog: products / raw materials / manufactured items / modifier groups
- Inventory / Purchases / Transfers / Waste
- POS / Tables / Orders / Payments / Shifts
- Kitchen / KDS
- Approvals
- Reports / Finance
- Printing / Print Agent
- Settings

يتم فقط تسجيل coupling غير الصحيح أولًا. الإصلاح يكون لاحقًا وبأصغر تغيير ممكن مع Regression tests.

### Phase C — Regression sweep from Simplification → Current

- branch switching and branch-scoped data
- product/raw/manufactured availability and recipes
- modifier groups and legacy component routing
- POS mobile vs desktop behavior
- order/table ownership and transfer/reassignment permissions
- `send_to_kitchen` single-send + delta + idempotency + inventory deduction
- KDS branch/station isolation
- payments/split/hold/resume
- approvals
- shifts and reports
- printing contracts without redesign

### Phase D — Full Verify Gate

لا تعتبر الحزمة مستقرة إلا بعد نجاح:

- repository/database identity locks
- lint
- typecheck application + tests
- unit
- build
- fresh DB canonical migrations
- schema verification
- integration/security/RLS
- Browser Smoke
- مراجعة changed files وعدم وجود scope drift

### Phase E — Production parity audit

- مقارنة migrations الموجودة في `main` بما طُبق فعليًا على Production `azzdesuowpdcoflmyezn`.
- تصنيف كل migration: Applied / Pending / Not-for-Production.
- **لا يتم تطبيق أي Pending migration تلقائيًا بعد Merge.**
- التطبيق على Production يحتاج Full Green + مراجعة الأثر + موافقة صريحة منفصلة.
- بعد التطبيق: contract/schema verification بدون reset أو reseed لبيانات المستخدم.

## عقود ثابتة لا يعاد فتحها بلا Regression مثبت

- Permission-First؛ Super Admin فقط implicit bypass.
- granular POS permissions تشمل view/create/edit/pay/split/transfer/receipt/send-kitchen.
- المستخدم العادي لا يفتح/يعدل طلبًا أو طاولة لا تخصه بدون الصلاحية المطلوبة؛ صلاحيات الإدارة/النقل هي الحاكمة وليس اسم الدور.
- username يظهر على الطاولة المشغولة وما يخص المستخدم حيث يلزم.
- `send_to_kitchen` هو authority لاستهلاك المخزون؛ first send مرة ثم delta، وretry لا يكرر الاستهلاك.
- configured POS products تباع حسب عقد availability المثبت، وraw debt في مسار Kitchen يبقى حسب العقد المختبر.
- branch + warehouse isolation وRLS لا يتم تخفيفها.
- approval system enforced.
- printer management فقط لصاحب صلاحية الإعدادات.
- print once + controlled reprint، ولا physical print success كاذب.
- لا network/offline ambiguity تتحول إلى sale/payment success وهمي.
- Reports compact/tabular + filters + Excel export.
- guided prerequisite routing بدل raw errors حيث أمكن.
- Production ليست test environment.

## السجلات والوثائق الأخرى

- `docs/STABILIZATION_WORK_LOG.md`: سجل زمني مختصر فقط، **ليس** خطة تنفيذ مستقلة.
- ملفات `*_PLAN.md`, `*_REPORT.md`, `*_CLOSURE.md`, addenda والـarchive: تاريخ/أدلة فقط ما لم يحِل إليها هذا الملف كـACTIVE.
- عند التعارض: **هذا الملف يفوز دائمًا**.

## NEXT ACTION

1. PR #126 أصبح Full Green؛ راجع HEAD وعدم تحرك `main` ثم الدمج فقط بعد موافقة صريحة.
2. Verify `main` + Deploy بعد الدمج.
3. بعدها يبدأ Audit التثبيت والتنظيف من Phase A بدون تغيير أي شيء شغال بلا Regression مثبت.
4. Audit Production parity خطوة مستقلة؛ لا Production migration تلقائيًا.

## التنفيذ القياسي

`Baseline -> Root Cause -> Small Change -> Focused Tests -> Integration/Regression -> Full Verify -> PR -> Merge only when allowed -> Verify main -> Deploy -> Production parity audit -> Production change only with explicit approval`

لا يُغيّر Business Logic صحيح لإرضاء اختبار خاطئ، ولا يُحذف Legacy إلا بعد إثبات الاستخدام/الاستبدال/التغطية ثم Full Verify.
