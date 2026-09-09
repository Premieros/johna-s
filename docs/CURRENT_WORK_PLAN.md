# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف فقط.
> الملفات القديمة الخاصة بالـBug Register / Remaining Stages / Handover / Post-Repair مراجع تاريخية فقط ولا تحدد الحالة الحالية.

آخر تحديث: **2026-09-09 16:43 — Africa/Cairo — Availability active after TABLE_BUSY Full Green**

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
- HEAD قبل هذا التحديث: `50ed608f1290dfff7de17bc3d1a60899001f1e33`
- PR #55: `feat(pos): operator attribution and safe table resume` — **Open / غير مدمج**.
- Verify #924 / run `34353897055` على HEAD `50ed608f...`: **Full Green** ✅
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

## 5) الدفعة النشطة الآن — Availability server contract hardening

**الحالة: ACTIVE**

الهدف:
- جعل Availability في POS تعتمد على عقد Server/DB authoritative متوافق مع بنية `johna-s` بدل الاعتماد على استنتاج Frontend قابل للانحراف.
- المحافظة على branch isolation وwarehouse scope وBOM/inventory-unit semantics الحالية.
- عدم نقل migration/RLS/RPC من أي مرجع كما هي؛ المرجع يستخدم فقط لفهم السلوك المطلوب.

خطوات التنفيذ الإلزامية:

1. تحديد مصدر `stockMap` الحالي وكل مسارات إظهار/منع المنتج في POS.
2. تحديد معنى Availability الحالي للمنتج:
   - ready inventory unit.
   - product-unit links.
   - BOM/component availability إن كانت مستخدمة في العقد الحالي.
   - warehouse الافتراضي/المحدد للفرع.
3. مقارنة Read-Only مع المرجع الأنسب فقط لتحديد الفجوة الوظيفية، بدون أي write على المرجع.
4. إنشاء/تقوية Server contract داخل `johna-s` بأضيق تغيير ممكن.
5. Fail closed عند غياب branch/warehouse أو عند بيانات غير مكتملة؛ Guided Routing يوجه المستخدم للإعداد المطلوب بدل raw error متى كان ذلك ضمن UX الحالي.
6. عدم خصم المخزون عند مجرد فحص Availability؛ الخصم النهائي يبقى عند `send_to_kitchen` طبقًا للقرار التشغيلي الثابت.
7. Regression tests يجب أن تشمل على الأقل:
   - نفس الفرع/المخزن الصحيح.
   - منع cross-branch leakage.
   - منتج متاح وغير متاح.
   - نفاد ready unit.
   - BOM/component shortage إذا كان العقد الحالي يدعم BOM.
   - عدم تحويل Unknown/Error إلى Available.
8. Full Verify إلزامي قبل إغلاق الدفعة أو الانتقال للدفعة التالية.

## 6) ترتيب النقل بعد Availability

لا يبدأ التالي قبل Full Verify Green للدفعة الحالية:

1. Availability server contract hardening — **ACTIVE**.
2. Delivery / Drive-Thru operational parity.
3. Modifiers / KDS parity المتبقي فقط؛ لا إعادة بناء ما هو مغلق بالفعل.
4. Offline / Reconciliation hardening، مع الحفاظ على Financial Authority وعدم تحويل online ambiguity إلى offline success.

## 7) العقود المحمية — لا تُفتح دون Regression مثبت

- Users / Roles / Permission-First ✅
- Super Admin implicit bypass فقط ✅
- Shared Branch Shift / settlement / UI ✅
- POS Discount / Payment / Order Completion ✅
- POS operator ownership + controlled operator transfer ✅
- Operator label privacy / same-branch narrow visibility ✅
- TABLE_BUSY safe owner resume ✅
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

## 8) متطلبات تشغيلية ثابتة يجب الحفاظ عليها

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

## 9) قاعدة الإغلاق والدمج

أي دفعة لا تعتبر مغلقة إلا إذا:

1. تم تحديث هذا السجل بنتيجتها الدقيقة.
2. lint/typecheck/unit/build خضراء.
3. Fresh DB + schema خضراء عند وجود DB contract.
4. Integration/Security/RLS خضراء.
5. Browser Smoke أخضر للدفعات المؤثرة على الواجهة/التشغيل.
6. لا Production migration غير Verified.
7. لا merge إلى `main` إلا بعد تحقق الشروط السابقة وقرار الدمج المناسب.

---

**NEXT ACTION:** أكمل `Availability server contract hardening` من HEAD الحالي، ثم شغّل Full Verify وسجل النتيجة هنا قبل الانتقال إلى Delivery/Drive-Thru.
