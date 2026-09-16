# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

آخر تحديث: **2026-09-16 — synchronized with main through PR #152**

> هذا هو السجل الحي المختصر للمشروع. للتفاصيل التاريخية راجع `docs/STABILIZATION_WORK_LOG.md` وملفات الإغلاق السابقة.

## الهوية الثابتة

- Repository الوحيد: `Premieros/johna-s`
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`
- Production branch: `main`
- Published site: `https://premieros.github.io/johna-s/`
- ممنوع لمس أي Repository أو قاعدة أخرى.
- ممنوع استخدام `scpovyrqmsbiduanykod`.
- ممنوع تعديل `main` مباشرة أو Force Push.
- Super Admin فقط implicit bypass؛ باقي الأدوار Authorization = Permission-First + branch/RLS.
- ممنوع تخفيف RLS أو الاختبارات.
- ممنوع reset/reseed/rewrite لبيانات المستخدم أو الإعدادات أو الأرصدة لتسهيل الاختبار أو refactor.
- أي Migration: forward-only + append-only؛ لا تعديل Migration مطبقة.
- لا Production migration قبل Full Verify Green وموافقة صريحة.
- قبل كل write/merge: اجلب أحدث `main` والفرع/PR وافحص أي عمل أحدث أو متوازٍ.

## Baseline الحالي

- `main@b88ba29e5aa071e7d10bd7a19f7c6eed2341f9dd`
- آخر دمج مثبت على `main`: PR #152 — **Fix dashboard data display and default period**.
- رسالة الدمج تؤكد **Full Verify #1523 Green** على exact head قبل الدمج.
- PR #152 أبقى صافي المبيعات والمدفوعات والحسابات على المصادر canonical، وجعل Dashboard افتراضيًا على الشهر الحالي مع عزل فشل المصادر الاختيارية حتى لا تصبح الصفحة فارغة بالكامل.
- أحدث سلسلة تغييرات موثقة قبل #152 تشمل:
  - PR #148: إصلاح آمن لإشغال الطاولات من الطلبات الفعالة.
  - PR #149: Dashboard أكثر اختصارًا وتنسيق أرقام أنظف — UI-only.
  - PR #150: تصحيح opening receivables للموظفين وإضافة كشف حركة كامل لكل موظف.
  - PR #151: إصلاح سلامة الأرقام عبر أرصدة العملاء/الموردين والذمم والتقارير.
  - PR #152: إصلاح عرض بيانات Dashboard والفترة الافتراضية.
- الـPR المفتوح الوحيد وقت هذا التحديث: PR #132 — تطبيق النادل Android — Draft/Open وعلى مسار منفصل.
- الطباعة الحالية تعمل ومجمّدة خارج Scope؛ ممنوع تعديل Print Agent / printer routing / queues / printer settings دون Scope وموافقة منفصلين.

## فصل مسارات العمل — إلزامي

### A) تطبيق الهاتف — مملوك لمسار/نموذج آخر

- الفرع: `development/mobile-delivery-app`
- PR: #132 — **Draft / Open**.
- هذا الفرع تحت عمل مسار آخر؛ **ممنوع تعديله أو دفع commits إليه من أي مسار آخر**.
- الاتجاه المعتمد: تطبيق Android لنادل الصالة/الكابتن داخل المطعم، وليس كابتن توصيل.
- العميل مؤجل لمرحلة لاحقة.
- التطبيق يعتمد نفس صلاحيات النظام الفعلية ديناميكيًا؛ كل مستخدم يرى فقط ما يملكه.
- Permission-First فقط؛ لا Authorization بأسماء الأدوار.
- لا تعديل للنظام الحالي أو Production أو الطباعة أو Business Logic من مسار الموبايل إلا بموافقة منفصلة صريحة.
- `send_to_kitchen` يظل authority الحالي للمخزون، والطباعة تظل مجمّدة.
- لا Merge لـPR #132 حتى يكتمل verification المطلوب وموافقة صريحة.

### B) النظام الأساسي / Production stabilization

لا يتم خلطه مع فرع الموبايل. أي إصلاح أو تغيير جديد للنظام الأساسي يبدأ من أحدث `main` على فرع مستقل بعد فحص الأعمال المتوازية.

## العمل العالق المؤكد

1. **PR #132 — تطبيق النادل Android**
   - مستمر في مساره المنفصل فقط.
   - المطلوب قبل اعتباره جاهزًا: verification المناسب ومراجعة مستقلة قبل الدمج.

2. **حذف سجل المبيعات التجريبي من Production**
   - التدقيق السابق أثبت وجود بيانات تجريبية محدودة.
   - محاولة الحذف السابقة مُنعت بواسطة destructive-action protection ولم يتم تجاوزها.
   - تبقى خطوة مستقلة ولا تنفذ إلا عبر مسار إداري مسموح ثم verify للعدادات، بدون إعادة كتابة أرصدة المخزون.

3. **أي Production migrations غير مطبقة**
   - لا يتم تطبيق أي Migration اعتمادًا على سجل قديم.
   - يجب تحديد المطلوب من أحدث `main`/PR المعني، ثم Full Verify Green، ثم موافقة صريحة منفصلة قبل التطبيق.

4. **Regression / handover verification النهائي**
   - قبل أي handover نهائي: lint + typecheck + unit + build + fresh DB + schema + integration/security/RLS + Browser Smoke حيث ينطبق.
   - يجب التأكد أن Permission-First وbranch/warehouse isolation وsend_to_kitchen والapprovals والطباعة لم يحدث لها Regression.

5. **مراجعة الأعمال المفتوحة/المتوازية قبل أي كتابة جديدة**
   - baseline المعتمد الآن هو `main@b88ba29e...` فقط.
   - قبل كل تغيير جديد يجب جلب current `main` وفحص PRs المفتوحة لتجنب التعارض أو إعادة تنفيذ عمل موجود.

## عقود ثابتة لا يعاد فتحها بلا Regression مثبت

- Permission-First؛ Super Admin فقط implicit bypass.
- granular POS permissions تشمل view/create/edit/pay/split/transfer/receipt/send-kitchen.
- `send_to_kitchen` هو authority لاستهلاك المخزون؛ first send مرة ثم delta، وretry لا يكرر الاستهلاك.
- configured POS products تباع حتى مع نقص raw؛ raw debt مسموح في kitchen send حسب العقد المثبت.
- branch + warehouse isolation وRLS لا يتم تخفيفها.
- approval system enforced.
- username يظهر على الطاولة المشغولة وما يخص المستخدم حيث يلزم.
- printer management فقط لصاحب صلاحية الإعدادات.
- print once + controlled reprint، ولا physical print success كاذب.
- لا network/offline ambiguity تتحول إلى sale/payment success وهمي.
- Reports compact/tabular + filters + Excel export.
- guided prerequisite routing بدل raw errors حيث أمكن.
- Production ليست test environment.

## NEXT ACTION

1. لا تلمس `development/mobile-delivery-app` أو PR #132 من مسار النظام الأساسي.
2. أي عمل جديد على النظام الأساسي يبدأ من أحدث `main` بعد `b88ba29e...` وعلى فرع مستقل جديد.
3. قبل أي write جديد: افحص PRs/branches المتوازية وحدد overlap.
4. أبقِ أي Production data cleanup أو migration كخطوة مستقلة تتطلب verification والموافقة الصريحة المناسبة.
5. لا Merge ولا Production migration بدون Full Verify Green والموافقة المطلوبة لكل خطوة.

## التنفيذ القياسي

`Baseline -> Root Cause -> Small Change -> Focused Tests -> Integration/Regression -> Full Verify -> PR -> Merge only when allowed -> Verify main -> Deploy`

لا يُغيّر Business Logic صحيح لإرضاء اختبار خاطئ، ولا يُحذف Legacy إلا بعد إثبات الاستخدام/الاستبدال/التغطية ثم Full Verify.
