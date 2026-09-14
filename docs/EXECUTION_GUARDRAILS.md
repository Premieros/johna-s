# Execution Guardrails — Unified Current Rules

Date: 2026-09-15
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Production branch: `main`
Authoritative execution source: `docs/CURRENT_WORK_PLAN.md`
Branch status source: `docs/BRANCH_STATUS_REGISTRY.md`

> هذا الملف للضوابط الدائمة فقط. لا يحتوي على خطة مراحل مستقلة ولا Standing Approval قديم للدمج. أي ترتيب PR4/PR5/PR6/PR7 أو صلاحية دمج تاريخية في نسخة أقدم تعتبر منتهية ويحل محلها `CURRENT_WORK_PLAN.md`.

## Preservation First
- لا reset/reseed/rewrite/migrate-for-convenience لبيانات المستخدم أو الإعدادات أو الأرصدة أو المستندات أو المخزون.
- قبل أي write: fetch أحدث `main` والفرع ACTIVE فقط.
- Production ليست بيئة اختبار.
- migrations forward-only / append-only.
- no Force Push، no RLS weakening، no role-name authorization لغير Super Admin، no cross-branch/warehouse fallback.
- no Production migration قبل Full Verify Green + موافقة صريحة منفصلة.

## Branch/merge governance
- وجود فرع/PR قديم أو CI Green قديم لا يمثل موافقة حالية.
- فقط الفروع ACTIVE في `BRANCH_STATUS_REGISTRY.md` قابلة للتنفيذ.
- أي فرع آخر = INACTIVE/HISTORICAL / DO NOT MERGE.
- Merge لا يعني أن migrations أصبحت مطبقة على Production.

## Module-boundary rule
التنظيف يبدأ Audit وليس Refactor:
- افحص ownership/dependencies أولًا.
- سجّل coupling قبل تغييره.
- لا تنقل ملفات أو تعيد تقسيم APIs/DB contracts للشكل فقط.
- أصلح coupling مثبت فقط وبأصغر change مع Regression tests.

الموديولات المرجعية: Auth/Permissions، Branch/Warehouse، Catalog، Inventory/Purchases/Transfers/Waste، POS/Tables/Orders/Payments/Shifts، Kitchen/KDS، Approvals، Reports/Finance، Printing، Settings.

## UX acceptance gate
لأي surface يتم لمسه فقط:
- actions المطلوبة reachable؛ prerequisites موجهة بدل raw errors؛
- labels/status Arabic-first وواضحة؛
- blocked operation يوضح السبب والخطوة التالية؛
- permission-first وbranch/warehouse/user context محفوظ؛
- لا redesign واسع بدون Scope مستقل؛
- regression coverage لأي UX guard يحمي business behavior.

## Full Verify definition
Full Verify الحالي يشمل على الأقل:
- repository + DB identity lock؛ lint؛ app/test typecheck؛ unit؛ build؛
- fresh DB canonical migrations؛ schema verification؛ integration/security/RLS؛
- Browser Smoke؛ changed-files/scope review.

أي stage تم Skip بسبب failure سابق = Full Verify ليس Green.

## Production parity
بعد Merge/Verify/Deploy:
- صنف migrations: Applied / Pending / Not-for-Production.
- لا تفترض أن كل migration في `main` مطبقة في Production.
- Pending يحتاج Full Green + impact review + موافقة صريحة.
- verification بعد التطبيق بدون reset/reseed/rewrite.

## Product principle
**Simple inside. Same capabilities outside. Clearer for the user.**

عند أي تعارض، `docs/CURRENT_WORK_PLAN.md` هو الحاكم.
