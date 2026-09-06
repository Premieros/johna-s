# CURRENT WORK PLAN — john-s

> **Source of Truth لأي نموذج أو مطور يكمل العمل. اقرأ هذا الملف أولًا.**
>
> Repository الوحيد: `Premieros/johna-s`
>
> Supabase Production الوحيد: `azzdesuowpdcoflmyezn`
>
> Database Identity Lock غير قابل للتجاوز. يمنع استخدام أي مشروع Supabase آخر مع هذا المستودع.

آخر تحديث: **2026-09-06 — Africa/Cairo**

## 1) الحالة الحالية

- Production/Release branch: `main`.
- فرع التطوير الدائم الوحيد: `development/final-handover`.
- Production DB: `azzdesuowpdcoflmyezn` فقط.
- Current Production code baseline: `main@605b526ff181cd2341e6b3397e90433da7e0e33c` بعد إغلاق scope الخاص بـ`resolve_product_modifiers`.
- Permission-First Root Closure: **مغلق ✅**.
- Super Admin فقط يملك implicit full-access.
- `owner`, `manager`, وكل الأدوار الأخرى = Labels فقط؛ التفويض من canonical permissions + branch/RLS.

### P0-B المغلق على Production ✅

1. Anonymous login SECURITY DEFINER boundary مغلق.
2. Permission/scope hardening مغلق لـ`update_branch`, `deactivate_branch`, `get_cost_history`, `get_production_variance`.
3. `next_document_number(text)` أصبح internal-only boundary ومطبق على Production.
4. `cancel_sent_order_item(...)` wrapper مغلق بالكامل.
5. `resolve_product_modifiers(uuid, uuid, jsonb)` أصبح branch-scoped ومغلق من cross-branch lookup.

## 2) الحزمة النشطة الآن — Purchase + POS Stock Regression 🚧

Regression مثبت على النسخة الحالية بعد hardening الأخير:

1. **إنشاء فاتورة المشتريات يتوقف قبل `process_purchase`:**
   - Frontend كان يستدعي `next_document_number('purchase')` مباشرة.
   - الدالة العامة أصبحت internal-only كما هو مقصود أمنيًا.
   - الإصلاح لا يعيد فتح الدالة العامة؛ تمت إضافة wrapper ضيق `next_purchase_document_number()` يطلب `purchases.manage` ثم يفوض للدالة الداخلية.

2. **الرصيد المتاح في POS يختفي بالكامل:**
   - `get_pos_product_availability` يسقط عندما تصل `check_product_availability` إلى recipe/component duplicate يكرر نفس conflict key داخل `INSERT ... ON CONFLICT` واحد.
   - Production أثبت duplicate recipe حقيقي في `Johnas Omelate`.
   - الإصلاح يجمع (`GROUP BY` + `SUM`) كل مصادر الـUPSERT المتشابهة قبل `ON CONFLICT`: product-unit links، direct raw recipe items، inventory-unit raw recipes، inventory-unit component recipes.
   - لا يتم حذف recipe rows أو تغيير إجمالي الكميات؛ الحساب يصبح duplicate-safe فقط.

3. **عطل مشابه تم اكتشافه أثناء العمل — ترقيم البيع:**
   - POS كان يستدعي generic `next_document_number('sale')`، ثم قد يولد رقمًا عشوائيًا Online عند فشل السيرفر.
   - تمت إضافة `next_sale_document_number()` المحمية بـ`pos.payment.take`.
   - Online numbering أصبح fail-closed؛ لا يوجد مصدر أرقام مالي ثانٍ من العميل.
   - Offline numbering يبقى منفصلًا بصيغة `INV-OFF-*` ضمن outbox الحالي.

ملفات الحزمة:
- `supabase/migrations/20260906144500_purchase_sale_numbering_and_pos_availability_regression.sql`
- `src/api/domains/trade.ts`
- `src/api/domains/pos.ts`
- `src/features/pos/services/payment.ts`

قواعد الحزمة:
- `next_document_number(text)` يبقى REVOKED من `PUBLIC`, `anon`, `authenticated`.
- لا weakening لـRLS أو permission-first.
- لا Production DDL قبل Full Green.
- لا Merge إلى `main` قبل Fresh DB + Integration/Security/RLS + Browser Smoke.

الحالة الحالية: **الكود موجود على `development/final-handover` فقط؛ مطلوب PR/Verify قبل أي Production action.**

## 3) هدف العمل النهائي — Zero Drift للموقع المنشور

لا نعتبر أي انحراف مغلقًا لمجرد إصلاحه على فرع تطوير. الانحراف يغلق فقط عندما يتحقق الآتي:

1. Regression coverage واضح.
2. Verify كامل أخضر: frontend + Fresh DB/schema + Integration/Security/RLS + Browser Smoke.
3. Merge إلى `main`.
4. أي migration مطلوبة تطبق على `azzdesuowpdcoflmyezn` فقط.
5. Production read-only verification يثبت parity.
6. الموقع المنشور يتم نشره من آخر `main` verified.
7. Runtime smoke على النسخة المنشورة يثبت عدم وجود regression.

الهدف النهائي: **Published Site = Verified Main = Production DB Contract = Zero Drift**.

## 4) الانحرافات المتبقية — ترتيب الإغلاق الإلزامي

### P0-B — SECURITY DEFINER Remaining Audit 🔴

1. `seed_demo_data` / `delete_demo_data` — Production مثبت أنهما ما زالا يستخدمان `is_pos_admin()` / `is_branch_manager()` و`search_path=public`؛ يجب تحويلهما Permission-First واختيار capability canonical بعد مراجعة الاستخدام.
2. Costing/detail/admin/Super Admin RPCs المتبقية — Function-by-Function فقط.

Definition of Done:
- كل external SECURITY DEFINER إما مقصود وموثق ومختبر أو مغلق/داخلي.
- لا privileged helper exposed بلا حاجة.
- لا cross-branch information oracle.
- لا role-name authorization خارج Super Admin implicit bypass.

### P0-C — Auth Password Hardening 🔴

Security Advisor ما زال يسجل `Leaked Password Protection Disabled`.

المطلوب:
1. تفعيل Leaked Password Protection من Supabase Auth إذا كانت الخطة الحالية تسمح.
2. اختبار Login/Create User/Password Update.
3. إعادة Advisor.

إذا تعذر من أداة الاتصال الحالية، يوثق كقيد Dashboard/Admin خارجي ولا يتم الادعاء بأنه مكتمل.

### P1-A — Published Runtime / UI Zero-Drift Audit 🟠

بعد إغلاق P0-B:
1. إعادة التحقق على الموقع المنشور الحالي من الدورة التشغيلية الفعلية.
2. عدم إعادة فتح أي UI item قديم بدون Regression مثبت.
3. الإصلاح فقط لما يظهر فعليًا على النسخة المنشورة.

النطاق الإلزامي:
- Login / bootstrap.
- POS create/edit order.
- Send to Kitchen / delta send.
- KDS visibility/status.
- Payment.
- Inventory effect وعدم double deduction.
- Sent-item void/approval.
- Tables occupancy/transfer/split where applicable.
- Shift close.
- Products/Recipes/Components/Costing runtime.
- Dialog usability Desktop/Mobile.
- RTL/LTR + navigation + stale dynamic import recovery.

### P1-B — Protect main 🟠

Protect `main` مع required checks إن سمحت صلاحيات GitHub Admin:
- verify
- db
- browser-smoke
- production parity/deploy gate عند الحاجة.

إذا لم تسمح صلاحيات الأداة، يوثق القيد ولا ندعي أن `main` Protected.

### P2 — Printing Finalization 🟡

بعد إغلاق P0/P1:
- تثبيت local printing contract.
- stations القياسية: cashier / kitchen / barista.
- fallback للصنف بلا station إلى kitchen مع Manager warning.
- first print / reprint / kitchen print تخضع للصلاحيات.

## 5) قواعد غير قابلة للتفاوض

1. المشروع لا يتصل إلا بـ`azzdesuowpdcoflmyezn`.
2. Super Admin فقط implicit bypass.
3. Permission-first؛ الأدوار Labels.
4. لا Legacy permission aliases جديدة.
5. لا weakening لـRLS أو tests.
6. لا Production DDL من branch غير مجتاز للـCI.
7. لا Merge قبل Fresh DB + Integration/Security/RLS + Browser Smoke.
8. Guided Routing يفضل على raw DB/RLS errors في خطوات الإعداد الإلزامية.
9. أي mutation تشغيلي يجب أن يكون عبر RPC/event موثق وقابل للتدقيق.
10. توثيق السجل إلزامي لكل دفعة عمل.
11. لا يعتبر الموقع Zero-Drift حتى يطابق آخر `main` verified وقاعدة Production الفعلية.

## 6) ترتيب التنفيذ من الآن

1. Verify حزمة Purchase/POS Stock regression الحالية وإصلاح أي Regression حقيقي بدون تخفيف الاختبارات.
2. إذا Full Green: Merge الحزمة -> Sync `development/final-handover` -> تطبيق migration على Production -> read-only parity verification -> runtime smoke للمشتريات وPOS stock/payment.
3. Audit/Fix `seed_demo_data` / `delete_demo_data` Permission-First + search_path.
4. إغلاق بقية SECURITY DEFINER confirmed gaps Function-by-Function.
5. P0-C Leaked Password Protection أو توثيق القيد الخارجي.
6. Full Verify نهائي.
7. Published Runtime/UI Zero-Drift audit وإصلاح regressions المثبتة فقط.
8. Production parity + Deploy النهائي من verified `main`.
9. Runtime operational smoke كامل.
10. Protect `main` إن أمكن.
11. `HANDOVER.md` + Final Zero-Drift report.
12. تنظيف الفروع القصيرة/التاريخية وترك `main` + `development/final-handover` فقط كفروع دائمة.

## 7) معيار إعلان "جاهز للتسليم"

لا يعلن المشروع Production-handover-ready إلا بعد:

- P0-A ✅
- P0-B confirmed gaps مغلقة أو موثقة كمقصودة ومختبرة ✅
- P0-C مغلق أو موثق كقيد منصة صريح ✅
- Full Verify ✅
- Fresh DB + Integration/Security/RLS ✅
- Browser Smoke ✅
- Production DB parity ✅
- Published site على آخر verified `main` ✅
- Runtime operational smoke ✅
- Runtime/UI regressions المثبتة = 0 ✅
- `main` protection أو توثيق عدم توفر صلاحية الإدارة ✅
- Final Handover + Zero-Drift docs ✅
