# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف فقط.
> الملفات القديمة الخاصة بالـBug Register / Remaining Stages / Handover / Post-Repair أصبحت مراجع تاريخية فقط ولا تُستخدم لتحديد الحالة الحالية.

آخر تحديث: **2026-09-08 — Africa/Cairo**

## 1) الهوية الثابتة — غير قابلة للخلط

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Permanent development branch: `development/final-handover`
- Published site: `https://premieros.github.io/johna-s/`
- ممنوع استخدام `pos.v2`
- ممنوع استخدام Supabase `scpovyrqmsbiduanykod`
- ممنوع Force Push
- ممنوع تعديل `main` مباشرة
- ممنوع Production DDL/Migration قبل Full Verify
- ممنوع تخفيف RLS أو الاختبارات لتمرير CI
- Super Admin فقط implicit bypass
- كل الأدوار الأخرى Labels فقط؛ Authorization = Permission-First + canonical branch/RLS

## 2) الحالة الموثقة الآن

### Verified Production baseline

- Verified `main`: `11995374297af83af2b4e72b31ea47df5b40ebf2`
- PR #49: `docs: consolidate project status into one source of truth` ✅
- Verify main #890 / run `34158873521`: Full Green ✅
  - Frontend/API contract ✅
  - lint/typecheck/unit/build ✅
  - Fresh DB migrations ✅
  - Schema verification ✅
  - Integration/Security/RLS ✅
  - Browser Smoke ✅
- Deploy #580 / run `34158873516`: Build ✅ + Production parity ✅ + GitHub Pages deploy ✅
- Production DB: `azzdesuowpdcoflmyezn` متطابقة مع عقد `main` الموثق ✅
- `main` و`development/final-handover` كانا identical عند baseline أعلاه قبل حزمة Documentation الخاصة بالتسليم.
- Final handover package: `docs/FINAL_HANDOVER_2026-09-08.md` على فرع التطوير.

### الحالة التشغيلية

لا يوجد حاليًا Runtime/POS defect مؤكد يحتاج تعديل كود.

**حالة التسليم:**
- Application/runtime: **READY** ✅
- Platform administration: **2 settings pending** ⚠️

لا يتم وصف الإصدار بأنه Final 100% قبل إغلاق `AUTH-001` و`RELEASE-001` فعليًا.

تم إيقاف الفحص الواسع المفتوح. من الآن لا نعيد اختبار كل المشروع أو نفتح مرحلة طويلة بدون Regression مثبت.

**أسلوب العمل المعتمد:**

`Bug فعلي / Regression مثبت → Root Cause → إصلاح صغير صحيح → Regression test → Full Verify → Merge → Production parity عند الحاجة → Deploy`

أي شيء أخضر أو مغلق لا يُعاد فتحه لمجرد الشك.

## 3) الانحرافات المؤكدة المتبقية فقط — عددها 2

### AUTH-001 — Leaked Password Protection disabled

- Production Security Advisor أكد أن Supabase Auth `Leaked Password Protection` ما زالت Disabled.
- هذه Project/Auth Setting وليست Runtime code defect.
- الأداة المتصلة لا توفر Auth settings write action.

الإغلاق يتطلب:
1. تفعيل Prevent use of leaked passwords على مشروع `azzdesuowpdcoflmyezn`.
2. Smoke سريع فقط لـLogin / Create User / Password Update / Reset حسب المسارات المستخدمة فعليًا.
3. إعادة Security Advisor والتأكد من اختفاء التحذير.

لا يتم ادعاء الإغلاق قبل تعديل الإعداد الحقيقي.

### RELEASE-001 — `main` غير محمي

- `main` حاليًا `protected=false`.
- لا توجد Required Checks مفروضة على مستوى branch/ruleset.
- هذه Release-governance issue وليست Runtime application bug.
- اتصال GitHub الحالي لا يوفر Administration write لإعداد Branch Protection.

الإغلاق يتطلب:
1. تفعيل حماية `main` من Repository Settings / Rulesets.
2. فرض checks المناسبة قبل الدمج، على الأقل Verify/DB/Browser Smoke أو الـworkflow المكافئ المعتمد.
3. إعادة قراءة حالة الفرع/ruleset والتأكد أن الحماية فعالة.

لا يتم ادعاء الإغلاق إذا لم تتوفر صلاحية Admin فعلية.

## 4) العقود المغلقة — لا تُفتح بدون Regression مثبت

- Users / Roles / Permission-First ✅
- Shared Branch Shift — PR #30 ✅
- POS Discount / Payment / Order Completion — PR #31 ✅
- Warehouse transfer isolation — PR #35 ✅
- Controlled branch delete — PR #36 ✅
- Warehouse lifecycle — PR #37 ✅
- `close_shift` Permission-First — PR #38 ✅
- Admin SECURITY DEFINER hardening — PR #39 ✅
- Identity hardening — PR #40 ✅
- Subscription admin/tenant/security batches — PR #41–#44 ✅
- Inventory unit production Permission-First/branch/warehouse — PR #45 ✅
- SECURITY DEFINER legacy search-path zero closure — PR #46 ✅
- Shift cash integrity + branch scope — PR #47 ✅
- POS operator ownership + controlled operator transfer — PR #48 ✅
- Unified project status log — PR #49 ✅

### عقد PR #48 المحمي

1. Shared shift per branch.
2. New Order ownership = `auth.uid()`.
3. ordinary caller cannot spoof another cashier.
4. owner-only normal order/table operation subject to exact permission.
5. same-branch peer يرى occupied + narrow operator label فقط.
6. operator transfer requires `pos.order.transfer`, never role name.
7. same-branch validation fail-closed.
8. transfer audit = old owner + new owner + actor + timestamp.
9. direct DML/RPC fallback bypasses fail closed.
10. KDS/payment attribution remains tied to actual executor.
11. shared-shift sale attribution محفوظ بدون duplicate shift operation.

Production migrations الخاصة بالإغلاق:
- `20260907194314_pos_operator_ownership`
- `20260907194337_pos_kitchen_send_ownership`
- `20260907194427_pos_operator_rpc_ownership_hardening`
- `20260907194454_pos_sale_shift_attribution`

## 5) قواعد الإصلاح بعد التسليم

1. لا Full-project audit متكرر.
2. لا Bug جديد يدخل السجل إلا مع reproduction أو direct contract proof.
3. نصلح Root Cause وليس الأعراض.
4. Batch صغيرة لكل سبب.
5. قبل كل WRITE: re-fetch `main` و`development/final-handover` ومراجعة أي عمل متوازٍ.
6. لا Force Push.
7. لا Production migration قبل Full Verify.
8. لا تغيير صلاحيات أو RLS لتسهيل الاختبارات.
9. لا role-name authorization خارج Super Admin implicit bypass.
10. Published site لا يعتبر صحيحًا إلا إذا كان من Verified Main وبـProduction contract مطابق.

## 6) Definition of Done لأي إصلاح كود/DB جديد

`Regression proof → frontend gates → Fresh DB → Schema → Integration/Security/RLS → Browser Smoke → Merge → Production migration/parity عند الحاجة → Production Post-Check → merged-main Verify → Deploy`

الهدف النهائي دائمًا:

**Published Site = Verified Main = Production DB Contract = Zero Drift**

## 7) التطويرات المستقبلية — مؤجلة وليست Bugs حالية

لا تبدأ إلا بطلب صريح بعد استقرار التشغيل، ولا تعتبر “متبقي تسليم”. الترتيب المرجعي:

1. POS Permission Matrix finalization.
2. Table lifecycle.
3. POS concurrency/idempotency.
4. KDS final contract.
5. Inventory + Cost end-to-end.
6. Guided Routing.
7. Operational Alerts.
8. Printing professionalization.
9. Offline/Reconciliation.
10. Unified Audit Center.
11. Reports finalization.
12. UX/RTL/LTR/mobile polish.
13. Security/Release completion.

## 8) ما المطلوب الآن فعليًا للتسليم النهائي

لا يوجد Repair batch كودي نشط.

المتبقي المؤكد فقط:
- `AUTH-001` — يحتاج Supabase Auth setting فعلي.
- `RELEASE-001` — يحتاج GitHub repository-admin setting فعلي.

بعد إغلاقهما وإعادة التحقق يصبح المشروع صالحًا لوصف **Final 100% / Zero Drift release acceptance**.

إذا ظهر Bug تشغيلي جديد من الاستخدام الحقيقي، يتم تسجيله هنا فقط بعد إثباته ثم إصلاحه مباشرة.

## 9) حزمة التسليم

الملف التنفيذي للتسليم:
- `docs/FINAL_HANDOVER_2026-09-08.md`

يحتوي:
- الهوية الثابتة
- verified baseline
- closed contracts
- المتبقي الإداري
- أوامر التشغيل المحلية
- procedure لأي تغيير Production لاحق
- شروط قبول التسليم النهائي

## 10) سياسة السجلات

هذا الملف `docs/CURRENT_WORK_PLAN.md` هو **المرجع الحي الوحيد**.

الملفات التالية Legacy pointers فقط ويمنع تحديث حالة المشروع فيها بشكل مستقل:
- `docs/FINAL_BUG_REGISTER.md`
- `docs/FINAL_REMAINING_STAGES.md`
- `docs/HANDOVER_CHECKPOINT_2026-09-06.md`
- `docs/POST_REPAIR_DEVELOPMENT_PLAN.md`

أي تحديث مستقبلي للحالة أو Bug أو خطة تنفيذ يتم هنا فقط.

## 11) ملاحظة تنظيف مستودع غير تشغيلية

تم إنشاء branch مؤقت بالخطأ أثناء تجهيز التسليم باسم `handover/final-delivery-20260908`. لا يُستخدم نهائيًا ولا يحمل تغييرات. اتصال GitHub الحالي لا يوفر delete-ref action؛ احذفه عند توفر صلاحية/أداة مناسبة. الفرع المعتمد الوحيد للتطوير يبقى `development/final-handover`.
