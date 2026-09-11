# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف ثم يجلب HEAD الحالي لـ`main` والفرع/PR المستهدف قبل أي تعديل، لأن نماذج أخرى قد تعمل بالتوازي.

آخر تحديث: **2026-09-11 — Africa/Cairo — Stabilization Phase 2**

## 1) الهوية الثابتة — غير قابلة للخلط

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Published site: `https://premieros.github.io/johna-s/`
- Purchase Requests reference route: `https://premieros.github.io/johna-s/#/purchases/requests`
- أي مشروع/مستودع آخر مثل `55` / `pos.v2` / `v4` / ZIP خارجي = **READ-ONLY REFERENCE ONLY**.
- ممنوع استخدام Supabase `scpovyrqmsbiduanykod` لهذا المشروع.
- ممنوع تعديل `main` مباشرة أو Force Push.
- ممنوع تشغيل Production migration قبل Full Verify Green وقرار نشر صريح.
- ممنوع تخفيف RLS أو حذف/إضعاف الاختبارات لإجبار CI على النجاح.
- Super Admin فقط implicit bypass.
- كل الأدوار الأخرى Labels فقط؛ Authorization = Permission-First + branch/RLS.
- قبل أي write: اجلب HEAD الحالي لـ`main` والفرع/PR المستهدف وافحص أي commits أحدث.
- عند الدمج استخدم expected SHA guard متى أمكن.

## 2) Baseline الحالي — نقطة التثبيت

- `main` HEAD عند بدء هذه المرحلة: `014e9099d43693dccf58bf88e5051bc35d837e0f`.
- هذا هو merge commit لـPR #65: `stabilize: regression coverage before safe cleanup`.
- Verify main #1070: **Success / Full Green**.
- Deploy GitHub Pages #595: **Success**.
- لا يوجد أي PR مفتوح وقت بدء هذه الخطة.
- يوجد 12 فرعًا غير `main` ويجب تدقيقها قبل حذف أي منها.
- `main` غير محمي حاليًا؛ هذا Governance Risk ويجب التعامل معه قبل فتح تطوير واسع جديد.
- لا تفترض أن هذا الـSHA ما زال الأحدث لاحقًا؛ fetch إلزامي قبل أي خطوة.

## 3) الهدف من المرحلة الحالية

المشروع دخل مرحلة **Stabilization / Regression Hardening / Cleanup**.

الهدف ليس إضافة خصائص جديدة الآن، بل:

1. منع أن يؤدي إصلاح جديد إلى كسر وظيفة تعمل بالفعل.
2. تثبيت العقود التشغيلية الحقيقية بين UI / API-RPC / DB / Permissions / RLS / Side Effects.
3. إزالة التكرار والـfallbacks والكود القديم فقط بعد إثبات عدم استخدامه.
4. تقليل عدد الفروع ومسارات التنفيذ غير المعروفة.
5. تحويل الوظائف الحرجة إلى Regression Contracts محمية بالاختبارات.
6. العودة للتطوير الوظيفي فقط بعد إغلاق شروط الاستقرار.

## 4) قواعد العمل الجديدة — إلزامية

### 4.1 Freeze مؤقت للتطوير الواسع

حتى إغلاق مرحلة Stabilization:

- لا Features جديدة كبيرة.
- لا Refactor واسع لمجرد التنظيم.
- لا إعادة بناء شاشة كاملة إذا كان المطلوب إصلاح سلوك محدد.
- يسمح فقط بـ:
  - Regression fixes.
  - Data-loss / security fixes.
  - Contract fixes.
  - Tests / observability / cleanup مثبت.
  - UX fixes تمنع استخدامًا خاطئًا أو نتيجة تشغيلية مضللة.

### 4.2 PR واحد = نطاق واحد واضح

ممنوع دمج تغييرات غير مترابطة في دفعة واحدة.

مثال صحيح:
- `fix purchase request branch isolation`

مثال غير مقبول:
- `fix purchases + POS + reports + permissions + design`

### 4.3 Test first عند تعديل سلوك يعمل

قبل تغيير سلوك قائم:

1. إثبات السلوك الحالي المتوقع باختبار أو Contract test.
2. تطبيق التعديل.
3. تشغيل الاختبار المحدد.
4. تشغيل Full Verify قبل الدمج.

### 4.4 لا حذف Legacy قبل إثبات عدم استخدامه

أي RPC / component / helper / table contract قديم:

`usage search -> contract map -> regression coverage -> remove -> full verify`

لا حذف اعتمادًا على الاسم أو الظن فقط.

### 4.5 لا نجاح وهمي

- network/offline ambiguity لا تتحول إلى sale/payment success.
- غياب/فشل Print Agent لا يسجل print success.
- لا ادعاء Physical Print success دون اختبار فعلي على جهاز/تعريف الطابعة.

## 5) Phase 0 — Governance & Baseline Lock

**الأولوية: P0**

### المطلوب

- اعتبار `main@014e9099...` baseline مرجعي لهذه المرحلة ما لم يتحرك `main` لاحقًا.
- إبقاء كل العمل الجديد على فروع تطوير منفصلة.
- إعداد Branch Protection / Ruleset لـ`main` بحيث يمنع الدفع المباشر ويشترط CI المطلوب قبل الدمج، متى كانت صلاحيات GitHub المتاحة تسمح بذلك.
- عدم تطبيق أي Production migration ضمن هذه المرحلة إلا إذا ظهرت ضرورة موثقة وبعد Full Verify Green وموافقة صريحة.
- أي تغيير في Source of Truth نفسه يتم على فرع تطوير ثم PR، وليس direct write إلى `main`.

### شرط الإغلاق

- `main` له مسار دمج محكوم.
- baseline موثق.
- لا توجد كتابة مباشرة عشوائية إلى `main`.

## 6) Phase 1 — Branch & Change Inventory Cleanup

**الأولوية: P0**

يوجد وقت بدء الخطة 12 فرعًا غير `main`.

### لكل فرع

صنّفه إلى أحد الآتي:

1. **Merged بالكامل** -> مرشح للحذف بعد إثبات المقارنة.
2. **Superseded** -> مرشح للحذف بعد التأكد أن البديل موجود في `main`.
3. **Contains unique useful commits** -> لا يدمج مباشرة؛ تُستخرج التغييرات المفيدة إلى PR صغير مستقل مبني من أحدث `main`.
4. **Unknown** -> يبقى دون تعديل حتى المراجعة.

### ممنوع

- حذف فرع لمجرد أنه قديم.
- دمج فرع كامل لأن به إصلاحًا واحدًا مطلوبًا.
- إعادة إدخال كود Legacy سبق استبداله.

### شرط الإغلاق

- كل فرع له حالة موثقة.
- لا توجد فروع مجهولة الغرض.
- الفروع المدمجة/الميتة يتم تنظيفها بعد الإثبات.

## 7) Phase 2 — Contract Map للنظام

**الأولوية: P0**

إنشاء خريطة واضحة لكل نطاق:

`UI -> service/API/RPC -> tables/views -> permission -> RLS/branch scope -> side effects -> tests`

### النطاقات الإلزامية

1. Authentication / Users / Branch Access
2. Permissions / Approvals
3. Branches / Warehouses
4. Raw Materials
5. Manufactured Units / Product composition
6. Products / Availability
7. Inventory / Ledger / Transfers
8. Purchases / Purchase Requests / Receiving
9. POS Orders / Hold / Resume
10. Dining Areas / Tables / Operator attribution
11. Send to Kitchen / Delta / Stock consumption
12. KDS / Station routing
13. Payments / Split / Partial / Returns / Voids
14. Shifts / Drawer / Day close
15. Printing / Reprint / Print Agent
16. Reports / Filters / Export
17. Offline / Reconciliation
18. Import / Export

### نتيجة هذه المرحلة

لكل نطاق يجب تحديد **مصدر الحقيقة التشغيلي الوحيد**.

إذا وجد مساران لنفس الوظيفة، لا نحذف أحدهما فورًا؛ يتم أولًا تحديد أيهما المستخدم فعليًا وإغلاق الاختبارات حوله.

## 8) Phase 3 — Regression Safety Net

**الأولوية: P0**

قبل التنظيف العميق، تثبيت اختبارات تمنع رجوع الأخطاء.

### Critical E2E Cycle

يجب وجود دورة تشغيل فعلية تغطي على الأقل:

`Login -> Branch -> Warehouse -> Product/Raw/Manufactured setup -> Stock/Purchase -> Open Shift -> Create Order -> Send to Kitchen -> KDS -> Payment -> Receipt -> Close Shift -> Reports`

### Regression contracts الإلزامية

#### Permissions
- View Only يعمل دون Create/Edit.
- Pay Only يعمل عندما تسمح الصلاحيات دون إعطاء صلاحيات إنشاء غير مطلوبة.
- `pos.send_kitchen` منفصل.
- `pos.receipt.print` منفصل.
- Printer management لا يظهر إلا لصاحب صلاحية الإعدادات المناسبة.
- لا Role-name authorization لغير Super Admin implicit bypass.

#### Branch/RLS
- لا قراءة أو كتابة business data خارج الفروع المسموح بها.
- لا fallback إلى `branches[0]` أو فرع افتراضي غير صريح.
- أي warehouse operation تحمل branch + warehouse scope الصحيح.

#### Inventory
- الشراء/الاستلام يزيد المخزون الصحيح.
- transfer لا يخلق أو يضاعف stock.
- Availability تعتمد على العقد الصحيح للمخزن/BOM.
- لا cross-branch fallback.

#### Kitchen
- أول `send_to_kitchen` يرسل الطلب مرة واحدة.
- التعديلات اللاحقة Delta فقط.
- خصم المخزون عند `send_to_kitchen` فقط حسب العقد الحالي.
- لا double consumption عند resend/retry.

#### Payments
- partial/split tender لا يضاعف المبالغ.
- retry/offline ambiguity لا ينتج payment success وهمي.
- returns/voids/partial voids تحافظ على totals والledger.

#### Printing
- نجاح الـqueue ليس مساويًا لنجاح الطباعة الفعلية.
- failure في Print Agent لا يسجل completed كاذبًا.
- print once + controlled reprint محفوظ.

## 9) Phase 4 — Stabilize Module by Module

لا تعمل الوحدات كلها معًا. الترتيب المقترح:

### Batch A — Identity / Permission / RLS

- Authentication identity.
- user -> branch access.
- Permission-First enforcement.
- approval contracts.
- settings/printer visibility.

**لا تنتقل إلى B قبل Full Green.**

### Batch B — Catalog / Inventory

- Raw Materials.
- Units.
- Manufactured Units.
- Product composition.
- Product availability.
- Warehouse stock.
- Transfers.
- Ledger consistency.

**لا تنتقل إلى C قبل Full Green.**

### Batch C — Purchases

مرجع UI المنشور:
`https://premieros.github.io/johna-s/#/purchases/requests`

تحقق end-to-end من:

`Purchase Request -> Approval if required -> Purchase -> Receive -> Inventory/Ledger -> Supplier/Account impact -> Reports`

ويجب التأكد من:

- branch scope.
- warehouse scope.
- requested vs received quantities.
- duplicate receive protection.
- status transitions.
- cancellation behavior.
- permissions/approvals.
- عدم ظهور بيانات فرع آخر.

### Batch D — POS / Tables / Kitchen / Payments

- order lifecycle.
- hold/resume.
- table occupancy + username/operator display.
- send kitchen + delta.
- KDS routing.
- split/merge/transfer approvals.
- payments/returns/voids.

### Batch E — Shift / Close / Reports

- sales by shift.
- sales by user.
- drawer totals.
- cash/card reconciliation.
- close shift/day.
- report totals match transactional source.

### Batch F — Printing / Offline / Mobile UX

- branch/station printer routing.
- Print Agent truthfulness.
- offline queue/reconciliation.
- mobile navigation and critical touch flows.

## 10) Phase 5 — Safe Cleanup

بعد وجود Regression Safety Net فقط:

- إزالة duplicated helpers.
- إزالة dead components.
- إزالة RPCs القديمة غير المستخدمة.
- إزالة fallbacks الخطرة.
- توحيد source-of-truth لكل domain.
- تقليل adapters المؤقتة.
- تنظيف imports/routes غير المستخدمة.

### قاعدة أساسية

**Cleanup لا يغيّر business behavior إلا إذا كان ذلك موثقًا كإصلاح مستقل.**

## 11) Phase 6 — Production Readiness & Rollout

قبل أي Production migration أو Final handover:

1. Latest `main` fetched.
2. No unexplained drift.
3. locked Supabase identity ✅
4. frontend contract ✅
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
17. Migration plan + rollback path إن وجدت migration.
18. explicit approval قبل أي Production write.

## 12) متطلبات ثابتة لا يجوز كسرها

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
- يجب دعم View Only وPay Only عندما تسمح الصلاحيات.
- Approval system enforced للعمليات الحساسة حسب العقد.
- Printer management لا يظهر إلا لصاحب صلاحية الإعدادات المناسبة.
- الطاولة المشغولة وكل كيان مرتبط بمستخدم يعرض اسم المشغل/المستخدم بصورة آمنة ضمن النطاق المسموح.
- Send to kitchen أول مرة ثم التعديلات كDelta.
- Hold/Resume، split، merge/transfer، print once + controlled reprint.
- لا تحوّل network/offline ambiguity إلى sale/payment success وهمي.

## 13) Definition of Done لمرحلة تنظيف الفوضى

لا تعتبر مرحلة Stabilization مغلقة إلا عندما:

- لا يوجد PR أو فرع غير معروف الغرض.
- Critical flows لها regression coverage.
- لا يوجد أكثر من source-of-truth تشغيلي غير موثق لنفس الوظيفة.
- لا يوجد cross-branch fallback.
- لا يوجد role-name authorization لغير Super Admin bypass.
- كل batch تم إغلاقه بـFull Green مستقل.
- `main` لا يستقبل تغييرات مباشرة غير محكومة.
- الموقع المنشور يمر Browser Smoke + Critical E2E.
- Production DB لم تتعرض لأي migration غير verified.

## 14) NEXT ACTION — إلزامي

1. اجلب أحدث `main` قبل أي تعديل جديد.
2. ابدأ بـ **Phase 1: Branch Inventory** دون حذف أي فرع.
3. قارن كل فرع بـ`main` وصنّفه: merged / superseded / unique / unknown.
4. بالتوازي، ابدأ **Phase 2: Contract Map** من الكود الحالي فقط دون refactor.
5. أول PR برمجي بعد الخطة يجب أن يكون **Regression/Test hardening أو إصلاحًا واحدًا صغيرًا مثبتًا**، وليس تطويرًا واسعًا.
6. لا Production migration في هذه المرحلة دون سبب موثق وموافقة صريحة.

لا تلمس أي مستودع أو قاعدة بيانات أخرى.
