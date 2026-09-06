# FINAL REMAINING STAGES — Countdown to Handover

> هذا الملف هو عدّاد المراحل المتبقية حتى التسليم النهائي.
> Source of truth التفصيلي للأخطاء: `docs/FINAL_BUG_REGISTER.md`.
> أحدث حالة Production: `docs/HANDOVER_CHECKPOINT_2026-09-06.md`.

## الحالة الحالية
- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` فقط
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline: `main@80f5ed535e07cb3c839266e7e8d5dda5b3cd5f87` — PR #43.
- PR #43 Verify #852 ✅ / merged-main Verify #853 ✅ / Deploy #574 ✅.
- Production parity وPost-Check لآخر دفعة ✅.
- Current confirmed unique deviations: **74** حسب `FINAL_BUG_REGISTER.md`.

# المتبقي: 6 مراحل

## 6 → P0-B SECURITY DEFINER Remaining Audit — ACTIVE 🔴
الحصر الحالي:
- 162 SECURITY DEFINER callable للـauthenticated إجمالًا؛ هذا ليس عدد أخطاء.
- **71 دالة مؤكدة** ما زالت تستخدم legacy/unhardened search path بدل `public, pg_temp`.
- 50 منها mutation/operational/identity، و21 read/helper-like.
- الفحص الآلي الحالي لم يجد role-label authorization واضحًا (`owner`/`manager`/`branch_manager`) في المجموعة المتبقية.

طريقة الإصلاح:
- معالجة root cause بعناقيد مراجَعة، لا broad blind rewrite.
- إذا كان العيب search-path فقط: exact-signature `ALTER FUNCTION ... SET search_path TO public, pg_temp` بدون إعادة كتابة body.
- إذا ظهر auth/branch/tenant defect: Regression مستقل + migration ضيقة.
- لا تنخفض المرحلة من 6 إلى 5 إلا بعد وصول الانحرافات المؤكدة في P0-B إلى صفر والتحقق Production/CI.

## 5 → P0-C Auth Password Hardening 🔴
المؤكد حاليًا:
- Supabase Security Advisor: `Leaked Password Protection Disabled`.

الإغلاق يتطلب:
- تفعيل الحماية إذا سمحت المنصة/الخطة.
- اختبار Login / Create User / Password Update.
- إعادة Security Advisor.
- توثيق أي قيد منصة بدل ادعاء الإغلاق.

## 4 → P1-A Published Runtime / UI Zero-Drift Audit 🟠
لا توجد أخطاء Runtime محسوبة قبل إعادة إنتاجها.

الدورة المطلوبة:
- Login/bootstrap.
- فتح وردية ورصيد افتتاحي.
- POS create/edit + send to kitchen + KDS.
- Cash/Card + discounts/voids/returns.
- inventory effects وعدم double deduction.
- close shift + report + day-close/offline path حيث ينطبق.
- tables / transfer / split.
- products / recipes / components / costing.
- reports.
- Desktop/Mobile + RTL/LTR + navigation.

## 3 → P2 Printing Finalization 🟡
المؤكد حاليًا:
- `set_print_status(uuid,text)` ما زالت legacy `search_path=public`، وهي محسوبة بالفعل ضمن الـ71 وليست خطأ إضافيًا.

الإغلاق الوظيفي يتطلب:
- cashier/kitchen/barista stations.
- fallback station behavior.
- first print/reprint تحت صلاحيات واضحة.
- منع duplicate print غير المصرح به.
- طباعة تقارير إغلاق الورديات واليوم.

## 2 → Release Hardening / Protection / Final Gates 🟠
المؤكد حاليًا:
- `main` غير Protected / لا توجد required checks مفروضة على الفرع.

الإغلاق يتطلب:
- Full Verify نهائي.
- Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Production parity.
- verified-main deploy فقط.
- Runtime smoke كامل.
- تفعيل branch protection إن سمحت صلاحيات GitHub، أو توثيق القيد.

## 1 → Final Handover + Cleanup + Zero-Drift Report 🟢
الإغلاق يتطلب:
- `Published Site = Verified Main = Production DB Contract = Zero Drift`.
- تحديث checkpoint/HANDOVER النهائي.
- مزامنة السجلات وعدم ترك documentation drift.
- تنظيف الفروع التاريخية فقط بعد التأكد من عدم وجود عمل غير مدمج.
- إبقاء `main` و`development/final-handover` كفروع دائمة.

# قاعدة العدّ التنازلي
`6 → 5 → 4 → 3 → 2 → 1 → 0`

لا تنخفض مرحلة إلا بعد:
`Regression → Full Verify → Merge → Production migration/parity عند الحاجة → Post-Check → merged-main Verify → Deploy/Runtime verification`.

# قواعد الإصلاح والتنظيف
1. إصلاح الجذر الذي يزيل عدة أعراض متكررة أفضل من ترقيع كل عرض منفصل.
2. لا يتم جمع مشاكل مختلفة تحت تغيير واسع غير مبرر.
3. إزالة التكرار/التعليقات/الاختبارات القديمة داخل نطاق الإصلاح فقط.
4. لا broad refactor غير مرتبط.
5. لا حذف أو إضعاف RLS/tests.
6. Super Admin فقط implicit bypass؛ باقي الأدوار Labels.
7. قبل كل WRITE: إعادة جلب HEAD ومراجعة commits المتوازية.
8. لا force push.
9. لا Production DDL قبل Full Verify.
10. تحديث `FINAL_BUG_REGISTER.md` والـcheckpoint بعد كل batch مغلق.

# الحالة التالية مباشرة
**Remaining = 6**

العمل النشط: خفض **71** انحراف SECURITY DEFINER المتبقية بعناقيد root-cause آمنة ومراجَعة، مع حماية كل العقود المغلقة السابقة.
