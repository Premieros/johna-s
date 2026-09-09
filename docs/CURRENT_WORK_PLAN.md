# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف فقط.
> الملفات القديمة الخاصة بالـBug Register / Remaining Stages / Handover / Post-Repair أصبحت مراجع تاريخية فقط ولا تُستخدم لتحديد الحالة الحالية.

آخر تحديث: **2026-09-09 — Africa/Cairo**

## 1) الهوية الثابتة — غير قابلة للخلط

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Permanent development branch: `development/final-handover`
- Published site: `https://premieros.github.io/johna-s/`
- المستودعات المرجعية `55` / `pos.v2` / `v4` وأي ZIP خارجي = **READ-ONLY REFERENCES ONLY**.
- ممنوع أي write / commit / push / merge / workflow edit على المستودعات المرجعية.
- ممنوع لمس أو تشغيل migrations أو تعديل أي قاعدة بيانات تخص المستودعات المرجعية.
- ممنوع استخدام Supabase `scpovyrqmsbiduanykod` لهذا المشروع.
- ممنوع Force Push.
- ممنوع تعديل `main` مباشرة.
- ممنوع Production DDL/Migration قبل Full Verify.
- ممنوع تخفيف RLS أو الاختبارات لتمرير CI.
- Super Admin فقط implicit bypass.
- كل الأدوار الأخرى Labels فقط؛ Authorization = Permission-First + canonical branch/RLS.

## 2) Verified Production baseline

آخر Production baseline مغلق قبل حزمة Feature Parity الحالية:

- `main`: `0a6f773bc9dab7c05840ef91313665b271e55238`
- PR #53: `test: add functional core cycle release gate` ✅
- Core cycle المغلق: Open Shift → Create Order → Hold → Resume → Send Kitchen → Inventory deduction → Payment → Sale/Shift attribution → Close Shift.
- آخر Verify كامل قبل الحزمة الحالية: Verify #904 / run `34280957799` على PR #54 head قبل Shared-Shift settlement follow-up: **Full Green** ✅
  - Identity lock ✅
  - API contract ✅
  - lint ✅
  - typecheck ✅
  - test typecheck ✅
  - unit ✅
  - build ✅
  - Fresh DB migrations ✅
  - Schema verification ✅
  - Integration/Security/RLS ✅
  - Browser Smoke ✅

**لا يتم وصف أي commit أحدث من ذلك بأنه Verified Green حتى يمر Full Verify من جديد.**

## 3) الحالة التشغيلية الحالية — Feature Parity Batch نشطة

بناءً على مقارنة Read-Only مع `55` و`pos.v2/development` و`v4` وZIP مرجعي، تم منع النقل الأعمى أو نسخ migrations، وبدأ تنفيذ الناقص فقط داخل `johna-s`.

### PR #54 — `fix: align POS scan and guided workflow contracts`

- Base: `main`
- Head branch: `development/final-handover`
- PR مفتوح وغير مدمج.
- لا DB migration / RLS / RPC changes في الدفعة الحالية.

### ما تم تنفيذه في PR #54 حتى الآن

1. **POS Exact Scan**
   - Enter يقبل Exact `Barcode` أو Exact `SKU` بدل Barcode فقط.
   - Regression test: `tests/unit/pos/productScanContract.test.ts`.

2. **Guided Workflow Permission-First**
   - إزالة `owner` من implicit bypass داخل `validateActionPrerequisites`.
   - `super_admin` فقط هو implicit bypass.
   - Regression test: `tests/unit/guidedWorkflowPermissionContract.test.ts`.

3. **POS Shift prerequisite**
   - Guided `pos_checkout` لم يعد يقيد شرط الشفت باسم role `cashier` فقط.
   - الشفت المفتوح هو prerequisite تشغيلي لمسار POS، بصرف النظر عن role label، مع بقاء الصلاحيات Permission-First.

4. **Shared Branch Shift settlement hardening — العمل الحالي**
   - تم اكتشاف انحراف مثبت في `PosWorkspacePage`: تحميل `activeShift` كان يحصل فقط عندما `user.role === 'cashier'`، وكان `handlePay` يمرر لغير الكاشير قيمة وهمية `shift_exempt`.
   - `usePosOrder.completeSale` كان يسمح لغير الكاشير بتمرير `p_shift_id = null` لأن `activeShift` لم يكن محملاً لهم.
   - تم إضافة hardening داخل `src/features/pos/services/payment.ts`: قبل online normal/split settlement يتم حل Shared Branch Shift الحقيقي من `getActiveShift({p_branch_id})`; إذا لا يوجد شفت مفتوح يفشل بـ`SHIFT_REQUIRED` بدل تسوية مالية بلا shift attribution.
   - Regression test الجديد `tests/unit/posSharedShiftSettlementContract.test.ts` يمر ✅.
   - commit الحالي قبل تحديث هذا السجل: `8ab2ea43f7ffd1e01cad6b450390df57d0346402`.

## 4) Verify #906 — الحالة الدقيقة

Run: `34306890481` / Verify #906 على PR #54 بعد Shared-Shift settlement hardening.

النتيجة:
- Database identity ✅
- API contract ✅
- lint ✅ (تحذيران legacy فقط، 0 errors)
- app typecheck ✅
- app+tests typecheck ✅
- unit: **406 passed / 407, فشل اختبار واحد فقط** ❌
- build: skipped بسبب unit failure
- DB/Fresh DB/Integration/RLS: skipped
- Browser Smoke: skipped

### الفشل الوحيد

`tests/unit/saleFinancialAuthorityContract.test.ts`

الاختبار الفاشل:
`does not convert authoritative server rejection or ambiguous online failure into offline success`

### Root Cause المثبت

هذا ليس دليلاً على أن Production logic حوّل server rejection إلى offline success.

الاختبار الحالي brittle/source-text parser:
- يعمل `payment.slice(payment.indexOf('try {'))`.
- بعد إضافة helper `resolveSharedBranchShift` الذي يحتوي `try {` قبل `processSaleForOrder`, أصبح `onlinePath` يبدأ من helper ويشمل لاحقًا مسار الـexplicit offline outbox الشرعي:
  `offlinePosManager.enqueueSale(p)`.
- لذلك assertion النصي يفشل رغم أن enqueue ما زال فقط داخل الشرط الصريح `navigator.onLine === false`، بينما catch الخاص بالonline ambiguity لا يقوم enqueue.

### المطلوب الصحيح لإغلاق #906

- **لا تتراجع عن Shared Branch Shift settlement hardening بسبب هذا الفشل.**
- أصلح test scope ليحدد جسم `processSaleForOrder`/online try-catch المقصود بدقة بدل `indexOf('try {')` العام.
- لا تحذف assertion الأساسي ولا تضعف Financial Authority contract.
- يجب أن يظل العقد محميًا:
  1. Explicit offline state فقط يسمح `enqueueSale` للمسار العادي.
  2. Server rejection لا يتحول offline success.
  3. Ambiguous online exception لا يعمل enqueue بسبب duplicate-risk.
  4. Split tender يبقى online-only حتى يوجد idempotent split offline contract.
- بعد إصلاح الاختبار: أعد Full Verify؛ لا تكتفِ بالunit.

### Checkpoint Verify #908 بعد إصلاح Unit

- Head: `dfe83ba0ca6dfc14a5d74b85ae16bc31ade50d39`.
- commit: `test(pos): scope financial authority contract`.
- Run: `34315737303` / Verify #908.
- Database identity / API contract / lint / typecheck / test typecheck / Unit `407/407` / build ✅.
- Fresh DB migrations / Schema / Integration / Security / RLS ✅.
- Browser Smoke: `104/105`، فشل اختبار واحد فقط في `tests/e2e/pos-actions.spec.ts` ❌.
- Root Cause: fixture الخاص بـ`get_active_shift` كان يعيد الشكل القديم المسطح `shift_id`، بينما Shared Branch Shift RPC الحقيقي يعيد `shift: { id, ... }`. بعد settlement hardening قرأت الخدمة العقد الصحيح، فلم تجد fixture shift صالحًا وأغلقت الدفع بـ`SHIFT_REQUIRED` قبل `process_sale`.
- تم تحديث fixture إلى عقد Shared Branch Shift الحقيقي وإثبات أن `process_sale` يستلم `p_shift_id` الصحيح.

### Checkpoint Verify #909 — Full Green

- Head: `1d85946a74f61bbc5a339e06892f457d08884643`.
- Run: `34316529658` / Verify #909.
- Frontend/API contract/lint/typecheck/test typecheck/Unit/build ✅.
- Fresh DB migrations/Schema/Integration/Security/RLS ✅.
- Browser Smoke ✅.
- النتيجة: Regression الخاص بـ#906 واختبار Browser التابع لـShared Branch Shift مغلقان بالكامل.

## 5) Shared Branch Shift UI closure — مغلق على PR #54

تم تنفيذ الجزء التالي بعد Full Green #909:

1. إزالة `shift_exempt` من `PosWorkspacePage` واستخدام `activeShift?.id || null` الحقيقي.
2. `reloadShift` يقرأ Shared Branch Shift لكل مستخدم POS على الفرع، بلا cashier-role gate.
3. direct/deep-link pay يمران عبر `handlePay` بعد اكتمال فحص الشفت.
4. `usePosOrder.completeSale` يفشل قبل التسوية إذا لا يوجد شفت لأي role label.
5. فتح/إغلاق/إدارة الشفت في POS و`ShiftsPage` تعتمد exact `shifts.open` / `shifts.close` بدل role name.
6. Guided open-shift action يتطلب `shifts.open` بدل `shifts.manage`.
7. Regression test: `tests/unit/posSharedShiftWorkspaceContract.test.ts`.
8. Local gates: DB identity ✅، lint 0 errors ✅، typecheck + test typecheck ✅، Unit `410/410` ✅، build ✅.

### Checkpoint Verify #910 — Full Green

- Code Head: `4d55a54574861282fa5678f6292b0643ad16c1ea`.
- commit: `fix(pos): enforce shared shift in workspace`.
- Run: `34317708031` / Verify #910.
- Frontend/API contract/lint/typecheck/test typecheck/Unit/build ✅.
- Fresh DB migrations/Schema/Integration/Security/RLS ✅.
- Browser Smoke ✅.
- لا DB migration أو RLS أو RPC change في هذا الإغلاق، ولم يتم لمس Production DB.
- النتيجة: Shared Branch Shift UI/settlement drift في نطاق PR #54 مغلق. هذا التحديث التوثيقي هو آخر تغيير غير تشغيلي؛ لا يعتبر PR جاهزًا للدمج إلا إذا Verify على الـHEAD الناتج منه Full Green أيضًا.

لا تفتح Batch 2 (Availability/Delivery/Modifiers/KDS/Offline) قبل إغلاق PR #54 Full Green.

## 6) العقود المغلقة — لا تُفتح بدون Regression مثبت

- Users / Roles / Permission-First ✅
- Shared Branch Shift — PR #30 ✅ (الحزمة الحالية تصلح UI/settlement drift فقط ولا تغير أصل العقد)
- POS Discount / Payment / Order Completion — PR #31 ✅
- Warehouse transfer isolation — PR #35 ✅
- Controlled branch delete — PR #36 ✅
- Warehouse lifecycle — PR #37 ✅
- `close_shift` Permission-First — PR #38 ✅
- Admin SECURITY DEFINER hardening — PR #39 ✅
- Identity hardening — PR #40 ✅
- Subscription admin/tenant/security batches — PR #41–#44 ✅
- Inventory unit production Permission-First/branch/warehouse — PR #45 ✅
- SECURITY DEFINER legacy search-path zero closure — PR #46 ✅
- Shift cash integrity + branch scope — PR #47 ✅
- POS operator ownership + controlled operator transfer — PR #48 ✅
- Unified project status log — PR #49 ✅
- Functional core cycle release gate — PR #53 ✅

### عقد PR #48 المحمي

1. Shared shift per branch.
2. New Order ownership = `auth.uid()`.
3. ordinary caller cannot spoof another cashier.
4. owner-only normal order/table operation subject to exact permission.
5. same-branch peer يرى occupied + narrow operator label فقط.
6. operator transfer requires `pos.order.transfer`, never role name.
7. same-branch validation fail-closed.
8. transfer audit = old owner + new owner + actor + timestamp.
9. direct DML/RPC fallback bypasses fail closed.
10. KDS/payment attribution remains tied to actual executor.
11. shared-shift sale attribution محفوظ بدون duplicate shift operation.

Production migrations الخاصة بالإغلاق:
- `20260907194314_pos_operator_ownership`
- `20260907194337_pos_kitchen_send_ownership`
- `20260907194427_pos_operator_rpc_ownership_hardening`
- `20260907194454_pos_sale_shift_attribution`

## 7) الانحرافات الإدارية المتبقية

### AUTH-001 — Leaked Password Protection disabled

- Production Security Advisor سبق وأكد أن Supabase Auth `Leaked Password Protection` ما زالت Disabled.
- Project/Auth Setting وليست Runtime code defect.
- لا تدّعِ الإغلاق قبل تعديل الإعداد الحقيقي والتحقق.

### RELEASE-001 — `main` غير محمي

- آخر قراءة موثقة: `main protected=false`.
- Release-governance issue وليست Runtime application bug.
- لا تدّعِ الإغلاق قبل تفعيل Ruleset/Branch Protection فعلي والتحقق.

## 8) قواعد العمل الحالية

1. لا Full-project audit متكرر.
2. لا Bug جديد يدخل السجل إلا مع reproduction أو direct contract proof.
3. نصلح Root Cause وليس الأعراض.
4. Batch صغيرة لكل سبب.
5. قبل كل WRITE: re-fetch `main` و`development/final-handover` وPR #54 بسبب احتمال عمل نموذج آخر بالتوازي.
6. لا Force Push.
7. لا Production migration قبل Full Verify.
8. لا تغيير صلاحيات أو RLS لتسهيل الاختبارات.
9. لا role-name authorization خارج Super Admin implicit bypass.
10. المستودعات وقواعد البيانات المرجعية Read-Only فقط.
11. لا نسخ migrations/RLS/RPCs من `55` أو `pos.v2` أو `v4`؛ أي فكرة مطلوبة يعاد تنفيذها ضد عقد `johna-s` الحالي.
12. لا merge لـPR #54 قبل Full Green على آخر head.

## 9) Definition of Done لأي إصلاح كود/DB جديد

`Regression proof → frontend gates → Fresh DB → Schema → Integration/Security/RLS → Browser Smoke → Merge → Production migration/parity عند الحاجة → Production Post-Check → merged-main Verify → Deploy`

الهدف النهائي دائمًا:

**Published Site = Verified Main = Production DB Contract = Zero Drift**

## 10) Feature Parity roadmap بعد إغلاق PR #54

المرجع الآخر يُقرأ فقط ولا يُعدل.

الترتيب الحالي:
1. Guided Routing wiring + Shared Shift UI/settlement drift — **ACTIVE في PR #54**.
2. Availability server contract hardening.
3. Delivery/Drive-Thru server prerequisites.
4. Modifier backend enforcement + KDS notes/modifier/delta parity verification.
5. Offline Shift Close + Reconciliation/Idempotency.
6. Printing finalization + Approvals.
7. Reports + Operational Alerts + UX polish.

الموجود بالفعل ولا يعاد بناؤه بدون Regression:
- Product images.
- Categories.
- Barcode/SKU search foundation.
- Modifiers UI.
- Item notes/discount.
- Customer quick modal.
- Split payment + Cash/Card/Transfer/Credit.
- Guided Workflow foundation.
- Offline storage/sync foundation.
- Local Print Agent foundation.
- Permission-First / Branch isolation / Warehouse isolation.

## 11) سياسة السجلات

هذا الملف `docs/CURRENT_WORK_PLAN.md` هو **المرجع الحي الوحيد**.

الملفات التالية Legacy pointers فقط ويمنع تحديث حالة المشروع فيها بشكل مستقل:
- `docs/FINAL_BUG_REGISTER.md`
- `docs/FINAL_REMAINING_STAGES.md`
- `docs/HANDOVER_CHECKPOINT_2026-09-06.md`
- `docs/POST_REPAIR_DEVELOPMENT_PLAN.md`

أي تحديث مستقبلي للحالة أو Bug أو خطة تنفيذ يتم هنا فقط.

## 12) ملاحظة تنظيف مستودع غير تشغيلية

تم إنشاء branch مؤقت بالخطأ أثناء تجهيز التسليم باسم `handover/final-delivery-20260908`. لا يُستخدم نهائيًا ولا يحمل تغييرات. الفرع المعتمد الوحيد للتطوير يبقى `development/final-handover`.
