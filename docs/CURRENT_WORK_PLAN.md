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
- Current Production code baseline بعد PR #26: `main@8a68e153d96e0e1e01f0bd0c07637ff470512c15`.
- Permission-First Root Closure: **مغلق ✅**.
- Super Admin فقط يملك implicit full-access.
- `owner`, `manager`, وكل الأدوار الأخرى = Labels فقط؛ التفويض من canonical permissions + branch/RLS.

### P0-B المغلق على Production ✅

1. Anonymous login SECURITY DEFINER boundary مغلق.
2. Permission/scope hardening مغلق لـ:
   - `update_branch`
   - `deactivate_branch`
   - `get_cost_history`
   - `get_production_variance`
3. `next_document_number(text)` أصبح internal-only boundary:
   - PR #26 مدمج إلى `main`.
   - migration `20260905230000_next_document_number_internal_only.sql` مطبقة على Production.
   - `anon EXECUTE = false` ✅
   - `authenticated EXECUTE = false` ✅
   - `service_role EXECUTE = true` ✅
   - `search_path = public, pg_temp` ✅

## 2) الحزمة النشطة الآن — PR #27 🚧

العنوان: `security: harden sent item cancel wrapper scope`

الهدف:
- منع `cancel_sent_order_item(...)` من كشف وجود/تعدد sent items قبل Authentication وBranch Authorization.
- الحفاظ على public RPC signature والسلوك النهائي عبر `cancel_sent_order_item_exact(...)`.

### Verify #778

- Database Identity Lock ✅
- API Contract ✅
- lint ✅
- typecheck app/tests ✅
- unit ✅
- build ✅
- Fresh DB migrations ✅
- schema verification ✅
- Regression test الجديد نفسه ✅
- Integration/Security/RLS ❌ بسبب خطأ SQL branch-only: `min(uuid)` غير مدعوم في PostgreSQL 16.
- بقية 5 failures كانت cascade بعد abort للـtransaction.
- Browser Smoke لم يبدأ بسبب فشل db gate.
- **لم يتم دمج PR #27 ولم يتم تطبيق migration الخاصة به على Production.**

تم تصحيح السبب باستخدام `count(*)` ثم SELECT منفصل لـ`order_item_id` بدون تغيير منطق الحماية. المطلوب الآن إعادة Full Verify للحزمة.

## 3) هدف العمل النهائي — Zero Drift للموقع المنشور

لا نعتبر أي انحراف مغلقًا لمجرد إصلاحه على فرع تطوير. الانحراف يغلق فقط عندما يتحقق الآتي:

1. الإصلاح موجود على `development/final-handover` مع regression coverage.
2. Verify كامل أخضر: frontend + Fresh DB/schema + Integration/Security/RLS + Browser Smoke.
3. Merge إلى `main`.
4. أي migration مطلوبة تطبق على `azzdesuowpdcoflmyezn` فقط.
5. Production read-only verification يثبت parity.
6. الموقع المنشور يتم نشره من آخر `main` verified.
7. Runtime smoke على النسخة المنشورة يثبت عدم وجود regression.

الهدف النهائي: **Published Site = Verified Main = Production DB Contract = Zero Drift**.

## 4) الانحرافات المتبقية — ترتيب الإغلاق الإلزامي

### P0-B — SECURITY DEFINER Remaining Audit 🔴

1. `cancel_sent_order_item(...)` wrapper — PR #27 ACTIVE.
2. `resolve_product_modifiers(...)` — التحقق من current-user branch access وإغلاق أي cross-branch oracle مثبت.
3. `seed_demo_data` / `delete_demo_data` — مقارنة Production بالتعريف canonical وإزالة أي role-name authorization قديم إذا كان ما زال live.
4. Costing/detail/admin/Super Admin RPCs المتبقية — Function-by-Function فقط.

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

1. إعادة Verify لـPR #27 بعد إصلاح PostgreSQL `min(uuid)`.
2. إذا أخضر: Merge PR #27 -> تطبيق migration على Production -> read-only verification.
3. Audit/Fix `resolve_product_modifiers`.
4. Audit/Fix `seed_demo_data` / `delete_demo_data` إذا ثبت drift.
5. إغلاق بقية SECURITY DEFINER confirmed gaps Function-by-Function.
6. P0-C Leaked Password Protection أو توثيق القيد الخارجي.
7. Full Verify نهائي.
8. Published Runtime/UI Zero-Drift audit وإصلاح regressions المثبتة فقط.
9. Production parity + Deploy النهائي من verified `main`.
10. Runtime operational smoke كامل.
11. Protect `main` إن أمكن.
12. `HANDOVER.md` + Final Zero-Drift report.
13. تنظيف الفروع التاريخية وترك `main` + `development/final-handover` فقط كفروع دائمة.

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
