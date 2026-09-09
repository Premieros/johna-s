# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف فقط.
> الملفات القديمة الخاصة بالـBug Register / Remaining Stages / Handover / Post-Repair مراجع تاريخية فقط ولا تحدد الحالة الحالية.

آخر تحديث: **2026-09-09 22:51 — Africa/Cairo — Availability Full Green; Delivery/Drive-Thru active**

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
- Availability functional HEAD: `f0693915e27b7accdead26197a90a74cc9804e38`
- PR #55: `feat(pos): operator attribution and safe table resume` — **Open / غير مدمج**.
- Verify #932 / run `34396769013` على HEAD `f0693915...`: **Full Green** ✅
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

## 6) الدفعة النشطة الآن — Delivery / Drive-Thru operational parity

**الحالة: ACTIVE**

القاعدة:
- لا إنشاء POS ثانٍ أو دورة طلب موازية.
- إعادة استخدام نفس `OrderStartWizard` + `PosWorkspacePage` + order lifecycle الحالي.
- `delivery` و`drive_thru` موجودان بالفعل كـorder types؛ المطلوب إغلاق الفجوات التشغيلية فقط.
- أي مرجع خارجي، بما فيه ElitaleRestro، Read-Only للفكرة والسلوك فقط؛ لا نسخ كود أو migrations/RLS/RPC.

الفجوات المثبتة قبل التنفيذ:
- Delivery الحالي يجمع العميل/الهاتف/العنوان/الملاحظات لكنه يحول الهاتف والعنوان إلى نص داخل `notes`؛ لا يوجد service contract مستقل للرسوم/المندوب/بيانات التوصيل.
- Drive-Thru الحالي يجمع رقم السيارة/العميل/الملاحظات ويحولها إلى `notes`؛ لا توجد حقول تشغيلية مستقلة للسيارة/الطابور.
- نموذج `orders` الحالي لا يملك حقول Delivery/Drive-Thru تشغيلية مستقلة؛ الموجود أساسًا `customer_id`, `guest_count`, `notes` مع `order_type`.

خطوات التنفيذ الإلزامية:
1. إضافة direct entry parity لـ`/delivery` و`/drive-thru` فوق نفس POS، بدون نسخ شاشة البيع.
2. جعل OrderStartWizard يقبل نوع طلب ابتدائي من route مع إمكانية الرجوع/التغيير وفق الصلاحيات الحالية.
3. Delivery: حفظ البيانات المطلوبة بشكل منظم وآمن: customer/phone/address/notes، مع fee/driver فقط إذا ثبت مصدر إعداداتهما وعقدهما المحاسبي.
4. Drive-Thru: حفظ car/vehicle identifier بصورة منظمة وآمنة، مع أي queue/sequence فقط إذا كان له عقد فعلي مطلوب.
5. أي `extra_charge` يجب أن يكون non-negative، server-authoritative، يدخل total/receipt/accounting/reporting ولا يكون Frontend-only.
6. أي `staff_required`/driver assignment يجب أن يتحقق Server-side من user active + branch scope + الصلاحية المطلوبة؛ لا role-name authorization.
7. تحديث order read/update contracts بحيث تظهر البيانات عند Hold/Resume/Orders/Receipt ولا تضيع بعد الاستئناف.
8. المحافظة على operator attribution وTABLE_BUSY ownership وعدم السماح لمسار Delivery/Drive-Thru بتجاوز shift/branch/permission guards.
9. Regression tests: create/resume/update لكل نوع، branch isolation، invalid driver/staff، negative charge، accounting/receipt total إن أضيفت رسوم.
10. E2E/Browser: بدء Delivery وDrive-Thru من المدخل المباشر ومن الـwizard، ثم order → kitchen → payment بدون كسر المسار الأساسي.
11. Full Verify إلزامي قبل إغلاق الدفعة.

## 7) ترتيب النقل بعد Delivery/Drive-Thru

1. Delivery / Drive-Thru operational parity — **ACTIVE**.
2. Modifiers / KDS parity المتبقي فقط؛ لا إعادة بناء ما هو مغلق بالفعل.
3. Offline / Reconciliation hardening، مع الحفاظ على Financial Authority وعدم تحويل online ambiguity إلى offline success.
4. Final release audit: dependencies/security warnings + final E2E acceptance + production migration/merge decision.

## 8) العقود المحمية — لا تُفتح دون Regression مثبت

- Users / Roles / Permission-First ✅
- Super Admin implicit bypass فقط ✅
- Shared Branch Shift / settlement / UI ✅
- POS Discount / Payment / Order Completion ✅
- POS operator ownership + controlled operator transfer ✅
- Operator label privacy / same-branch narrow visibility ✅
- TABLE_BUSY safe owner resume ✅
- POS Availability authoritative contract ✅
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

## 9) متطلبات تشغيلية ثابتة يجب الحفاظ عليها

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

## 10) قاعدة الإغلاق والدمج

أي دفعة لا تعتبر مغلقة إلا إذا:

1. تم تحديث هذا السجل بنتيجتها الدقيقة.
2. lint/typecheck/unit/build خضراء.
3. Fresh DB + schema خضراء عند وجود DB contract.
4. Integration/Security/RLS خضراء.
5. Browser Smoke أخضر للدفعات المؤثرة على الواجهة/التشغيل.
6. لا Production migration غير Verified.
7. لا merge إلى `main` إلا بعد تحقق الشروط السابقة وقرار الدمج المناسب.

---

**NEXT ACTION:** أكمل `Delivery / Drive-Thru operational parity` من HEAD الحالي فوق نفس POS، ثم شغّل Full Verify وسجل النتيجة قبل الانتقال إلى Modifiers/KDS.
