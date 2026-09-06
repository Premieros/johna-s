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
- Current Production code baseline: `main@9f69a67c596609c71420b1190e77e702a5029f1e` بعد PR #27.
- GitHub Pages Deploy #558 على نفس SHA: PASS ✅.
- Verify main #781 / run `34026096066`: PASS كامل ✅ بما فيه Fresh DB، Integration/Security/RLS، وBrowser Smoke.
- Permission-First Root Closure: **مغلق ✅**.
- Super Admin فقط يملك implicit full-access.
- `owner`, `manager`, وكل الأدوار الأخرى = Labels فقط؛ التفويض من canonical permissions + branch/RLS.

### P0-B المغلق على Production ✅

1. Anonymous login SECURITY DEFINER boundary مغلق.
2. Permission/scope hardening مغلق لـ`update_branch`, `deactivate_branch`, `get_cost_history`, `get_production_variance`.
3. `next_document_number(text)` أصبح internal-only boundary ومطبق على Production.
4. `cancel_sent_order_item(...)` wrapper مغلق بالكامل:
   - PR #27 merged إلى `main`.
   - migration `20260906115500_cancel_sent_order_item_wrapper_scope.sql` مطبقة على Production.
   - `search_path = public, pg_temp` ✅
   - `anon EXECUTE = false` ✅
   - authenticated/service-role grants محفوظة ✅
   - Authentication + active-user + branch guard تسبق sent-item lookup ✅

## 2) الحزمة النشطة الآن — PR #28 🚧

العنوان: `security: scope product modifier resolution by branch`

Production inspection أثبت أن `resolve_product_modifiers(uuid, uuid, jsonb)` هو `SECURITY DEFINER` ومتاح لـ`authenticated`، لكنه كان يبدأ product/modifier lookup اعتمادًا على `p_branch_id` الذي يرسله caller بدون إثبات current-user branch access.

الحل الموجود في PR #28:
- migration `20260906130000_resolve_product_modifiers_scope.sql`.
- `auth.uid()` أولًا.
- active application user مطلوب.
- `user_may_access_branch(p_branch_id)` مطلوب قبل أي product/modifier lookup.
- الحفاظ على modifier validation/pricing/snapshots والـRPC signature.
- الحفاظ على authenticated/service-role grants مع منع anon.
- regression جديد: `tests/integration/resolve_product_modifiers_security.test.ts`.
- existing modifier lifecycle integration test يبقى Operational regression gate لضمان عدم كسر POS/KDS/payment/inventory.

الحالة: PR #28 مفتوح، Verify #782 بدأ. **ممنوع Production DDL لهذه الحزمة قبل Full Green + Merge إلى main.**

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

1. `resolve_product_modifiers(...)` — PR #28 ACTIVE.
2. `seed_demo_data` / `delete_demo_data` — Production مثبت أنهما ما زالا يستخدمان `is_pos_admin()` / `is_branch_manager()` و`search_path=public`؛ يجب تحويلهما Permission-First واختيار capability canonical بعد مراجعة الاستخدام.
3. Costing/detail/admin/Super Admin RPCs المتبقية — Function-by-Function فقط.

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

1. إكمال Verify #782 لـPR #28 وإصلاح أي Regression حقيقي بدون تخفيف الاختبارات.
2. إذا Full Green: Merge PR #28 -> Sync `development/final-handover` -> تطبيق migration على Production -> read-only parity verification.
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
