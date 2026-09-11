# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف، ثم يجلب HEAD الحالي لـ`main` والفرع/PR قبل أي تعديل لأن نماذج أخرى قد تعمل بالتوازي.

آخر تحديث: **2026-09-11 — Africa/Cairo — PR #65 stabilization/cleanup نشط على فرع تطوير منفصل**

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

- `main` HEAD الموثق = `93f72e50bf1ad2457cac9cc6b5d513a5c2f5ee6e`.
- هذا هو merge commit لـPR #64: `fix(inventory): multi-branch transfer and branch visibility (#64)`.
- PR #64 مدمج ومغلق.
- Verify main #1056 بعد الدمج: Full Green ✅.
- Deploy GitHub Pages #594: Success ✅.
- Migration الخاصة بـPR #64 **لم تُطبق على Production** وقت هذا التوثيق؛ لا تطبقها دون تحقق جديد وخطة نشر صريحة.
- لا تفترض أن هذا الـSHA ما زال الأحدث: يجب fetch قبل أي عمل جديد.

## 3) الدفعة النشطة — PR #65

- PR: `#65` — `stabilize: regression coverage before safe cleanup`
- State: **Open / Draft / غير مدمج**.
- Branch: `development/stabilization-cleanup`
- Base: `main@93f72e50...`
- آخر HEAD وظيفي قبل هذا التحديث: `2eae743cf5dc76bae117f1c22f63c2e075db464e`؛ commit تحديث هذا الملف يأتي بعده، لذلك اجلب HEAD الفعلي دائمًا.
- ممنوع الدمج قبل Full Verify Green على HEAD النهائي ومراجعة أي drift من `main`.

### ما تم إصلاحه في PR #65

1. **Mobile interaction regression**
   - إعادة إظهار `theme-toggle` على الهاتف بدل إخفائه.
   - إعادة إظهار زر المستخدم/الحساب على الهاتف مع إبقاء الـheader مضغوطًا.
   - Browser Smoke بقي صارمًا ولم يتم تخفيف الاختبار لإخفاء الفشل.

2. **Product manufactured-unit edit contract**
   - تعديل المنتج يحفظ روابط المصنعات في `product_unit_links` بدل الاعتماد التشغيلي على `product_components` القديم.
   - الإضافة/الحذف/تعديل الكمية تعمل على العقد الحديث نفسه.
   - أزيل الاستنتاج الوهمي لمصنع باسم المنتج.
   - المسار الحديث لا يمسح `product_components` القديم بلا داعٍ.

3. **Import branch safety**
   - الاستيراد لا يختار `branches[0]` عشوائيًا.
   - يجب تحديد الفرع بوضوح بدل fallback قد يكتب في فرع غير مقصود.

4. **Dining areas / tables incomplete setup UX**
   - إذا لم توجد أي `dining_areas` للفرع، شاشة اختيار الطاولة تعرض حالة واضحة: إعداد الصالات غير مكتمل.
   - لا يتم عرض الطاولة المنفردة وكأن إعداد الصالات سليم عندما لا توجد أي صالة.
   - إذا لم توجد طاولات أصلًا، درج الطاولات يعرض أن إعداد الصالات/الطاولات للفرع غير مكتمل بدل رسالة بحث فارغة مضللة.
   - إذا كانت هناك طاولات لكن البحث/الفلتر لا يطابق شيئًا، تبقى رسالة البحث منفصلة.
   - لا يتم إنشاء مناطق أو طاولات تلقائيًا، ولا اختراع بيانات Production.

## 4) Production findings — read-only فقط

تمت القراءة من Production `azzdesuowpdcoflmyezn` للتحقق من البلاغات، بدون تعديل بيانات التشغيل:

### Super Admin

- Super Admin النشط: `john_s`.
- `auth.users` و`public.users` متطابقان على نفس User UUID، والحساب نشط.
- username lookup يعمل ويصل إلى هوية Auth الصحيحة.
- **فرع سموحة معيّن بالفعل لـ`john_s` كـprimary branch في `public.users.branch_id`.**
- **سموحة موجودة بالفعل في `public.user_branch_access` لنفس المستخدم.**
- لذلك لم يتم تنفيذ UPDATE/INSERT مكرر على Production لتعيين سموحة؛ المطلوب كان محققًا مسبقًا وتم التحقق منه فقط.

### Dining data

- فرع كليوباترا: 0 مناطق / 0 طاولات وقت الفحص.
- فرع نادي سموحة: 0 مناطق / طاولة نشطة واحدة وقت الفحص.
- هذه فجوة بيانات/إعداد حقيقية وليست مجرد فلتر واجهة.
- لا تُنشئ مناطق أو طاولات افتراضية دون بيانات تشغيل صريحة من المستخدم.

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
- لا ادعاء Physical Print success إلا بعد اختبار فعلي على جهاز/تعريف الطابعة.

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

## 7) حالة التحقق الحالية لـPR #65

- Runs السابقة أثبتت أن Verify + DB/RLS كانت خضراء، بينما Browser Smoke كشف تدريجيًا عناصر الهاتف المخفية؛ تم إصلاح السبب بدل تخفيف الاختبار.
- بعد إصلاح المصنعات وإعداد الطاولات/الصالات، يجب اعتماد **أحدث run فقط** الذي يطابق HEAD النهائي.
- عند تحديث هذا السجل، run `Verify main #1068` على functional HEAD `2eae743c...` كان قد بدأ ولم تكن النتيجة النهائية قد صدرت بعد.
- commit توثيق هذا الملف سيُنتج HEAD أحدث؛ لذلك لا تعتبر #1068 وحده دليل الدمج النهائي إذا لم يطابق HEAD النهائي.

## 8) NEXT ACTION — إلزامي

1. اجلب HEAD الحالي لـPR #65 بعد هذا التوثيق.
2. تابع/تحقق من GitHub Actions للـHEAD النهائي فقط.
3. يجب أن تكون Verify + DB/schema/Integration/Security/RLS + Browser Smoke كلها Green.
4. إذا ظهر فشل، أصلح السبب الحقيقي على نفس فرع التطوير، ولا تخفف الاختبار/RLS.
5. أبقِ PR #65 Draft وغير مدمج إلى أن يكتمل Full Verify Green.
6. لا تشغّل أي Production migration بسبب هذه الدفعة؛ تغييرات الطاولات الحالية UX فقط.
7. بعد Full Green، حدّث هذا السجل بنتيجة run النهائية والـSHA ثم انتظر توجيه المستخدم الصريح بالدمج.

لا تلمس أي مستودع أو قاعدة بيانات أخرى.
