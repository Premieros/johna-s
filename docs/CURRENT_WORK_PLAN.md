# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف فقط.
> الملفات القديمة الخاصة بالـBug Register / Remaining Stages / Handover / Post-Repair مراجع تاريخية فقط ولا تحدد الحالة الحالية.

آخر تحديث: **2026-09-10 — Africa/Cairo — Final Offline/Reconciliation + Print Truth hardening active**

## 1) الهوية الثابتة — غير قابلة للخلط

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Permanent development branch: `development/final-handover`
- Published site: `https://premieros.github.io/johna-s/`
- أي مستودع أو فرع مرجعي مثل `55` / `pos.v2` / `v4` / ZIP خارجي = **READ-ONLY REFERENCE ONLY**.
- الميزة تُنقل بالفكرة والسلوك فقط ثم يعاد تنفيذها بما يناسب `johna-s`؛ ممنوع النقل الأعمى أو نسخ migrations/RLS/RPC أو Supabase config من مشروع آخر.
- ممنوع استخدام Supabase `scpovyrqmsbiduanykod` لهذا المشروع.
- ممنوع تعديل `main` مباشرة أو Force Push.
- ممنوع Production DDL/Migration قبل Full Verify Green.
- ممنوع تخفيف RLS أو الاختبارات لإجبار CI على النجاح.
- Super Admin فقط implicit bypass.
- كل الأدوار الأخرى Labels فقط؛ Authorization = Permission-First + canonical branch/RLS.
- قبل أي تعديل: اجلب HEAD الحالي لـ`main` و`development/final-handover` وافهم أي commits أحدث حتى لا يتم عكس عمل نموذج آخر.

## 2) Verified Production baseline — محدث

آخر Production baseline مغلق ومثبت:

- `main`: `de0aed9e3f2ed58958b3b2b1c9b0fd44c0b1f3b1`
- PR #55: `feat(pos): operator attribution and safe table resume` — **Merged ✅**
- Verify main #955 / run `34408216822`: **Full Green ✅**
- Deploy #585 / run `34408216824`: **Success ✅**
- Core cycle المحمي: Open Shift → Create Order → Hold → Resume → Send Kitchen → Inventory deduction → Payment → Sale/Shift attribution → Close Shift.

لا يوصف أي commit أحدث من هذا الـbaseline بأنه Production Verified قبل الدمج وVerify main جديد ناجح.

## 3) Development baseline الحالي

- Branch: `development/final-handover`
- Current HEAD وقت آخر مزامنة للسجل: `bbd9e4e78ba95b2b5f0ff00c7d256930c3bc912f`
- Functional fix مباشرة قبل تحديث السجل: `d942bbcafad946d6a385ddd50c33f7d7602a3a4b`
- Parent before print-status constraint fix: `a417301fb3b61786dec1d13a95d3974a45610b15`
- PR #56: `fix: final offline reconciliation and print truth hardening`
- PR #56: **Open / Draft / غير مدمج**.
- Base: `main@de0aed9e3f2ed58958b3b2b1c9b0fd44c0b1f3b1`
- Verify #986 / run `34452227662` على HEAD `bbd9e4e...`: **IN PROGRESS وقت آخر مزامنة للسجل**.

ممنوع دمج PR #56 قبل Full Verify Green وإغلاق Production E2E المطلوب داخل Transaction مع ROLLBACK.

## 4) الدفعات المغلقة — لا تُفتح دون Regression مثبت

الآتي مغلق وظيفيًا/أمنيًا ضمن الـbaseline الحالي ما لم يظهر Regression محدد:

- Users / Roles / Permission-First ✅
- Super Admin implicit bypass فقط ✅
- Shared Branch Shift / settlement / UI ✅
- POS Discount / Payment / Order Completion ✅
- POS operator ownership + controlled operator transfer ✅
- Operator label privacy / same-branch narrow visibility ✅
- TABLE_BUSY safe owner resume ✅
- POS Availability authoritative contract ✅
- Delivery / Drive-Thru structured service contract + direct entries ✅
- Modifiers الحالية وعقود min/max/required/default/price delta/snapshots ✅ ما لم يظهر Regression محدد
- KDS Permission-First + branch/station boundaries ✅
- Send-to-kitchen delta semantics ✅
- **Inventory deduction at `send_to_kitchen`** ✅ قرار ثابت
- Warehouse transfer branch isolation ✅
- Controlled branch delete ✅
- Warehouse lifecycle ✅
- `close_shift` Permission-First ✅
- SECURITY DEFINER hardened search_path ✅
- Identity/subscription hardening ✅
- Inventory-unit production Permission-First/branch/warehouse ✅
- Shift cash integrity + branch scope ✅
- Functional core cycle release gate ✅
- Exact scan SKU/Barcode ✅
- Guided Workflow Permission-First ✅
- Financial Authority: server rejection أو ambiguous online failure لا تتحول تلقائيًا إلى offline success ✅

## 5) الدفعة النشطة — Offline / Reconciliation hardening

**الحالة: ACTIVE — FINAL DELIVERY GATE**

هدف الدفعة: لا تظهر أي عملية مالية كبيع/دفع ناجح قبل وجود حقيقة مالية مؤكدة، مع منع التكرار عند replay أو فقد الرد بعد COMMIT.

العقود الجاري تثبيتها في PR #56:

1. **Durable offline sale outbox**
   - البيع المقصود Offline يحفظ كعملية `pending sync` وليس كحقيقة مالية نهائية.
   - الصفوف `pending` / `failed` / `syncing` تبقى محسوبة Pending حتى التأكيد النهائي.
   - crash/reload أثناء `syncing` لا يجعل الطابور يبدو فارغًا.

2. **Financial truth**
   - server rejection لا يتحول إلى offline success.
   - ambiguous online exception لا يتم enqueue تلقائيًا لأن الخادم قد يكون عمل COMMIT قبل فقد الرد.
   - التأكيد النهائي يتطلب server-authoritative success مع `sale_id` صالح.

3. **Replay ownership**
   - نفس المستخدم الذي أنشأ العملية المالية Offline هو الذي يعيد replay/reconciliation لها.
   - لا يسمح بتغيير cashier/operator attribution بسبب تسجيل مستخدم آخر على نفس الجهاز لاحقًا.

4. **Warehouse reconciliation**
   - Offline capture لا يخترع warehouse.
   - عند العودة Online يتم حل warehouse الحقيقي المرتبط بالطلب أو فرع العملية قبل أي كتابة مالية.
   - إذا لم يمكن تحديد warehouse بأمان يفشل sync ويظل Pending.

5. **Idempotency / reconciliation**
   - Offline invoice key تستخدم لمنع/اكتشاف replay المكرر.
   - عند احتمال فقد الرد بعد COMMIT يتم reconciliation مع الخادم بدل افتراض الفشل أو إنشاء بيع ثانٍ.

## 6) الدفعة النشطة — Printing truth + Permission-First

**الحالة: ACTIVE — FINAL DELIVERY GATE**

العقود الجاري تثبيتها في PR #56:

1. فصل صلاحية طلب الطباعة/إعادة الطباعة عن تسجيل تنفيذ الطباعة الفعلي.
2. Printer management يظل محميًا بصلاحية الإعدادات المناسبة فقط.
3. عدم تسجيل `printed` لمجرد أن المستخدم ضغط زر الطباعة.
4. Local Print Agent يجب أن يعيد نجاحًا فعليًا قبل تسجيل نجاح التنفيذ.
5. Agent absent / station missing / printer missing / print failure = fail-closed ولا يسجل نجاحًا كاذبًا.
6. دعم مسار Cash Drawer في Local Print Agent مع فشل واضح عند عدم وجود Printer route مناسب.
7. Branch/station routing يجب أن يظل معزولًا ولا يسمح بطباعة محطة/فرع غير مخول.
8. طباعة الكابتن من الهاتف إلى طابعات الفرع الثابتة تبقى Gate تشغيلية نهائية يجب إثبات مسارها بعد Full Green الحالي.

## 7) Verify #984 — الفشل المحدد والجذر

Verify #984 على HEAD `a417301fb3b61786dec1d13a95d3974a45610b15` لم يغلق الدفعة.

النتيجة التشغيلية المهمة:

- Frontend checks ✅
- Fresh DB ✅
- Schema ✅
- Integration/Security/RLS: **605 passed / 4 failed** ❌

الجذر واحد:

- مسار `set_print_status(..., 'failed')` احتاج حفظ حالة `failed`.
- قاعدة `orders_print_status_check` كانت تسمح فقط بـ:
  - `pending`
  - `printed`
  - `cancelled`
- أول failure كسر الـtransaction، والثلاث failures الأخرى كانت نتائج لاحقة لـtransaction aborted.

لم يتم تخفيف الاختبار أو RLS.

## 8) إصلاح #984

تمت إضافة إصلاح DB contract منفصل على فرع التطوير:

- Commit: `d942bbcafad946d6a385ddd50c33f7d7602a3a4b`
- Message: `fix(printing): allow failed print status`

الإصلاح محدود إلى `orders.print_status`:

- الحفاظ على `pending` ✅
- الحفاظ على `printed` ✅
- الحفاظ على `cancelled` ✅
- إضافة `failed` ✅
- الحفاظ على Default = `pending` ✅
- لا تعديل على RLS ✅
- لا تعديل على permission model ✅
- لا Migration على Production ✅

تحديث السجل بعد هذا الإصلاح أنشأ HEAD docs-only جديدًا `bbd9e4e...`؛ لذلك Verify #986 هو الـrun الحالي الواجب اعتماده للإغلاق، وليس نجاح run أقدم على HEAD مختلف.

## 9) بوابات التسليم المتبقية

لا يقال Final 100% قبل إغلاق الثلاثة التالية بالأدلة:

### Gate A — Offline / Reconciliation

- intentional offline sale يظهر `Pending Sync` وليس نجاحًا ماليًا نهائيًا.
- server rejection لا يدخل outbox كنجاح.
- ambiguous online failure لا يتحول تلقائيًا إلى Offline.
- lost-response-after-COMMIT لا يسبب duplicate sale.
- replay/reconciliation idempotent.
- failed sync يظل Pending وقابلًا للمراجعة.
- successful reconciliation وحده ينهي Pending state.
- operator/cashier attribution لا يتغير أثناء replay.

### Gate B — Printing / Permission Matrix

- `pos.receipt.print` / reprint rules تطبق حسب الصلاحيات الفعلية لا role names.
- Printer management لا يظهر إلا بصلاحية الإعدادات المناسبة.
- Print Agent absent لا يسجل print success.
- فشل printer/station لا يسجل success.
- branch/station isolation مثبت.
- Captain/mobile printing → branch cashier/kitchen/barista routing يتم إثباته عمليًا.

### Gate C — Real Production E2E with ROLLBACK

على Production الوحيد `azzdesuowpdcoflmyezn`:

- الاختبار يكون داخل Transaction واحدة قدر الإمكان.
- كل writes التجريبية يتم ROLLBACK لها.
- ممنوع ترك بيانات اختبار دائمة.
- يغطي على الأقل: branch scope → active shift → order → send_to_kitchen → stock deduction contract → payment/settlement → attribution → permission/RLS boundaries.
- Physical/local printing negative-path والـPrint Agent يختبران خارج DB transaction؛ لا يتم ادعاء طباعة فعلية من اختبار SQL.

## 10) متطلبات تشغيلية ثابتة يجب الحفاظ عليها

- Arabic-first RTL، Touch-friendly.
- صلاحيات POS granular مثل `pos.view`, `pos.order.create`, `pos.order.edit`, `pos.payment.take`, `pos.order.split`, `pos.order.transfer`, `pos.receipt.print`, `pos.send_kitchen`, `pos.pay`؛ لا استخدام role names كAuthorization.
- يجب دعم أنماط مثل View Only وPay Only متى كانت الصلاحيات المطلوبة متاحة.
- Dine-in / Take Away / Drive Thru / Delivery / Quick Order.
- الطاولة المشغولة تعرض اسم المشغل الآمن.
- Send to kitchen مرة واحدة ثم التعديلات كDelta.
- المخزون يخصم عند `send_to_kitchen` وليس عند إنشاء الطلب أو فحص Availability.
- Hold/Resume، split bill، table/order transfer، print once/reprint permission.
- Printer management لا يظهر إلا لمن يملك صلاحية الإعدادات المناسبة.
- التقارير compact/tabular وليست crowded؛ filters/export حسب العقود المتاحة.
- أي نقل UI لا يغيّر منطق الصلاحيات أو RLS أو financial authority ضمنيًا.

## 11) قاعدة الإغلاق والدمج

أي دفعة لا تعتبر مغلقة إلا إذا:

1. تم تحديث هذا السجل بنتيجتها الدقيقة.
2. lint/typecheck/unit/build خضراء.
3. Fresh DB + schema خضراء عند وجود DB contract.
4. Integration/Security/RLS خضراء.
5. Browser Smoke أخضر للدفعات المؤثرة على الواجهة/التشغيل.
6. لا Production migration غير Verified.
7. لا merge إلى `main` إلا بعد تحقق الشروط السابقة وقرار الدمج المناسب.
8. لا يعتمد الإغلاق على اسم workflow أو نجاح جزئي؛ يجب مطابقة نتيجة الـrun مع HEAD المقصود.

---

**NEXT ACTION:** افحص نتيجة Verify #986 على `bbd9e4e78ba95b2b5f0ff00c7d256930c3bc912f`. إذا Full Green، أغلق Offline/Print regression gate ثم اختبر Captain/mobile printer routing، وبعدها نفذ Real Production E2E داخل Transaction مع ROLLBACK. لا تدمج PR #56 قبل إغلاق هذه البوابات وتحديث هذا السجل مرة أخرى.
