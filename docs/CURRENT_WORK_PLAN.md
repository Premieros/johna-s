# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

آخر تحديث: **2026-09-14 — POS / Branch / Catalog stabilization**

> هذا هو السجل الحي المختصر للمشروع. للتفاصيل التاريخية راجع `docs/STABILIZATION_WORK_LOG.md` وملفات الإغلاق السابقة.

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
- لا Production migration قبل Full Verify Green وموافقة صريحة.
- قبل كل write/merge: اجلب أحدث `main` والفرع/PR وافحص أي عمل أحدث أو متوازٍ.

## Baseline الحالي

- `main@b5f4169299ea57a5287b013430013e0c568ea28e`
- PR #114 — reusable modifier groups + manufactured-item migration: **MERGED**.
- Full Verify #1322 على PR #114: **Full Green** بما في ذلك Browser Smoke.
- فرع التثبيت الحالي: `development/stabilize-pos-mobile-branch-catalog`.
- الطباعة الحالية تعمل ومجمّدة خارج Scope هذه الحزمة؛ ممنوع تعديل Print Agent / printer routing / queues / printer settings في هذا العمل.

## Scope التثبيت الحالي

تم إثبات الأسباب التالية وتنفيذ إصلاحات صغيرة فقط على فرع التطوير:

1. **تبديل الفروع للمستخدم متعدد الفروع**
   - السبب: RLS القراءة على `branches` لم يستخدم عقد الوصول canonical `user_may_access_branch(id)`.
   - الإصلاح: `20260914010500_branch_access_select_rls.sql` يضيف canonical branch access مع الحفاظ على قواعد platform/organization الحالية وبدون role-name bypass.

2. **POS kitchen deduction يفشل مع manufactured auto-production وخامة ناقصة**
   - السبب: raw مباشر في POS يسمح بالسالب، لكن `produce_inventory_unit` في مسار `AUTO_SALE_PRODUCTION` كان يستدعي FIFO strict.
   - الإصلاح: `20260914010600_pos_auto_production_negative_raw.sql` يسمح بالسالب فقط عندما `p_notes = 'AUTO_SALE_PRODUCTION'`؛ التصنيع اليدوي يظل strict ويرفض النقص.

3. **Modifier UX غير واضح بعد PR #114**
   - صفحة الـModifier Groups موجودة group-first بالفعل.
   - تم تغيير اسم القائمة إلى `مجموعات الموديفاير / Modifier Groups` لتمييز التصميم الجديد بوضوح.

4. **صفحة مكونات القديمة**
   - تمت إزالة `ComponentsPage.tsx` من الواجهة والقائمة.
   - `/components` أصبح legacy redirect إلى `/products`.
   - لم يتم حذف `product_components` أو العقود الداخلية التي لا تزال الوصفات تحتاجها.

5. **الدفع من الهاتف / تنظيم Checkout**
   - السبب المثبت: `handlePay` يغلق mobile cart بينما checkout موجود في right panel المخفي تحت `lg`، فيصبح الدفع غير ظاهر على الهاتف.
   - الإصلاح الحالي في طبقة Mobile CSS: عند وجود `pos-payment-confirm` يتم تحويل hidden checkout wrapper إلى full-viewport mobile checkout، مع `100dvh` وSafe Area، وجعل split payment responsive.

6. **حذف سجل المبيعات التجريبي**
   - Production audit قبل الحذف: 11 orders + 4 sales فقط، مع 2 `sale_print_events` و11 `cloud_print_jobs` مرتبطة بالتجارب.
   - محاولة الحذف عبر أداة Production مُنعت بواسطة destructive-action protection؛ لم يتم تجاوز الحماية ولم يتم حذف أي سجل حتى الآن.
   - لا يتم اعتبار هذه النقطة منتهية حتى يتم الحذف عبر مسار إداري مسموح ثم التحقق من العدادات، بدون إعادة كتابة أرصدة المخزون.

## Regression gate لهذه الحزمة

- `tests/unit/stabilizationPosBranchCatalogContract.test.ts` يثبت:
  - canonical multi-branch RLS.
  - negative raw فقط لـPOS auto-production وليس manual production.
  - إزالة Components page من المنتج المدعوم وإظهار Modifier Groups.
  - mobile checkout full viewport + safe area + responsive split payment.
- يجب تشغيل Full Verify كامل قبل الدمج: lint + typecheck + unit + build + fresh DB + schema + integration/security/RLS + Browser Smoke.
- يجب مراجعة changed files والتأكد أن أي ملفات طباعة لم تُمس.
- لا Merge قبل موافقة صريحة.
- لا Production migration قبل Full Green وموافقة صريحة منفصلة.

## عقود ثابتة لا يعاد فتحها بلا Regression مثبت

- Permission-First؛ Super Admin فقط implicit bypass.
- granular POS permissions تشمل view/create/edit/pay/split/transfer/receipt/send-kitchen.
- `send_to_kitchen` هو authority لاستهلاك المخزون؛ first send مرة ثم delta، وretry لا يكرر الاستهلاك.
- configured POS products تباع حتى مع نقص raw؛ raw debt مسموح في kitchen send حسب العقد المثبت.
- branch + warehouse isolation وRLS لا يتم تخفيفها.
- approval system enforced.
- username يظهر على الطاولة المشغولة وما يخص المستخدم حيث يلزم.
- printer management فقط لصاحب صلاحية الإعدادات.
- print once + controlled reprint، ولا physical print success كاذب.
- لا network/offline ambiguity تتحول إلى sale/payment success وهمي.
- Reports compact/tabular + filters + Excel export.
- guided prerequisite routing بدل raw errors حيث أمكن.
- Production ليست test environment.

## NEXT ACTION

1. افتح PR لحزمة التثبيت الحالية فقط.
2. شغّل Full Verify كامل بما في ذلك Browser Smoke ومراجعة mobile checkout.
3. أصلح فقط أي Regression مثبت بدون توسيع Scope وبدون لمس الطباعة.
4. بعد Full Green: اعرض الحالة للمراجعة؛ لا Merge إلا بموافقة صريحة.
5. بعد الدمج وVerify main فقط، يمكن طلب موافقة منفصلة لتطبيق migrations على Production.
6. حذف سجل المبيعات التجريبي يبقى خطوة Production مستقلة عبر مسار يسمح بالـdestructive action ثم verify للعدادات.

## التنفيذ القياسي

`Baseline -> Root Cause -> Small Change -> Focused Tests -> Integration/Regression -> Full Verify -> PR -> Merge only when allowed -> Verify main -> Deploy`

لا يُغيّر Business Logic صحيح لإرضاء اختبار خاطئ، ولا يُحذف Legacy إلا بعد إثبات الاستخدام/الاستبدال/التغطية ثم Full Verify.
