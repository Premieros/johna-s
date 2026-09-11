# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف، ثم يجلب HEAD الحالي لـ`main` والفرع/PR قبل أي تعديل لأن نماذج أخرى قد تعمل بالتوازي.

آخر تحديث: **2026-09-11 — Africa/Cairo — إصلاح تذكرة المطبخ V2 نشط على فرع تطوير منفصل**

## 1) الهوية الثابتة — غير قابلة للخلط

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Published site: `https://premieros.github.io/johna-s/`
- أي مشروع/مستودع آخر مثل `55` / `pos.v2` / `v4` / ZIP خارجي = **READ-ONLY REFERENCE ONLY**.
- ممنوع استخدام Supabase `scpovyrqmsbiduanykod` لهذا المشروع.
- ممنوع تعديل `main` مباشرة أو Force Push.
- ممنوع تشغيل Production migration قبل Full Verify Green وقرار نشر صريح.
- ممنوع تخفيف RLS أو حذف/إضعاف الاختبارات لإجبار CI على النجاح.
- Super Admin فقط implicit bypass.
- كل الأدوار الأخرى Labels فقط؛ Authorization = Permission-First + branch/RLS.
- قبل أي write: اجلب HEAD الحالي لـ`main` والفرع/PR المستهدف وافحص أي commits أحدث.
- عند الدمج استخدم expected SHA guard متى أمكن.

## 2) الحالة الحالية لـ main

- `main` HEAD الحالي = `c462b2014671ed6a4cc003006c8ad87bf848cd21`.
- هذا هو merge commit لـPR #66: `fix(print): restore 80mm kitchen ticket layout (#66)`.
- PR #66 مدمج ومغلق.
- Verify main #1072 بعد الدمج: Full Green ✅.
- Deploy GitHub Pages #596: Success ✅.
- Production `receipt_width_mm` تم تصحيحه من 58 إلى 80 للطابعة الحالية XP-80C بدون migration.

## 3) الدفعة النشطة — Kitchen Ticket Layout V2

- Branch: `development/kitchen-ticket-layout-v2`
- Base: `main@c462b201...`
- السبب: اختبار الطابعة الفعلي بعد PR #66 أظهر أن الخط أصبح أوضح، لكن:
  - الكمية لم تكن بارزة بما يكفي بجانب الصنف.
  - لم تكن حدود جسم التذكرة واضحة.
  - Chrome/تعريف الطابعة كان يعرض صفحة أطول بكثير من المحتوى مع فراغ أبيض كبير.

### التعديلات الحالية

1. **كمية الطلب**
   - كل صنف مطبخ يعرض الكمية في badge كبيرة ملاصقة لاسم الصنف بصيغة `2×`.
   - تبقى أيضًا تسمية `الكمية: 2` أسفل الصنف كتحقق بصري إضافي.

2. **حدود التذكرة**
   - جسم تذكرة المطبخ له border أسود واضح حول المحتوى بالكامل.
   - فواصل العناصر والبيانات تبقى واضحة للطابعة الحرارية.

3. **تقليل المساحة البيضاء**
   - يتم حساب `pageHeightMm` من عدد صفوف البيانات وعدد الأصناف وطول أسماء الأصناف.
   - `@page size` يرسل للطباعة عرض الورق الحقيقي وارتفاعًا قريبًا من المحتوى بدل صفحة طويلة ثابتة.
   - `html/body` لا يفرضان min-height كبيرًا.

4. **Regression test**
   - `tests/unit/kitchenTicketLayoutContract.test.ts`
   - يقفل ظهور quantity badge وحدود التذكرة وcontent-sized page contract.

## 4) Production findings / safety

- لا يوجد migration في هذه الدفعة.
- لا تغيير على RLS أو الصلاحيات أو المخزون أو approvals.
- لا تغيير على منطق `send_to_kitchen` أو تسجيل نجاح الطباعة.
- لا ادعاء Physical Print success إلا بعد اختبار المستخدم على XP-80C.
- إذا تجاهل تعريف XP-80C قيمة CSS `@page size`، سيكون الجزء المتبقي إعداد Paper Size في Windows driver، وليس منطق الطلب نفسه.

## 5) متطلبات ثابتة لا يجوز كسرها

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
- Approval system enforced، بما في ذلك العمليات الحساسة مثل split/merge/transfer حسب العقد.
- Printer management لا يظهر إلا لصاحب صلاحية الإعدادات المناسبة.
- الطاولة المشغولة وكل كيان مرتبط بمستخدم يجب أن يعرض اسم المشغل/المستخدم بصورة آمنة ضمن النطاق المسموح.
- Send to kitchen أول مرة ثم التعديلات كDelta.
- Hold/Resume، split، merge/transfer، print once + controlled reprint.
- لا تحوّل network/offline ambiguity إلى sale/payment success وهمي.
- غياب/فشل Print Agent لا يسجل print success كاذبًا.

## 6) قواعد التحقق والإغلاق

أي دفعة لا تعتبر جاهزة للدمج إلا بعد:

1. Fetch أحدث `main` وHEAD الفرع/PR.
2. فهم أي drift أو commits أحدث وعدم عكس عمل متوازٍ بلا مراجعة.
3. locked Supabase identity ✅
4. frontend API contract ✅
5. lint ✅
6. typecheck application + tests ✅
7. unit ✅
8. build ✅
9. Fresh DB canonical migrations ✅ عند الحاجة
10. schema ✅
11. Integration/Security/RLS ✅
12. Browser Smoke ✅ للتغييرات المؤثرة على الواجهة/التشغيل
13. عدم وجود migration غير Verified تم دفعها إلى Production.
14. إذا تحرك `main` بعد verification، أعد فحص drift والتحقق المناسب قبل الدمج.

## 7) NEXT ACTION — إلزامي

1. افتح PR للفرع `development/kitchen-ticket-layout-v2`.
2. شغّل Verify على HEAD النهائي الذي يشمل كود الطباعة + regression test + تحديث هذا السجل.
3. لا تدمج قبل Full Green على نفس HEAD.
4. بعد الدمج والنشر، اختبر XP-80C فعليًا.
5. إذا بقيت مساحة بيضاء رغم نجاح `@page size` في الكود، افحص Windows printer driver / custom paper size كسبب خارجي منفصل.

لا تلمس أي مستودع أو قاعدة بيانات أخرى.
