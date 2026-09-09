# ZIP Feature Donor Integration Plan — johna-s

> هذا الملف هو خطة نقل انتقائي من الـZIP المرجعي إلى `Premieros/johna-s` فقط.
> لا يحل محل `docs/CURRENT_WORK_PLAN.md`؛ الأخير يظل Source of Truth الوحيد لحالة المشروع.

آخر تحديث: **2026-09-09 — Africa/Cairo**

## 1) هوية المشروع وقواعد التنفيذ

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Development branch: `development/final-handover`
- الـZIP المرجعي = **Read-Only Feature Donor فقط**.
- ممنوع نسخ migrations/RLS/RPC من الـZIP كما هي.
- ممنوع استخدام أي role name مثل `owner` / `admin` / `branch_manager` كوسيلة Authorization.
- Super Admin فقط implicit bypass.
- باقي المستخدمين: Permission-First + branch/RLS.
- ممنوع أي Production migration قبل Full Verify أخضر.
- ممنوع تعديل `main` مباشرة أو Force Push.
- ممنوع استخدام Supabase `scpovyrqmsbiduanykod`.
- ممنوع إضعاف الاختبارات أو RLS لتمرير CI.

## 2) قاعدة الدمج

لا يتم استبدال المشروع الحالي بالـZIP.

كل ميزة من الـZIP تمر بأربع مراحل:

1. **Extract:** فهم السلوك المطلوب من الـZIP بدون نسخ أعمى.
2. **Adapt:** إعادة تطبيقه فوق عقود المشروع الحالية وPermission-First/RLS.
3. **Regress:** إضافة أو تحديث اختبار Regression واضح.
4. **Verify:** Full Verify أخضر قبل اعتبار الدفعة جاهزة للدمج.

أي سلوك متعارض مع العقود المغلقة الحالية يُرفض حتى لو كان يعمل في الـZIP.

## 3) ما يُحفظ من الفرع الحالي ولا يُستبدل

هذه العقود أحدث وأصح من الـZIP، وهي Protected Baseline:

- Shared Branch Shift الحقيقي لكل مستخدمي POS.
- Exact POS Scan: Barcode أو SKU.
- POS operator ownership وربط المستخدم الفعلي بالطلب.
- إظهار اسم المستخدم/المشغل على الطاولة والطلب والأسطح المرتبطة به.
- KDS/payment attribution للمستخدم المنفذ فعليًا.
- Permission-First authorization.
- Super Admin فقط implicit bypass.
- canonical branch/RLS isolation.
- Production DB identity lock إلى `azzdesuowpdcoflmyezn`.
- Financial authority وعدم تحويل online rejection إلى offline success.
- خصم المخزون عند `send_to_kitchen` كقرار تشغيلي ثابت.

## 4) P0 — قابل للنقل أولًا بدون تغيير DB Contract

### P0.1 Electron Windows Runtime

**المصدر المرجعي في الـZIP:**
- `electron/main.cjs`
- `electron/preload.cjs`
- `electron/electron-builder.json`

**ما نأخذه:**
- Desktop shell.
- IPC آمن بين الواجهة وElectron.
- اكتشاف طابعات Windows.
- Silent print.
- Cash drawer kick عند الحاجة.

**التعديلات الإلزامية:**
- إزالة أي URL يشير إلى مشروع أو Cloud Run مرجعي.
- توجيه runtime للمشروع الحالي فقط.
- عدم hardcode لأي Supabase ref غير `azzdesuowpdcoflmyezn`.
- إضافة dependencies وscripts المطلوبة بطريقة متوافقة مع package-lock الحالي.
- حصر exposed preload APIs في أقل سطح ممكن.
- عدم كشف shell/node APIs للواجهة.

**Regression / Acceptance:**
- Web build يظل يعمل بدون Electron.
- Electron boot smoke.
- printer discovery smoke.
- لا secrets داخل bundle.

### P0.2 Printer Settings UI

**ما نأخذه:**
- Printer settings modal/panel.
- اختيار طابعة الكاشير/المطبخ/البارستا حسب الفرع والمحطة.
- اختبار الاتصال والطباعة التجريبية.

**التعديل الإلزامي:**
- شاشة إدارة الطابعات لا تظهر إلا عبر صلاحية إعدادات canonical مناسبة؛ مبدئيًا `settings.manage` إذا بقيت هي الصلاحية المعتمدة في المشروع.
- لا role checks.
- لا كشف إعدادات فروع غير مخولة للمستخدم.

**Acceptance:**
- مستخدم بلا الصلاحية: لا route ولا button ولا deep-link usable.
- مستخدم بالصلاحية: يرى فقط الفروع المسموحة له وفق RLS.

### P0.3 Advanced Local Print Agent

**ما نأخذه:**
- routing حسب branch + station.
- local agent discovery/fallback.
- silent printing عندما يعمل داخل Electron/local agent.
- normalized print payloads.

**لا ننقل:**
- أي bypass للصلاحيات.
- أي config مربوط بمشروع مرجعي.

**Acceptance:**
- Cashier receipt → cashier printer.
- Kitchen items → kitchen station printer.
- Barista items → barista station printer.
- Branch A لا يطبع على Branch B.

## 5) P1 — الطباعة وإعادة الطباعة والموافقات

### P1.1 Single Print + Reprint Approval

**ما نأخذه من الـZIP:**
- تتبع عدد مرات الطباعة.
- منع إعادة الطباعة العشوائية.
- Reprint request + approval flow.
- audit: requester / approver / reason / timestamp / target document.

**إعادة البناء المطلوبة:**
- استبدال `owner/admin/branch_manager` checks بصلاحيات صريحة.
- اقتراح صلاحيات canonical عند التنفيذ:
  - `pos.receipt.print`
  - `pos.receipt.reprint`
  - `approvals.reprint.approve`
  إذا لم تكن موجودة، تُصمم Permission-First أولًا وتضاف باختبارات contract، دون الاعتماد على role label.

**Acceptance:**
- First print حسب السياسة.
- Reprint بلا صلاحية/موافقة يفشل Fail-Closed.
- كل Reprint له audit واضح.

### P1.2 Branch Printing Configuration

**الهدف:**
- لكل فرع إعدادات طباعة مستقلة.
- station routing مستقل لكل فرع.
- دعم سيناريو 3 طابعات: cashier / kitchen / barista.

**Acceptance:**
- captain من الهاتف ينشئ الطلب في فرعه.
- kitchen delta يذهب للطابعة الصحيحة داخل الفرع فقط.
- receipt النهائي يذهب لطابعة الكاشير الصحيحة.

## 6) P2 — تحسينات POS الآمنة

### P2.1 TABLE_BUSY Contract

**ما نأخذه:**
- عند محاولة فتح طاولة مشغولة، يرجع النظام هوية الطلب الحالي بشكل آمن مثل `existing_order_id` بدل خطأ مبهم.

**التعديل:**
- الحفاظ على owner visibility وoperator-label contract الحالي.
- لا كشف تفاصيل مستخدم أو طلب من فرع غير مخول.

**Acceptance:**
- الضغط على طاولة مشغولة يعرض الطلب الحالي أو إجراء Resume وفق الصلاحيات.
- لا إنشاء order مزدوج لنفس الطاولة.

### P2.2 Operator Name Everywhere

**الأساس الحالي محفوظ.**

الأسطح المطلوبة:
- occupied table card.
- table picker/sidebar/floor plan.
- table action modal.
- active orders.
- held orders.
- current order header.
- KDS.
- payment/receipt attribution.

**قاعدة الخصوصية:**
- display/operator name فقط من المصدر الآمن الحالي.
- لا email/phone/hidden profile fields.

### P2.3 POS Product UX

نستخرج فقط ما يحسن التجربة بدون تغيير العقود:
- compact product cards/images.
- product-grid scroll fixes.
- navigation controls.
- modifiers UX الأفضل إن وجد.
- availability messaging واضح بدل raw error.

## 7) P3 — Shift Reporting & User Performance

**ما نأخذه:**
- User shift performance modal/report.
- breakdown للمبيعات حسب المستخدم.
- cash/card/discount/void/reprint attribution حسب المنفذ الحقيقي.

**القاعدة:**
- Shared Branch Shift الحالي لا يتغير.
- التقارير تقرأ attribution الحالي ولا تنشئ user-owned shifts منفصلة.

**Acceptance:**
- التقرير يطابق مبيعات/مدفوعات المستخدم المنفذ داخل الشفت المشترك.
- branch isolation كامل.

## 8) P4 — المخزون والمستودعات

هذه الدفعة **إعادة تصميم من الفكرة، وليست نسخ migrations**.

### P4.1 Unified Warehouse Availability

**الفكرة المستفادة:**
- availability للمنتج يجب أن تعتمد المستودع الحقيقي + BOM/components.
- ربط الطلب بمستودع صالح داخل الفرع عند الحاجة.

**يُمنع:**
- نسخ أي `is_pos_admin()` أو role fallback من ZIP.
- أي cross-branch warehouse fallback غير مصرح.

**Acceptance:**
- منتج غير متاح فعليًا يظهر غير متاح قبل الإرسال.
- raw material/component shortage يعطي سبب مفهوم.
- لا خصم من مستودع فرع آخر.

### P4.2 Kitchen Send Inventory Sync

**القرار الثابت:** الخصم يحدث عند `send_to_kitchen`.

**ما نستفيد منه:**
- reconciliation بين مخزون الخامة المجمع ومخزون المستودع إن كان schema الحالي يحتاجه.
- منع double deduction.
- delta send فقط عند تعديل الطلب بعد الإرسال الأول.

**Acceptance:**
- first send يخصم مرة واحدة.
- تعديل لاحق يخصم delta فقط.
- cancel/void/return يتبع العقد المالي/المخزني المعتمد بدون duplication.

### P4.3 Product Unit Links

**ما نأخذه:**
- تحسين ربط product ↔ inventory unit/component بما يمنع orphan links.

**التعديل:**
- تصميمه فوق schema الحالي بعد Schema Audit.
- لا migration قبل كتابة integration tests أولًا.

## 9) P5 — Purchase Cycle & Inventory Ledger

**الفكرة المستفادة من ZIP:**
- tightening لمسار PO → Receiving → Inventory Ledger.
- UOM correctness.
- منع orphan/duplicate receipt effects.

**إعادة البناء:**
- Permission-First فقط.
- branch/warehouse scope canonical.
- audit لكل receive/adjustment.

**Acceptance:**
- receiving يضيف للمستودع المحدد فقط.
- ledger يطابق الكمية والقيمة ووحدة القياس.
- retry لا يكرر التأثير المالي/المخزني.

## 10) P6 — Approval Center Expansion

**ما نأخذه:**
- UI/queue improvements من Approval Inbox/Center في ZIP.
- توحيد طلبات الموافقات في مركز واحد.

**الموافقات المستهدفة:**
- discount override.
- void/cancel حسب السياسة.
- reprint.
- transfer/exceptional actions حيث يلزم.

**القاعدة:**
- approval authority = permission key، وليس role name.
- approver لا يوافق خارج branch scope إلا بصلاحية وسكوب صريحين.

## 11) P7 — Reports / Dashboard / UX donor items

يُنقل انتقائيًا فقط:
- compact report layout.
- report filters.
- custom columns.
- Excel export improvements.
- useful dashboard cards إذا كانت متوافقة مع طلب المشروع.

**لا ننقل:**
- ازدحام بصري.
- charts إلى صفحة التقارير الأساسية إذا كان عقد المشروع الحالي table-first/no-charts.
- أي بيانات مالية بدون permission gating.

## 12) ما يُمنع نقله من الـZIP نهائيًا بصورته الحالية

- `.env.example` الفارغ أو أي إزالة لـDB identity lock.
- أي URL أو project ref لمشروع مرجعي.
- أي migration/RLS/RPC يعتمد role names للتفويض.
- `is_pos_admin()` أو equivalent role-based bypass.
- owner/admin/branch_manager/warehouse_manager authorization shortcuts.
- أي Supabase config يشير إلى `scpovyrqmsbiduanykod` أو غير `azzdesuowpdcoflmyezn`.
- أي test weakening.
- أي cross-branch fallback غير محمي.
- أي استبدال شامل لـ`src/` أو `supabase/` أو `tests/`.

## 13) ترتيب التنفيذ المقترح

1. **إغلاق الدفعة النشطة الحالية أولًا:** POS Operator Display + Full Verify.
2. **P0:** Electron + Printer Settings + Local Print Agent، بدون DB migration إن أمكن.
3. **P1:** Single Print/Reprint Approval + branch print routing.
4. **P2:** TABLE_BUSY + POS UX donor improvements.
5. **P3:** User Shift Performance فوق Shared Branch Shift الحالي.
6. **P4:** Inventory/Warehouse availability & kitchen-sync بعد Schema Audit واختبارات أولًا.
7. **P5:** Purchase Cycle/Inventory Ledger.
8. **P6:** Approval Center expansion.
9. **P7:** Reports/Dashboard donor improvements.

لا تبدأ دفعة DB-heavy قبل إغلاق الدفعة السابقة Full Green.

## 14) Gate ثابت لكل دفعة

قبل اعتبار أي دفعة منقولة بنجاح:

- Repository identity ✅
- DB identity `azzdesuowpdcoflmyezn` ✅
- API contract ✅
- lint ✅
- app typecheck ✅
- tests typecheck ✅
- unit regressions ✅
- build ✅
- Fresh DB migrations ✅ عند وجود DB changes
- Schema verification ✅ عند وجود DB changes
- Integration/Security/RLS ✅
- Browser Smoke ✅
- لا تغيير Production DB قبل Full Verify ✅

## 15) سجل التنفيذ

يُضاف تحت هذا القسم فقط عند بدء كل دفعة:

### Batch Template

- Batch:
- الهدف:
- ZIP donor files reviewed:
- Current project files changed:
- Permission contract:
- Branch/RLS contract:
- DB changes: none / proposed / verified
- Regression tests:
- Local verification:
- GitHub Full Verify:
- Result: ACTIVE / BLOCKED / GREEN / MERGED
- Notes:

---

**القاعدة النهائية:** نأخذ من الـZIP السلوك النافع فقط، لكن التنفيذ النهائي يجب أن يبدو وكأنه بُني أصلًا داخل `johna-s` وفق عقوده الحالية، وليس Patch من مشروع آخر.
