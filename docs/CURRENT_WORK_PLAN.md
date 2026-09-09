# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف فقط.
> الملفات القديمة الخاصة بالـBug Register / Remaining Stages / Handover / Post-Repair مراجع تاريخية فقط ولا تحدد الحالة الحالية.

آخر تحديث: **2026-09-09 23:25 — Africa/Cairo — Delivery/Drive-Thru Full Green; KDS permission hardening active**

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

## 2) Verified Production baseline

آخر Production baseline مغلق:

- `main`: `afef2ad024f55b1ab1523ba1530e19f13581e56a`
- PR #54: `fix: align POS scan and guided workflow contracts` مدمج ✅
- Verify main #912 / run `34321160701`: **Full Green** ✅
- Deploy #584 / run `34321160600`: ✅
- Core cycle المحمي: Open Shift → Create Order → Hold → Resume → Send Kitchen → Inventory deduction → Payment → Sale/Shift attribution → Close Shift.

لا يوصف أي commit أحدث من Production baseline بأنه Production Verified قبل الدمج وVerify main الجديد.

## 3) Development baseline الحالي

- Branch: `development/final-handover`
- Last functional Full Green HEAD: `c1314c47f360e5afd28f1389c79252168fca4f9f`
- PR #55: `feat(pos): operator attribution and safe table resume` — **Open / غير مدمج**.
- Verify #945 / run `34400078544` على HEAD `c1314c47...`: **Full Green** ✅
  - Locked Supabase identity ✅
  - Frontend API contract ✅
  - lint ✅
  - app typecheck ✅
  - tests typecheck ✅
  - unit ✅
  - build ✅
  - Fresh DB canonical migrations ✅
  - Schema verification ✅
  - Integration/Security/RLS ✅
  - Browser Smoke ✅

## 4) دفعة Operator attribution + TABLE_BUSY — مغلقة Full Green على التطوير

تم تنفيذ وإثبات التالي:

1. **اسم المستخدم/المشغل على أسطح POS**
   - إظهار الاسم الآمن للمستخدم المسؤول على الطاولة المشغولة والأسطح المرتبطة بالطلب حيث يوجد attribution.
   - المصدر الأمني هو `get_pos_order_operator_labels` المحدود بالفرع والصلاحية، بدون توسيع `public.users` أو كشف UUID/بيانات أوسع.
   - اسم منفذ الدفع يظهر على الإيصال حيث يلزم.

2. **Safe TABLE_BUSY resolver**
   - إضافة `resolve_my_active_table_order` كحد ضيق لمعالجة سباق إنشاء الطلب على طاولة مشغولة.
   - يعيد `order_id` فقط إذا كان الطلب المفتوح/المعلق يخص المستخدم الحالي نفسه.
   - المستخدم الآخر في نفس الفرع يرى `TABLE_BUSY` بدون تسريب order id.
   - المستخدم خارج الفرع يفشل fail-closed.
   - Super Admin لا يحصل عبر هذا helper الضيق على order id لمستخدم آخر؛ مسارات transfer/admin المنفصلة تبقى هي السلطة الصحيحة.

3. **Regression**
   - `tests/integration/pos_table_busy_owner_resume.test.ts`.
   - فشل Verify #923 كان Fixture غير صالح: الاختبار أنشأ طلبًا فارغًا عبر `create_order` بعد تشديد عقد الطلب/التسعير.
   - تم إصلاح **Fixture الاختبار فقط** ليستخدم دورة طلب حقيقية متوافقة؛ لم يتم إضعاف `create_order` أو RLS أو Resolver.
   - Verify #924 أغلق الدفعة Full Green.

4. **قاعدة واجهة الاستئناف**
   - عند `TABLE_BUSY` لا يتم إنشاء طلب ثانٍ ولا نقل ملكية ضمني.
   - إذا كان Resolver يثبت أن الطلب للمستخدم الحالي يمكن استئنافه بأمان.
   - لا يتم دمج سلة جديدة تلقائيًا فوق الطلب الموجود ولا استبدال أصناف بصمت؛ تجنب تكرار أو فقد أصناف.

هذه الدفعة لا تُفتح مجددًا إلا بRegression مثبت.

## 5) Availability server contract hardening — مغلقة Full Green

**الحالة: CLOSED ✅**

تم تنفيذ وإثبات التالي:

1. `get_pos_product_availability` أصبح Server/DB authoritative داخل `johna-s` مع الحفاظ على branch/warehouse scope.
2. التحقق يرفض المستخدم غير النشط، ويرفض cross-branch access، ويرفض warehouse لا يتبع الفرع المطلوب.
3. الصفر الحقيقي للمخزون يبقى **authoritative zero**، ولا يتحول Unknown/Error في مصدر المخزون أو الوصفة إلى `Out of Stock` كاذب.
4. المنتج ذو مصدر تصنيع غير قابل للحسم (مثل manufactured unit بلا recipe) يُحذف من نتيجة Availability بدل اختلاق كمية صفر.
5. shortage codes المعروفة تبقى صريحة في عقد الخادم، ومنها:
   - `INSUFFICIENT_PRODUCT_STOCK`
   - `INSUFFICIENT_UNIT_STOCK`
   - `INSUFFICIENT_RAW_MATERIAL_STOCK`
6. لا خصم للمخزون أثناء Availability؛ الخصم النهائي يبقى عند `send_to_kitchen` طبقًا للقرار التشغيلي الثابت.
7. Regression: `tests/integration/pos_availability_unknown_source.test.ts` يغطي authoritative zero، unknown source، cross-branch deny، warehouse mismatch، shortage contract.
8. فشل Verify #930/#931 كان في transaction fixture للاختبارات المتوقعة أن ترمي SQL error؛ تم إصلاح fixture فقط باستخدام savepoint/rollback scope بدون تخفيف RLS أو تغيير السلوك الأمني.
9. Verify #932 / run `34396769013`: **Full Green ✅** بما فيه Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.

هذه الدفعة لا تُفتح مجددًا إلا بRegression مثبت.

## 6) Delivery / Drive-Thru operational parity — مغلقة Full Green

**الحالة: CLOSED ✅**

تم تنفيذ وإثبات التالي:

1. لا يوجد POS ثانٍ أو دورة طلب موازية؛ كلا النوعين يعيدان استخدام نفس `OrderStartWizard` + `PosWorkspacePage` + order lifecycle الحالي.
2. تمت إضافة direct entries مركزية:
   - `/delivery` → نفس `/pos` مع بدء خطوة Delivery.
   - `/drive-thru` → نفس `/pos` مع بدء خطوة السيارة.
3. `orders.service_details` أصبح عقدًا منظمًا وآمنًا بدل الاعتماد على `notes` فقط.
4. Delivery يحفظ `phone` و`address` و`note` بصورة منظمة؛ الهاتف والعنوان مطلوبان Server-side.
5. Drive-Thru يحفظ `vehicle_identifier` مع `customer_name`/`note` الاختياريين بصورة منظمة.
6. `create_service_order` و`update_service_order` wrappers ضيقة تستدعي العقود الأساسية `create_order`/`update_order` داخل نفس المعاملة؛ لا bypass لدورة الطلب أو branch/ownership guards.
7. Resume/Update يحافظان على `service_details` ولا يمسحان بيانات الخدمة.
8. البيانات المقروءة تظل متاحة في `notes` للتوافق مع الشاشات الحالية، مع `service_details` كمصدر منظم للتشغيل والتقارير المستقبلية.
9. لم تتم إضافة Delivery fee أو driver assignment؛ لا يوجد حتى الآن contract محاسبي/صلاحيات موثق يسمح بإضافتهما بأمان، لذلك لم يتم إدخال Frontend-only charges أو role-name assignment.
10. Regression DB: `tests/integration/pos_service_order_details.test.ts` يغطي create/update/resume وinvalid data وcross-branch وanon.
11. Regression UI/route: `tests/unit/posDirectServiceEntryContract.test.ts` يثبت أن المدخلين يمران إلى نفس POS ويستهلكان `startStep` الصحيح.
12. Verify #941 أثبت service-details contract Full Green، ثم Verify #945 / run `34400078544` على HEAD `c1314c47...` أغلق direct-entry parity **Full Green ✅** بما فيه Browser Smoke.

هذه الدفعة لا تُفتح مجددًا إلا بRegression مثبت.

## 7) الدفعة النشطة الآن — Modifiers / KDS parity المتبقي فقط

**الحالة: ACTIVE**

قاعدة العمل:
- لا إعادة بناء Modifiers أو KDS الموجودين أصلًا بدون Regression مثبت.
- Modifiers الحالية لديها min/max/required/default selections، single/multiple، price deltas، item notes وmodifier snapshots؛ تُعامل كمغلقة وظيفيًا ما لم يظهر خلل محدد.
- KDS الحالية لديها branch/station queue، realtime/polling، modifiers/notes، وحالات sent → cooking → ready → served.

الفجوة الأمنية المثبتة:
- `get_kitchen_queue` و`get_my_kitchen_stations` يستخدمان `pos.kds_view` للقراءة، وهذا صحيح.
- `set_kitchen_status` يستخدم أيضًا `pos.kds_view` لتغيير حالة المطبخ، وبذلك مستخدم View-Only يستطيع الكتابة.
- لا توجد حاليًا صلاحية مستقلة لتغيير KDS ضمن Permission Definitions.

الخطوات الإلزامية:
1. إنشاء صلاحية كتابة KDS مستقلة باسم متوافق مع naming convention الحالي بعد مراجعة migration/permission seeding الحالية.
2. إبقاء route/page visibility على `pos.kds_view` فقط.
3. تقييد أزرار/Actions تغيير الحالة في الواجهة بصلاحية الكتابة الجديدة.
4. تعديل `set_kitchen_status` ليطلب صلاحية الكتابة الجديدة Server-side بدل `pos.kds_view`.
5. الحفاظ على branch isolation وSECURITY DEFINER hardened `search_path` وعدم إدخال role-name authorization.
6. التحقق هل station assignment الحالي يمنع مستخدم محطة واحدة من تحديث طلب/سطور محطة أخرى؛ إذا ظهر bypass فعلي يُغلق بأضيق تغيير ممكن.
7. Regression tests على الأقل:
   - KDS View-Only يستطيع القراءة ولا يستطيع تغيير الحالة.
   - مستخدم بصلاحية الكتابة يستطيع تغيير الحالة داخل فرعه/محطته المسموحة.
   - cross-branch deny.
   - station-scope deny إذا كان العقد الحالي محطة-محددًا.
8. Full Verify إلزامي قبل إغلاق الدفعة.

## 8) ترتيب النقل بعد KDS

1. Modifiers / KDS parity المتبقي فقط — **ACTIVE**.
2. Offline / Reconciliation hardening، مع الحفاظ على Financial Authority وعدم تحويل online ambiguity إلى offline success.
3. Final release audit: dependencies/security warnings + final E2E acceptance + production migration/merge decision.

## 9) العقود المحمية — لا تُفتح دون Regression مثبت

- Users / Roles / Permission-First ✅
- Super Admin implicit bypass فقط ✅
- Shared Branch Shift / settlement / UI ✅
- POS Discount / Payment / Order Completion ✅
- POS operator ownership + controlled operator transfer ✅
- Operator label privacy / same-branch narrow visibility ✅
- TABLE_BUSY safe owner resume ✅
- POS Availability authoritative contract ✅
- Delivery / Drive-Thru structured service contract + direct entries ✅
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
- Financial Authority: explicit offline only; server rejection/ambiguous online failure لا تتحول offline success ✅

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

---

**NEXT ACTION:** أغلق فجوة KDS Permission-First بفصل View عن status mutation، ثم Full Verify وسجل النتيجة قبل الانتقال إلى Offline/Reconciliation.