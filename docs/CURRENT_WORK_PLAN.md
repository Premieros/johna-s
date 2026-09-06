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

- Latest verified security code baseline: `3aa2ae907bc64ffd73bf1ca024ac7afc9c38beb1`.
- آخر `main` قبل تحديث هذا السجل: `5bc8d78839f17d66f7bb6dddacb9ead4a16e7b75` (توثيق فقط فوق الـsecurity baseline).
- Production DB: `azzdesuowpdcoflmyezn` فقط.
- Permission-First Root Closure: **مغلق ✅**.
- Super Admin فقط يملك implicit full-access.
- `owner`, `manager`, وكل الأدوار الأخرى = Labels فقط؛ التفويض من `roles.permissions` + branch/RLS.
- Verify #751 على آخر حزمة P0-B: **PASS كامل ✅**:
  - Database Identity Lock ✅
  - API Contract ✅
  - lint ✅
  - typecheck app/tests ✅
  - unit ✅
  - build ✅
  - Fresh DB + canonical migrations ✅
  - schema verification ✅
  - Integration/Security/RLS ✅
  - Browser Smoke ✅
- PR #25 تم دمجه، وmigration `20260905224500_security_definer_permission_scope.sql` طُبق على Production بنجاح.

## 2) ما تم إغلاقه أمنيًا ✅

### P0-A — Permission-First Root Closure
مغلق بالكامل على `main`.

### P0-B — SECURITY DEFINER (الدفعات المغلقة)

1. Anonymous login boundary مغلق:
   - `public.get_login_email(text)` أصبح wrapper `SECURITY INVOKER`.
   - `public.record_login_failure(text)` أصبح wrapper `SECURITY INVOKER`.
   - التنفيذ المميز انتقل إلى `app_private`.
   - تحذيرا anon SECURITY DEFINER اختفيا من Security Advisor.
2. Permission/scope hardening مغلق للوظائف:
   - `update_branch`
   - `deactivate_branch`
   - `get_cost_history`
   - `get_production_variance`
3. `branches.manage` مستخدمة لإدارة الفروع.
4. `reports.costing` مستخدمة لقراءات التكلفة مع `user_may_access_branch`.
5. لا يوجد bypass لدور `owner` أو أي Role آخر.
6. لم يتم تعطيل أو تخفيف RLS أو الاختبارات لإمرار CI.

السجل الأمني التفصيلي:
`docs/SECURITY_DEFINER_AUDIT_2026-09-06.md`

## 3) العمل المفتوح قبل التسليم النهائي

### P0-B — SECURITY DEFINER Remaining Audit 🔴

لا نحاول إسكات Security Advisor بعمليات revoke جماعية؛ تحذيرات `authenticated SECURITY DEFINER` قد تكون RPCs تشغيلية مقصودة. التدقيق يستمر Function-by-Function.

الأولوية التالية:
- `next_document_number`
- `cancel_sent_order_item` wrapper
- `resolve_product_modifiers`
- `seed_demo_data` / `delete_demo_data` وأي Role-based drift متبقٍ
- Costing/detail RPCs المتبقية
- Admin/Super Admin RPC grants + internal guards

Definition of Done:
- كل external SECURITY DEFINER إما مقصود وموثق ومختبر أو مغلق/منقول إلى schema داخلي.
- لا privileged helper exposed بلا حاجة.
- لا cross-branch information oracle.

### P0-C — Auth Password Hardening 🔴

Security Advisor ما زال يسجل:
`Leaked Password Protection Disabled`.

المطلوب:
1. تفعيل Leaked Password Protection من Supabase Auth إذا كانت الخطة الحالية تسمح.
2. اختبار Login/Create User/Password Update.
3. إعادة Advisor.

إذا تعذر من أداة الاتصال الحالية، يوثق كخطوة Dashboard/Admin خارجية ولا ندعي أنها مكتملة.

### P1 — Handover Safety 🟠

1. Protect `main` مع required checks إن سمحت صلاحيات GitHub Admin:
   - verify
   - db
   - browser-smoke
2. Full Verify نهائي بعد آخر P0 commit.
3. Production parity / Deploy النهائي.
4. Runtime smoke مختصر:
   - Login
   - POS order
   - Send to Kitchen
   - Payment
   - Inventory effect
   - Shift close
5. Final Zero-Drift / Handover report.

## 4) تنظيم الفروع — قاعدة العمل الجديدة

من الآن:

- `main` = Production / Release فقط.
- فرع التطوير الدائم الوحيد: **`development/final-handover`**.
- أي fix branch قصير العمر يجوز إنشاؤه عند الحاجة فقط، ثم يجب حذفه بعد الدمج.
- ممنوع استمرار أكثر من فرع تطوير دائم واحد.
- ممنوع Force Push أو إعادة كتابة تاريخ `main`.
- قبل أي تعديل موجود: refetch آخر file SHA/branch HEAD للحفاظ على عمل أي نموذج آخر.
- عند 409: refetch + merge intent، ولا overwrite.

### تنظيف الفروع

الهدف النهائي للمستودع:
- `main`
- `development/final-handover`

فقط كفروع دائمة.

الفروع التاريخية/المندمجة/المستبدلة يجب حذفها من GitHub بعد التأكد من عدم وجود عمل فريد غير مدمج. إذا لم تسمح أداة GitHub الحالية بحذف branch، تبقى العملية Admin cleanup يدوية ولا يتم استخدام هذه الفروع في أي تطوير جديد.

## 5) قواعد غير قابلة للتفاوض

1. المشروع لا يتصل إلا بـ`azzdesuowpdcoflmyezn`.
2. Super Admin فقط implicit bypass.
3. الصلاحيات هي أساس التفويض؛ الأدوار Labels.
4. لا Legacy permission aliases جديدة.
5. لا weakening لـRLS أو tests.
6. لا Production DDL من branch غير مجتاز للـCI.
7. لا Merge قبل Fresh DB + Integration/Security/RLS + Browser Smoke.
8. Guided Routing يفضل على raw DB/RLS errors في خطوات الإعداد الإلزامية.
9. أي تعديل تشغيلي يجب أن يحدث عبر RPC/event موثق لا mutation جانبي غير متتبع.
10. توثيق السجل إلزامي لكل دفعة عمل.

## 6) ترتيب التنفيذ من الآن

1. استكمال P0-B Function-by-Function.
2. P0-C Leaked Password Protection.
3. Full Verify نهائي.
4. Protect `main` إن أمكن.
5. Runtime operational smoke.
6. Zero-Drift + `HANDOVER.md` نهائي.
7. تنظيف فروع GitHub القديمة وترك فرع تطوير دائم واحد فقط.

## 7) معيار إعلان "جاهز للتسليم"

لا يعلن المشروع Production-handover-ready إلا بعد:

- P0-A ✅
- P0-B confirmed gaps مغلقة أو موثقة كمقصودة ومختبرة ✅
- P0-C مغلق أو موثق كقيد منصة صريح ✅
- Full Verify ✅
- Fresh DB + Integration/Security/RLS ✅
- Browser Smoke ✅
- Production parity/deploy ✅
- Runtime smoke للدورة الأساسية ✅
- `main` protection أو توثيق عدم توفر صلاحية الإدارة ✅
- branch workflow منظم ✅
- Final Handover + Zero-Drift docs ✅
