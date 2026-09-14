# Execution Guardrails — Current Unified Rules

Date: 2026-09-15
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Production branch: `main`
Authoritative execution source: `docs/CURRENT_WORK_PLAN.md`
Branch status source: `docs/BRANCH_STATUS_REGISTRY.md`

> هذا الملف يثبت الضوابط الدائمة فقط. لا يحتوي على خطة مراحل مستقلة ولا Standing Approval يسبق الحالة الحالية. أي ترتيب PR4/PR5/PR6/PR7 أو صلاحية دمج تاريخية في نسخة أقدم من هذا الملف تعتبر منتهية ويحل محلها `CURRENT_WORK_PLAN.md`.

## 1. Preservation First — شرط غير قابل للتفاوض

لا يجوز لأي مرحلة أن تتلف أو تعيد ضبط أو تعيد كتابة أو تعيد seed أو تغيّر بيانات المستخدم أو الإعدادات الحالية أو الأرصدة أو الفواتير أو المخزون أو أي نموذج شغال بغرض التبسيط أو الـrefactor.

قبل أي write أو migration:
- fetch أحدث `main` والفرع/PR النشط فقط؛
- تأكد أن الفرع ACTIVE في `BRANCH_STATUS_REGISTRY.md`؛
- حافظ على semantics الموجودة ما لم يوجد defect مثبت؛
- استخدم Fresh/Test DB للاختبارات المدمرة أو E2E؛
- Production ليست بيئة اختبار disposable؛
- migrations forward-only / append-only؛
- no Force Push؛
- no RLS weakening؛
- no role-name authorization لغير Super Admin؛
- no cross-branch / cross-warehouse fallback؛
- no Production migration قبل Full Verify Green + موافقة صريحة منفصلة.

إذا كان التغيير قد يعدّل historical business data أو balances أو documents موجودة، يتوقف هذا التغيير ويُعزل كمهمة مستقلة بمراجعة واضحة.

## 2. لا توجد موافقة دمج مفتوحة للفروع التاريخية

- وجود PR أو branch قديم أو نتيجة CI Green قديمة لا يمثل موافقة حالية.
- الفروع النشطة فقط هي المذكورة ACTIVE في `docs/BRANCH_STATUS_REGISTRY.md`.
- أي فرع آخر = INACTIVE/HISTORICAL / DO NOT MERGE.
- كل Merge وظيفي يحتاج الحالة والشروط الحالية المحددة في `CURRENT_WORK_PLAN.md`.
- Production migration لا تأتي تلقائيًا مع Merge ولا مع Deploy.

## 3. Mandatory UX acceptance gate

لكل surface تم لمسه فقط، راجع دون redesign واسع:
- actions المطلوبة reachable؛
- prerequisites موجهة للمستخدم بدل raw backend errors؛
- duplicate controls لا تزال مبررة أو يتم توثيقها قبل أي حذف؛
- Arabic-first labels/status واضح؛
- non-blocking warnings لا تبدو fatal؛
- blocked operation يوضح السبب والخطوة التالية؛
- important actions touch-friendly؛
- permission-first في العرض والتنفيذ؛
- branch/warehouse/user context ظاهر حيث يمنع الخطأ؛
- أي UX guard يحمي business behavior يملك regression coverage.

## 4. Module-boundary rule

التنظيف القادم يبدأ Audit وليس Refactor:
- افحص ownership والdependencies بين الموديولات أولًا؛
- سجّل coupling المشكوك فيه قبل تغييره؛
- لا تنقل ملفات أو تعيد تقسيم APIs أو database contracts لمجرد الشكل؛
- أصلح فقط coupling مثبت بأنه يسبب regression/risk، وبأصغر change مع tests.

الموديولات المرجعية الحالية: Auth/Permissions، Branch/Warehouse، Catalog، Inventory/Purchases/Transfers/Waste، POS/Tables/Orders/Payments/Shifts، Kitchen/KDS، Approvals، Reports/Finance، Printing، Settings.

## 5. Stage completion gate

لا يعتبر أي عمل مغلقًا حتى:
- focused tests pass؛
- permission/branch/warehouse isolation pass حيث يلزم؛
- idempotency/concurrency checks pass حيث يلزم؛
- UX acceptance للتغييرات الملموسة مكتمل؛
- لا regression في flows الشغالة؛
- Full Verify Green؛
- changed files داخل Scope؛
- post-merge main verification عند الدمج؛
- Production data محفوظة.

## 6. Full Verify definition

عندما نقول Full Verify في الخطة الحالية فهذا يشمل على الأقل:
- repository + DB identity lock؛
- lint؛
- application/test typecheck؛
- unit؛
- build؛
- fresh DB canonical migrations؛
- schema verification؛
- integration/security/RLS؛
- Browser Smoke؛
- scope/changed-files review.

أي skip ناتج عن failure سابق يعني أن Full Verify ليس Green.

## 7. Production parity

بعد Merge/Verify/Deploy يتم فحص Production migration parity كخطوة منفصلة:
- Applied / Pending / Not-for-Production؛
- لا افتراض أن كل migration في `main` مطبقة في Production؛
- لا تشغيل Pending migrations بدون Full Green + impact review + موافقة صريحة؛
- verification بعد التطبيق بدون reset/reseed/rewrite.

## 8. Product principle

**Simple inside. Same capabilities outside. Clearer for the user.**

التبسيط يقلل duplication وlegacy risk مع الحفاظ على القدرات الشغالة. أي تعارض بين هذا الملف وخطة قديمة يُحسم لصالح `docs/CURRENT_WORK_PLAN.md`.
