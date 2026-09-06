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
- Current Production code baseline: `main@dd3d374b48dd0e4a62506044145453eb859c57e1` بعد إغلاق POS Discount / Payment / Order Completion controls.
- Permission-First Root Closure: **مغلق ✅**.
- Super Admin فقط يملك implicit full-access.
- `owner`, `manager`, وكل الأدوار الأخرى = Labels فقط؛ التفويض من canonical permissions + branch/RLS.

### P0-B المغلق على Production ✅

1. Anonymous login SECURITY DEFINER boundary مغلق.
2. Permission/scope hardening مغلق لـ`update_branch`, `deactivate_branch`, `get_cost_history`, `get_production_variance`.
3. `next_document_number(text)` أصبح internal-only boundary ومطبق على Production.
4. `cancel_sent_order_item(...)` wrapper مغلق بالكامل.
5. `resolve_product_modifiers(uuid, uuid, jsonb)` أصبح branch-scoped ومغلق من cross-branch lookup.

## 2) آخر الحزم التشغيلية المغلقة ✅

### Purchase + POS Stock Regression — PR #29 ✅

تم إغلاق الانحرافات التالية على `main` وProduction:

1. **فاتورة المشتريات:**
   - لم يعد Frontend يستدعي generic `next_document_number('purchase')` غير المسموح مباشرة.
   - `next_purchase_document_number(p_type)` هو الـwrapper المحمي بـ`purchases.manage`.

2. **رصيد POS / Availability:**
   - `check_product_availability` أصبح duplicate-safe لكل مصادر recipe/unit UPSERT باستخدام `GROUP BY` + `SUM` قبل `ON CONFLICT`.
   - خطأ PostgreSQL `21000` الذي كان يمسح stock map بالكامل لم يعد يحدث مع recipe duplicates مثل `Johnas Omelate`.

3. **ترقيم البيع:**
   - `next_sale_document_number(p_type)` محمي بـ`pos.payment.take`.
   - Online numbering fail-closed ولا يوجد fallback عشوائي للرقم المالي.

### Shared Branch Shift — PR #30 ✅

طلب التشغيل النهائي: **كل كاشير في نفس الفرع يعمل على نفس الشفت المفتوح**.

العقد المطبق:

1. الشفت المفتوح أصبح **Branch-Scoped** وليس Cashier-Scoped.
2. `shifts.cashier_id` يبقى هو فاتح الشفت لأغراض Audit فقط، وليس مالكًا حصريًا للشفت.
3. كل كاشير مخول لنفس الفرع يحصل من `get_active_shift(branch_id)` على نفس `shift_id`.
4. استدعاء `open_shift` من كاشير ثانٍ في نفس الفرع يعيد نفس الشفت مع `shared=true` و`already_open=true` بدل إنشاء شفت آخر.
5. البيع والمرتجع يسجلان على شفت الفرع بدون شرط `cashier_id = auth.uid()` على الشفت.
6. نسبة العملية للكاشير لا تضيع:
   - البيع يحتفظ بـ`sales.cashier_id`.
   - حركة الشفت تحتفظ بـ`shift_operations.created_by`.
7. قاعدة البيانات تمنع أكثر من شفت مفتوح لنفس الفرع بواسطة:
   - generated guard `open_branch_guard`.
   - constraint `uq_shifts_one_open_per_branch_deferred` = `UNIQUE(branch_id, open_branch_guard) DEFERRABLE INITIALLY DEFERRED`.
   - `open_shift` يستخدم transaction advisory lock للفرع لمنع race بين كاشيرين يفتحان في اللحظة نفسها.
8. أي legacy duplicate open shifts يتم reconciliation لها بدون حذف audit rows؛ العمليات تنتقل للشفت الأساسي مع بقاء `created_by`.
9. وقت تطبيق PR #30 على Production لم يكن هناك أي شفت مفتوح، لذلك لم يحدث أي دمج لبيانات تشغيل حية أثناء النشر.

التحقق:
- PR Verify #799: frontend ✅ / Fresh DB ✅ / Schema ✅ / Integration + Security/RLS ✅ / Browser Smoke ✅.
- Merge: `main@9cbd09eedf1e210088f317ed88f2443ba3d5bdeb`.
- Production migrations مطبقة على `azzdesuowpdcoflmyezn` ✅.
- Production post-check: لا يوجد `cashier_id = auth.uid()` في shift lookup داخل sale/refund cores ✅.
- Deploy GitHub Pages #561: ✅.

### POS Discount / Payment / Order Completion — PR #31 ✅

تمت مراجعة ضوابط الخصم وإغلاق الطلب من الواجهة إلى RPC ثم Production، وثبتت طرق التفاف قديمة وتم إغلاقها دون توسيع الصلاحيات أو تخفيف RLS/tests.

العقد النهائي المطبق:

1. **الدفع:**
   - `process_sale(...)` و`process_sale_split(...)` يطلبان `pos.payment.take` داخل RPC نفسها، وليس اعتمادًا على الواجهة فقط.
   - كلا المسارين يتحقق من `user_may_access_branch(p_branch_id)` قبل الكتابة المالية.

2. **الخصم:**
   - الخصم يتطلب `pos.discount`.
   - عند غياب الصلاحية، خصم مستوى الفاتورة يحتاج Manager Approval صالح ومطابق للفرع والمستخدم ونوع الخصم وقيمته وServer Subtotal، ثم يتم استهلاكه وتسجيله في Audit.
   - Split Tender أصبح يخضع لنفس ضوابط الخصم بدل وجود مسار أضعف.

3. **إغلاق الطلب:**
   - الطلب المرتبط لا يمكن إغلاقه بدفع جزئي؛ `process_sale` يعيد `FULL_PAYMENT_REQUIRED_TO_CLOSE_ORDER` إذا كان المدفوع أقل من المستحق.
   - Split Tender يطلب تطابق مجموع الدفعات تمامًا مع المستحق عبر `SPLIT_PAYMENT_TOTAL_MISMATCH`.
   - `set_order_status(...,'completed')` لا يغلق الطلب ماليًا؛ يعيد `COMPLETION_REQUIRES_PAYMENT`.
   - الحالة `completed` تصبح نتيجة لمسار Checkout المالي المضبوط فقط.

4. **حالة الدفع:**
   - `set_payment_status(uuid,text)` لم تعد executable لـ`PUBLIC`, `anon`, أو `authenticated`؛ بقيت `service_role` فقط.

5. **Cancel / Hold:**
   - الإلغاء يطلب `pos.cancel_order` صراحة.
   - `open/held` يطلبان `pos.hold` صراحة.
   - إلغاء طلب أرسل للمطبخ لا يتم بمجرد status flip؛ يعاد `SENT_ORDER_CANCEL_REQUIRES_CONTROLLED_VOID` حتى تتم معالجة sent items عبر المسار المراقب.
   - الإلغاء العادي يتطلب سببًا صالحًا ويكتب Audit.

التحقق:
- PR #31: `fix: harden POS discounts and order completion` ✅.
- Verify #805: frontend ✅ / lint ✅ / typecheck ✅ / unit ✅ / build ✅ / Fresh DB ✅ / Schema ✅ / Integration + Security/RLS ✅ / Browser Smoke ✅.
- Merge: `main@dd3d374b48dd0e4a62506044145453eb859c57e1` ✅.
- Production migrations مطبقة على `azzdesuowpdcoflmyezn` ✅.
- Production post-check:
  - `process_sale`: `pos.payment.take` + `pos.discount` + full settlement guard ✅.
  - `process_sale_split`: `pos.payment.take` + matching discount controls + exact tender total ✅.
  - `set_order_status`: direct completion blocked + `pos.cancel_order` + `pos.hold` + sent-order cancellation guard ✅.
  - `set_payment_status`: anon/authenticated EXECUTE = false؛ service_role = true ✅.
- `development/final-handover` تم Fast-Forward بعد الدمج إلى `dd3d374b48dd0e4a62506044145453eb859c57e1` بدون Force وبدون تعارض ✅.

قاعدة المتابعة: **لا يعاد فتح الخصم/الدفع/إغلاق الطلب إلا عند Regression مثبت جديد.**

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
3. أي `SECURITY DEFINER` يظهر أثناء العمل بـ`search_path=public` فقط يسجل كمرشح hardening ولا يعدل عشوائيًا بدون caller/regression review.

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
- Shared branch shift / shift close.
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
12. الشفت التشغيلي هو شفت فرع واحد مشترك؛ لا يعاد ربطه بمالك كاشير منفرد.
13. إغلاق الطلب المالي لا يتم عبر تغيير status يدوي؛ يتم فقط عبر checkout مضبوط ومكتمل الدفع.
14. الخصم والدفع يجب حمايتهما داخل RPC boundary، وليس في UI فقط.

## 6) ترتيب التنفيذ من الآن

1. عدم إعادة فتح Shared Branch Shift أو POS Discount/Payment/Order Completion بدون Regression مثبت.
2. Audit/Fix `seed_demo_data` / `delete_demo_data` Permission-First + search_path.
3. إغلاق بقية SECURITY DEFINER confirmed gaps Function-by-Function.
4. P0-C Leaked Password Protection أو توثيق القيد الخارجي.
5. Full Verify نهائي.
6. Published Runtime/UI Zero-Drift audit وإصلاح regressions المثبتة فقط.
7. Production parity + Deploy النهائي من verified `main`.
8. Runtime operational smoke كامل، ويشمل كاشيرين على نفس branch shift + Discount/Payment/Order Completion.
9. Protect `main` إن أمكن.
10. `HANDOVER.md` + Final Zero-Drift report.
11. تنظيف الفروع القصيرة/التاريخية وترك `main` + `development/final-handover` فقط كفروع دائمة.

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
