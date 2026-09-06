# FINAL REMAINING STAGES — Countdown to Handover

> هذا الملف هو عدّاد المراحل المتبقية حتى التسليم النهائي.
> يُقرأ بعد `docs/CURRENT_WORK_PLAN.md` و`docs/HANDOVER_CHECKPOINT_2026-09-06.md`، ويُحدّث عند إغلاق كل مرحلة.

## الحالة الحالية

- Repository: `Premieros/johna-s`
- Production Supabase: `azzdesuowpdcoflmyezn` فقط
- Production branch: `main`
- Development branch: `development/final-handover`
- Verified Production baseline قبل PR #41: `main@9d8a2c248140930de3a77d8b0b1f83bbcd1ee879`
- PR #41: مفتوح / غير مدمج / غير مطبق على Production.
- آخر Verify للـPR #41: #844 — Frontend + Fresh DB + Schema ✅، Integration/Security/RLS ❌، Browser Smoke لم يبدأ.

# المتبقي: 6 مراحل

## 6 → P0-B SECURITY DEFINER Remaining Audit — ACTIVE 🔴

الهدف: إغلاق كل انحراف SECURITY DEFINER مؤكد Function-by-Function بدون bulk rewrite.

الحالي:
- إكمال تشخيص PR #41 وإصلاح Regression فقط.
- Subscription Admin functions: search-path/grants hardening مع الحفاظ على Super Admin contract.
- مراجعة runtime subscription helpers منفصلة، خصوصًا أي raw tenant-id/status oracle محتمل.
- مراجعة بقية الدوال الحساسة: auth / permission / branch scope / search_path / grants / callers.

لا تغلق المرحلة إلا عندما:
- لا يبقى external SECURITY DEFINER غير مبرر أو غير مختبر.
- لا role-name authorization خارج Super Admin implicit bypass.
- لا cross-branch / cross-tenant information oracle.
- Full Verify + merge + Production migration/post-check + Deploy/runtime parity كلها خضراء.

## 5 → P0-C Auth Password Hardening 🔴

الهدف:
- مراجعة `Leaked Password Protection Disabled`.
- تفعيله إذا كانت Supabase plan/tooling تسمح.
- اختبار Login / Create User / Password Update.
- إعادة Security Advisor.
- إذا كان الإجراء يحتاج Dashboard/Admin خارجيًا، يوثق بوضوح كقيد منصة ولا يدّعى إغلاقه تقنيًا.

## 4 → P1-A Published Runtime / UI Zero-Drift Audit 🟠

اختبار تشغيل فعلي للنسخة المنشورة، وليس static review فقط:
- Login / bootstrap.
- POS create/edit.
- Send to Kitchen / delta send / KDS.
- Payment / discount / completion.
- Inventory effects وعدم double deduction.
- sent-item void / approval.
- tables / transfer / split حيث ينطبق.
- shared branch shift + close shift.
- products / recipes / components / costing.
- Desktop + Mobile dialogs.
- RTL/LTR + navigation + stale dynamic import recovery.

يصلح فقط Regression مثبت على النسخة المنشورة.

## 3 → P2 Printing Finalization 🟡

الهدف:
- تثبيت local printing contract.
- stations القياسية: cashier / kitchen / barista.
- fallback للصنف بلا station إلى kitchen مع warning مناسب.
- first print / reprint / kitchen print تحت صلاحيات واضحة.
- اختبار عدم الطباعة المزدوجة ومسارات reprint/cancel المطلوبة.

## 2 → Release Hardening / Protection / Final Gates 🟠

الهدف:
- Full Verify نهائي.
- Fresh DB + Schema + Integration/Security/RLS + Browser Smoke.
- Production API/DB parity.
- Deploy من verified `main` فقط.
- Runtime operational smoke كامل.
- Protect `main` مع required checks إذا سمحت صلاحيات GitHub Admin؛ وإلا توثيق القيد صراحة.

## 1 → Final Handover + Cleanup + Zero-Drift Report 🟢

الهدف النهائي:
- `Published Site = Verified Main = Production DB Contract = Zero Drift`.
- تحديث `HANDOVER.md` / checkpoint النهائي.
- تقرير نهائي بما تم، القيود إن وجدت، ونتائج Verify/Deploy/Production post-check.
- تنظيف الفروع القصيرة/التاريخية بعد التأكد من عدم احتوائها على عمل غير مدمج؛ إبقاء `main` و`development/final-handover` كفروع دائمة فقط.
- إعلان Remaining Stages = 0 فقط بعد تحقق جميع بوابات التسليم.

# قاعدة العدّ التنازلي

- يبدأ العد الحالي من **6**.
- عند إغلاق مرحلة كاملة فقط ينخفض العداد: `6 → 5 → 4 → 3 → 2 → 1 → 0`.
- لا يتم خفض العداد لمجرد كتابة fix أو نجاح test جزئي.
- المرحلة تغلق فقط بعد بواباتها المطلوبة: Regression → Full Verify → Merge → Production parity/migration عند الحاجة → Post-Check → Deploy/Runtime verification.

# قاعدة التنظيف والترتيب أثناء الإصلاح

تطبق في كل مرحلة، داخل نفس النطاق فقط:

1. إزالة التكرار والكود/الاختبارات/التعليقات القديمة المرتبطة مباشرة بالإصلاح.
2. توحيد أسماء الأخطاء والعقود والتعليقات بدون كسر API contract.
3. ترتيب migrations/tests/docs بحيث يسهل تتبع سبب التغيير ونتيجته.
4. تحديث checkpoint والسجل عند إغلاق كل batch/مرحلة.
5. عدم تنفيذ broad refactor أو لمس ملفات غير مرتبطة لمجرد التنظيف.
6. عدم حذف أو إضعاف RLS/tests؛ التنظيف لا يسبق الأمان.
7. قبل كل WRITE: إعادة جلب HEAD ومراجعة أي commits متوازية، بدون force push.

# الحالة التالية مباشرة

**Remaining = 6**

العمل النشط الآن: تشخيص فشل Integration في PR #41 وإغلاق P0-B تدريجيًا، مع إبقاء Production بلا أي DDL غير مجتاز للـFull Verify.
