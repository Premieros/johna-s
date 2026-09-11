# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف فقط، ثم يتحقق من HEAD الحالي قبل أي تعديل لأن نماذج أخرى قد تعمل بالتوازي.

آخر تحديث: **2026-09-11 — Africa/Cairo — PR #64 Full Green؛ بانتظار توجيه صريح بالدمج**

## 1) الهوية الثابتة — غير قابلة للخلط

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Published site: `https://premieros.github.io/johna-s/`
- أي مشروع/مستودع آخر مثل `55` / `pos.v2` / `v4` / ZIP خارجي = **READ-ONLY REFERENCE ONLY**.
- ممنوع استخدام Supabase `scpovyrqmsbiduanykod` لهذا المشروع.
- ممنوع تعديل `main` مباشرة أو Force Push.
- ممنوع تشغيل Production migration قبل Full Verify Green.
- ممنوع تخفيف RLS أو الاختبارات لإجبار CI على النجاح.
- Super Admin فقط implicit bypass.
- كل الأدوار الأخرى Labels فقط؛ Authorization = Permission-First + branch/RLS.
- قبل أي write: اجلب HEAD الحالي لـ`main` والفرع/PR المستهدف، وافحص commits الأحدث ولا تعكس عمل نموذج آخر.
- عند الدمج استخدم expected SHA guard متى أمكن.

## 2) الحالة الحالية لـ main

تم التحقق وقت تحديث هذا السجل أن:

- `main` HEAD = `bb73674604c97e810a4dd2f8f3d36ccf9ea552f0`
- هذا الـcommit هو Merge لـPR #63:
  - `fix(printing): size thermal output to 58/80mm content`
- Parent السابق:
  - `9f32aba8bc5c3ab688d9c54c06cba1c3481570b5`
- PR #62 كان قد دمج إصلاح Windows thermal print transport عبر Chromium/Electron.
- PR #63 أضاف هندسة ورق حراري 80mm افتراضيًا و58mm عند الطلب، مع pageSize محسوب من المحتوى لكل ما يمر عبر Electron silent print.

**مهم:** وصول job إلى Windows Print Queue يثبت وصوله للـspooler فقط، ولا يثبت خروج الورق فعليًا. لا تدّعِ نجاح الطباعة الفيزيائية دون اختبار الجهاز نفسه.

## 3) دفعات مغلقة حديثًا

### PR #61 — Accounting / Supplier / Employee Credit

تم دمجه سابقًا ويتضمن:

- Supplier accounts / statement.
- Cash paid vs credit/debt.
- Shift closing split by payment methods.
- Employee credit via existing customer credit path.
- Raw material available inventory panel.
- لا role-name authorization.
- لا كسر لـRLS أو branch isolation.

Production migrations الخاصة به طُبقت على `azzdesuowpdcoflmyezn` فقط بعد التحقق.

### PR #62 — Windows print transport

Merged ✅

- Receipt/kitchen/text test printing عبر Chromium `webContents.print` بدل `Out-Printer`.
- UTF-8 / Arabic support أفضل.
- exact `deviceName`.
- Print Truth محفوظ: callback failure لا يسجل نجاحًا كاذبًا.
- Cash drawer بقي مسارًا منفصلًا.

### PR #63 — Thermal page geometry

Merged ✅ إلى `main@bb736746...`

- 80mm default.
- 58mm supported via option.
- no A4/Letter assumption داخل Electron silent print.
- content-sized page height + small bottom feed.
- HTML/text payloads التي تمر عبر Electron silent print تأخذ نفس thermal page geometry.
- هذا لا يعني أن Chrome browser print preview نفسه أعيد تصميمه.
- هذا لا يثبت التوافق الفيزيائي مع كل thermal driver.

## 4) الدفعة النشطة الحالية — PR #64

PR #64:

- Title: `fix(inventory): multi-branch transfer and branch visibility`
- State: **Open / Draft / غير مدمج** وقت تحديث هذا السجل؛ لا تدمجه دون توجيه صريح من المستخدم.
- Branch: `development/raw-transfer-multibranch-fix`
- Functional HEAD الموثق بعد الإصلاح والتحقق: `ee5c2e53046419c20cee288ef4bb1c2c9ae57522`؛ توجد بعده commits توثيقية فقط، لذلك يجب دائمًا fetch للـHEAD الفعلي بدل افتراض SHA السجل.
- أحدث `main` وقت إعادة الفحص قبل تحديث السجل: `bb73674604c97e810a4dd2f8f3d36ccf9ea552f0`
- تمت مراجعة drift الناتج عن PR #63، ثم دُمج أحدث `main` داخل فرع PR #64 فقط عبر merge commit غير قسري `0c1ec792af54d319cbf50874c45e4e1d52c44400`؛ أبواه هما HEAD الفرع الموثق السابق `a5f9536b446fd33632142be6cfd13a6b19f67196` و`main@bb736746...`.
- commits اللاحقة على فرع PR فقط:
  - `a06373a2acd2145fb568ca54d150cd6d33809b3f` — إغلاق فجوات التحقق والعقد الذري.
  - `ee5c2e53046419c20cee288ef4bb1c2c9ae57522` — تثبيت عدم كشف وجود transfer لفرع غير متاح.

الهدف الحالي:

1. Multi-branch branch visibility بدون role-name shortcuts.
2. المستخدم الذي يملك وصولًا لأكثر من فرع يمكنه العمل على كل الفروع المسموح بها عبر RLS، وليس التثبيت الإجباري على primary branch فقط.
3. Warehouse transfer يدعم Source branch وDestination branch بشكل صريح.
4. يدعم products وraw materials في النقل بين الفروع.
5. الـsource/destination warehouse يجب أن يتطابقا مع فروعهما.
6. إنشاء/اعتماد التحويل يتطلب صلاحيات فعلية ووصولًا للفرعين.
7. لا fallback أو cross-branch leakage.
8. Raw materials حاليًا branch-level؛ النقل بين مخزنين داخل نفس الفرع للخامة غير مدعوم بهذا العقد ويجب أن يفشل بوضوح.
9. مطابقة الصنف في فرع الوجهة تكون deterministic ولا يجوز إنشاء mapping غامض صامت.
10. لا Production migration قبل Full Verify Green ثم قرار صريح بالتطبيق.

## 5) مراجعة PR #64 ونتيجة التحقق

تمت مراجعة `useBranchFilter` وواجهة التحويل وAPI وmigration مقابل أحدث `main`. النتيجة:

- `useBranchFilter` يزيل تثبيت المستخدم متعدد الفروع على primary branch، لكنه لا يمنح وصولًا جديدًا؛ استعلامات الفروع والبيانات تظل محكومة بـRLS.
- القراءة لطرف المصدر أو الوجهة مسموحة وفق RLS، بينما create/approve/reject تتطلب permission فعلية ووصولًا للفرعين.
- أُغلقت INSERT/UPDATE/DELETE المباشرة على `warehouse_transfers` و`warehouse_transfer_items`؛ الكتابة تمر فقط عبر RPCs الذرية، فلا يمكن اعتماد header مباشرة وتجاوز حركة المخزون.
- approve/reject لا يكشفان وجود transfer غير متاح: النتيجة `TRANSFER_NOT_FOUND` بدل existence/status oracle.
- product/raw destination identity أصبحت مطلوبة وصريحة في كل سطر cross-branch، مع تحقق من النوع والفرع والحالة؛ لا مطابقة صامتة بالاسم/SKU/barcode ولا ارتباط بصنف مشابه خاطئ.
- migration تسقط قيد product-only القديم قبل إضافة عقد product-or-raw، وتمنع ترقية legacy cross-branch غير القابل للاستنتاج بأمان.
- product transfer يستخدم نوع حركة المخزون القانوني `transfer`، وraw material transfer يتحرك بين الفروع فقط.
- الاختبارات تغطي single-branch وmulti-branch وعدم الوصول للوجهة، قراءة الطرفين، منتجات وخامات، destination decoy/wrong branch/missing، direct-DML denial، approve retry وعدم مضاعفة الخصم/الإضافة.

Full Green على `ee5c2e53046419c20cee288ef4bb1c2c9ae57522` عبر GitHub Actions `Verify main` run **#1053** (`34546879995`)، attempt النهائي:

- locked Supabase identity `azzdesuowpdcoflmyezn` ✅
- frontend API contract ✅
- lint ✅ — 0 errors؛ 3 warnings قديمة غير متصلة بهذه الدفعة.
- typecheck application + tests ✅
- unit ✅ — 474/474.
- build ✅
- Fresh DB canonical migrations ✅
- schema ✅ — tables 60/60، functions 65/65، contract RPCs 114/114، contract tables 58/58.
- Integration/Security/RLS ✅ — 617/617 في 100 files.
- Browser Smoke / Playwright Chromium ✅ — 105/105.

ملاحظة سجلية: attempt الأول لـ#1053 اصطدم بـPostgreSQL deadlock عابر في اختبار user management غير المتصل بهذه الدفعة؛ إعادة job الفاشل على نفس commit مرّت كاملة دون تعديل كود. run #1052 السابق كشف قيد الخامات ونوع حركة المنتج وباقي الفجوات وساعد على تصحيحها، لكنه ليس Full Green نهائيًا.

تم كذلك تشغيل Full Green مستقل على documentation-only successor عبر run **#1054** (`34547630135`): verify + Fresh DB/schema + Integration/Security/RLS + Browser Smoke كلها نجحت من أول محاولة.

**لم تُطبق migration الخاصة بـPR #64 على Production، ولم يُدمج PR إلى `main`.**

## 6) متطلبات ثابتة لا يجوز كسرها

- Arabic-first RTL، Touch-friendly.
- Permission-First، لا استخدام أسماء roles كAuthorization.
- Super Admin فقط implicit bypass.
- Branch isolation عبر RLS على كل business data.
- `send_to_kitchen` هو نقطة خصم المخزون.
- POS granular permissions تشمل على الأقل:
  - `pos.view`
  - `pos.order.create`
  - `pos.order.edit`
  - `pos.payment.take`
  - `pos.order.split`
  - `pos.order.transfer`
  - `pos.receipt.print`
  - `pos.send_kitchen`
  - `pos.pay`
- يجب دعم أنماط مثل View Only وPay Only متى تسمح الصلاحيات.
- Approval system enforced.
- Printer management لا يظهر إلا لصاحب صلاحية الإعدادات المناسبة.
- الطاولة المشغولة وكل ما يتعلق بمستخدم يجب أن يعرض اسم المشغل/المستخدم بصورة آمنة ضمن النطاق المسموح.
- Send to kitchen أول مرة ثم التعديلات كDelta.
- Hold/Resume، split، merge/transfer، print once + controlled reprint.
- عدم تحويل network/online ambiguity إلى sale/payment success وهمي.
- Print Agent absent/failure لا يسجل print success كاذبًا.

## 7) قواعد التحقق والإغلاق

أي دفعة لا تعتبر جاهزة للدمج إلا بعد:

1. Fetch أحدث `main` وHEAD الفرع/PR.
2. فهم أي drift أو commits أحدث.
3. lint ✅
4. typecheck ✅
5. unit ✅
6. build ✅
7. Fresh DB ✅ عند وجود DB contract/migration.
8. schema ✅
9. Integration/Security/RLS ✅
10. Browser Smoke ✅ للتغييرات المؤثرة على الواجهة/التشغيل.
11. عدم وجود migration غير Verified على Production.
12. لا دمج إذا تحرك `main` بعد verification إلا بعد إعادة الفحص/التحقق المناسب.
13. لا ادعاء Physical Print success إلا بعد اختبار فعلي على جهاز/تعريف الطابعة.

## 8) NEXT ACTION — إلزامي للمحادثة التالية

PR #64 جاهز من ناحية التحقق لكنه غير مدمج. لا تعِد العمل المغلق دون Regression مثبت:

1. انتظر توجيه المستخدم الصريح بالدمج؛ لا تدمج تلقائيًا.
2. قبل الدمج اجلب أحدث `main` وHEAD PR #64 وتأكد أن الفرع ما زال descendant مباشرًا موثوقًا من functional HEAD `ee5c2e530...` بلا تغييرات وظيفية غير موثقة، وأن `main` لم يتحرك من `bb736746...`.
3. إذا تحرك أي منهما، افحص الفرق ولا تعمل blind merge، ثم أعد التحقق المناسب.
4. عند التوجيه بالدمج استخدم expected SHA guard وبدون Force Push أو تعديل مباشر لـ`main`.
5. migration لم تُطبق على Production؛ لا تطبقها إلا بعد الحفاظ على Full Green وضمن توجيه صريح وخطة نشر آمنة.
6. بعد أي دمج/نشر حدّث هذا السجل بالـSHAs والنتائج الفعلية.

لا تلمس أي مستودع أو قاعدة بيانات أخرى.
