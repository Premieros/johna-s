# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

> **هذا هو السجل الحي الوحيد للمشروع.**
> أي نموذج أو مطور يبدأ من هذا الملف فقط، ثم يتحقق من HEAD الحالي قبل أي تعديل لأن نماذج أخرى قد تعمل بالتوازي.

آخر تحديث: **2026-09-11 — Africa/Cairo — Thermal printing merged; multi-branch inventory transfer remediation active**

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
- State: **Open / Draft / غير مدمج** وقت تحديث هذا السجل.
- Branch: `development/raw-transfer-multibranch-fix`
- HEAD وقت الفحص: `ec52d8fe06e5f35a8e74c1caaed29fe22ce05972`
- الـPR كان مبنيًا أساسًا على `main@9f32aba8...`، بينما `main` تحرك لاحقًا إلى `bb736746...` بعد دمج PR #63؛ لذلك **يلزم فحص drift/rebase/merge compatibility قبل الدمج ولا يجوز blind merge**.

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

## 5) المخاطر التي يجب مراجعتها قبل دمج PR #64

- `main` تحرك بعد إنشاء PR #64 بسبب PR #63، لذلك يجب أولًا إعادة فحص المقارنة مع أحدث main.
- يجب التأكد أن تغييرات `useBranchFilter` لا توسع عرض البيانات أبعد مما يسمح به RLS.
- يجب اختبار مستخدم single-branch ومستخدم multi-branch ومستخدم بلا وصول للفرع الوجهة.
- يجب اختبار read policies لطرفي transfer، بينما mutation تحتاج access للطرفين.
- يجب التحقق أن raw material transfer لا يكرر/يضاعف الكميات عند approve أو retry.
- يجب التأكد أن product matching في destination لا يربط منتجًا خاطئًا بالاسم عند وجود تشابه/تكرار.
- يجب التأكد أن approval لا يخصم/يزيد المخزون أكثر من مرة.
- أي migration جديدة يجب أن تمر Fresh DB + schema + Integration/Security/RLS قبل Production.

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

ابدأ من PR #64 ولا تعيد فتح الأعمال المغلقة دون Regression مثبت:

1. اجلب أحدث `main` HEAD وتأكد هل ما زال `bb73674604c97e810a4dd2f8f3d36ccf9ea552f0` أم تحرك.
2. اجلب PR #64 وHEAD الحالي وقارن مع أحدث main.
3. راجع الاختلاف الناتج عن دمج PR #63 بعد base القديم لـPR #64.
4. افحص كل ملفات PR #64، خصوصًا:
   - `src/lib/useBranchFilter.ts`
   - `src/features/inventory/pages/TransfersPage.tsx`
   - `src/api/domains/inventory.ts`
   - migration الخاصة بـcross-branch transfers.
5. لا تشغل migration على Production.
6. أصلح أي conflict/regression على فرع PR #64 فقط.
7. شغّل Full Verify حتى الأخضر بالكامل.
8. اختبر branch/RLS/multi-branch transfer contract end-to-end.
9. بعد Full Green فقط: حدث هذا السجل بالنتيجة الدقيقة واطلب/نفذ الدمج حسب توجيه المستخدم.

لا تلمس أي مستودع أو قاعدة بيانات أخرى.
