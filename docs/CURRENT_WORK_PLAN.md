# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

آخر تحديث: **2026-09-15 — post PR #126 merge / registry unification**

> هذا الملف هو **المصدر التنفيذي الوحيد للحقيقة**. أي Plan/Report/Closure/Addendum/Work Log أقدم هو مرجع تاريخي فقط ما لم يُذكر صراحة هنا أنه ACTIVE.

## الهوية الثابتة
- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Published site: `https://premieros.github.io/johna-s/`
- ممنوع لمس أي Repository أو قاعدة أخرى، أو استخدام `scpovyrqmsbiduanykod`.
- ممنوع تعديل `main` مباشرة أو Force Push.
- Permission-First؛ Super Admin فقط implicit bypass.
- ممنوع تخفيف RLS أو الاختبارات أو reset/reseed/rewrite لبيانات المستخدم.
- migrations forward-only + append-only.
- لا Production migration قبل Full Verify Green + موافقة صريحة منفصلة.

## Current baseline
- `main@8784e7b7102e946377a8ccd72073e01fbf929ef5`
- PR #126: **MERGED** — branch-scope KDS station authorization.
- PR #126 Full Verify #1373: **Green** قبل الدمج.
- post-merge Verify main #1375: **in progress** وقت هذا التحديث.
- Deploy #647: **in progress** وقت هذا التحديث.
- لم يتم تنفيذ Production migration ضمن Merge #126.

## العمل النشط الآن
لا يوجد functional development branch نشط بعد دمج PR #126.

الفرع الإداري الوحيد النشط مؤقتًا:
- `development/status-registry-unification-v2` — **DOCS ONLY** لتوحيد السجلات وحالة الفروع؛ ممنوع أي runtime/business/database change عليه.

## Branch governance
- السجل الرسمي: `docs/BRANCH_STATUS_REGISTRY.md`.
- أي `development/*` غير مذكور هناك كـACTIVE = **INACTIVE/HISTORICAL / DO NOT MERGE**.
- وجود branch قديم أو CI Green قديم لا يعطي صلاحية دمج.
- إعادة تفعيل أي فرع تتطلب تحديث هذا الملف أولًا مع السبب والـscope والـbaseline والـregression evidence.

## Preservation First
المرحلة التالية هي **Stabilization/Cleanup Audit** وليست إعادة بناء:
1. تثبيت post-merge `main` بعد نجاح Verify/Deploy.
2. مراجعة كل الإصلاحات من بداية خطة التبسيط حتى الوضع الحالي.
3. لا تغيير لأي Business Logic شغال لمجرد التنظيف.
4. لا حذف Legacy/wrapper/route/migration إلا بعد إثبات عدم الاستخدام + Regression coverage.
5. كل إصلاح صغير ومعزول ومبني على Root Cause مثبت.
6. الطباعة لا يعاد تصميمها ضمن التنظيف.
7. Production وبيانات المستخدم خارج الاختبار والتنظيف.

## خطة التثبيت والتنظيف
### Phase A — Freeze & Evidence
- التقاط HEAD بعد اكتمال Verify/Deploy.
- جرد migrations/RPC/routes/modules التي تغيرت منذ خطة التبسيط.
- جرد Production migration parity؛ لا نفترض أن Merge = Production application.

### Phase B — Module Boundary Audit
تدقيق الحدود دون Refactor أولي:
- Auth / Users / Permissions
- Branch / Warehouse
- Catalog: products / raw materials / manufactured items / modifier groups
- Inventory / Purchases / Transfers / Waste
- POS / Tables / Orders / Payments / Shifts
- Kitchen / KDS
- Approvals
- Reports / Finance
- Printing / Print Agent
- Settings

أي coupling مشكوك فيه يُسجل أولًا ولا يُعدل إلا إذا ثبت خطره أو Regression.

### Phase C — Regression sweep
- branch switching / scoped data
- catalog / recipes / availability / modifiers
- POS mobile مقابل desktop
- order/table ownership + transfer/reassignment permissions
- `send_to_kitchen` first-send + delta + idempotency + stock deduction
- KDS branch/station isolation
- payments/split/hold/resume
- approvals
- shifts/reports
- printing contracts بدون redesign

### Phase D — Full Verify Gate
- repository/database identity locks
- lint
- application + tests typecheck
- unit
- build
- fresh DB canonical migrations
- schema verification
- integration/security/RLS
- Browser Smoke
- changed-files/scope review

أي skipped stage بسبب failure سابق = Full Verify ليس Green.

### Phase E — Production parity audit
- مقارنة migrations في `main` بما طُبق فعليًا على `azzdesuowpdcoflmyezn`.
- تصنيف: Applied / Pending / Not-for-Production.
- لا تطبيق تلقائي بعد Merge أو Deploy.
- Pending يحتاج Full Green + impact review + موافقة صريحة منفصلة.

## عقود ثابتة
- granular POS permissions: view/create/edit/pay/split/transfer/receipt/send-kitchen.
- المستخدم العادي لا يفتح/يعدل طلبًا أو طاولة لا تخصه بدون الصلاحية المناسبة؛ اسم الدور ليس Authorization.
- username يظهر على الطاولة المشغولة وما يخص المستخدم حيث يلزم.
- `send_to_kitchen` authority للاستهلاك؛ first send ثم delta؛ retry لا يكرر الاستهلاك.
- branch + warehouse isolation وRLS لا يتم تخفيفها.
- approval system enforced.
- printer management فقط لصاحب صلاحية الإعدادات.
- print once + controlled reprint؛ لا physical print success كاذب.
- لا network/offline ambiguity تتحول إلى sale/payment success وهمي.
- Reports compact/tabular + filters + Excel export.
- Production ليست test environment.

## أولوية الوثائق
- `docs/STABILIZATION_WORK_LOG.md`: timeline فقط، ليس خطة مستقلة.
- `docs/EXECUTION_GUARDRAILS.md`: ضوابط دائمة فقط.
- `docs/BRANCH_STATUS_REGISTRY.md`: حالة الفروع.
- أي `*_PLAN.md`, `*_REPORT.md`, `*_CLOSURE.md`, addendum أو archive آخر = تاريخ/أدلة فقط ما لم يُفعّل هنا.
- عند التعارض: **هذا الملف يفوز**.

## NEXT ACTION
1. انتظر اكتمال post-merge Verify #1375 وDeploy #647.
2. بعد Green، ثبّت baseline النهائي.
3. أغلق docs-only registry PR بأمان.
4. ابدأ Phase A على فرع جديد من أحدث `main`؛ لا تعيد استخدام أي فرع تاريخي.
5. Production parity audit مستقل؛ لا migration تلقائيًا.

`Baseline -> Root Cause -> Small Change -> Focused Tests -> Integration/Regression -> Full Verify -> PR -> Merge -> Verify main -> Deploy -> Production parity audit -> Production change only with explicit approval`
