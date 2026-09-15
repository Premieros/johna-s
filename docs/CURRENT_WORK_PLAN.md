# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

آخر تحديث: **2026-09-15 — workstream ownership + pending work checkpoint**

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

- `main@0919ddd171890852b03e712d45b18891ea31f821`
- آخر دمج مثبت على `main`: PR #133 — manufacturing completion RPC authority.
- رسالة الدمج تؤكد Full Verify #1402 Green على exact head، بدون DB migration أو Production data write أو تغيير للطباعة/POS/KDS/pricing/payment.
- الطباعة الحالية تعمل ومجمّدة خارج Scope؛ ممنوع تعديل Print Agent / printer routing / queues / printer settings دون Scope وموافقة منفصلين.

## فصل مسارات العمل — إلزامي

### A) تطبيق الهاتف — مملوك لمسار/نموذج آخر

- الفرع: `development/mobile-delivery-app`
- PR: #132 — **Draft / Open**.
- هذا الفرع تحت عمل نموذج آخر حاليًا؛ **ممنوع تعديله أو دفع commits إليه من أي مسار آخر**.
- الاتجاه المعتمد حاليًا: تطبيق Android لنادل الصالة/الكابتن داخل المطعم، وليس كابتن توصيل.
- العميل مؤجل لمرحلة لاحقة.
- نفس التطبيق يجب أن يعرض الوظائف حسب صلاحيات المستخدم الفعلية عند الربط؛ المدير يرى فقط ما يملكه، والنادل كذلك.
- Permission-First فقط؛ لا Authorization بأسماء الأدوار.
- لا تعديل للنظام الحالي أو Production أو الطباعة أو Business Logic من مسار الموبايل إلا بموافقة منفصلة صريحة.
- `send_to_kitchen` يظل authority الحالي للمخزون، والطباعة تظل مجمّدة.
- لا Merge لـPR #132 حتى يصبح scope النهائي واضحًا ويكتمل verification المطلوب وموافقة صريحة.

### B) النظام الأساسي / Production stabilization

لا يتم خلطه مع فرع الموبايل. أي إصلاح أو تغيير جديد للنظام الأساسي يبدأ من أحدث `main` على فرع مستقل بعد فحص الأعمال المتوازية.

## العمل العالق المؤكد

1. **PR #132 — تطبيق النادل Android**
   - مستمر عند النموذج الآخر فقط.
   - المطلوب قبل اعتباره جاهزًا: إكمال التصميم/الوظائف المعتمدة، ربط آمن لاحقًا بدون تعديل غير مصرح للنظام، Full Verify المناسب، ثم مراجعة مستقلة قبل الدمج.

2. **حذف سجل المبيعات التجريبي من Production**
   - التدقيق السابق أثبت وجود بيانات تجريبية محدودة.
   - محاولة الحذف السابقة مُنعت بواسطة destructive-action protection ولم يتم تجاوزها.
   - ما زالت خطوة مستقلة معلقة، ولا تنفذ إلا عبر مسار إداري مسموح ثم verify للعدادات، بدون إعادة كتابة أرصدة المخزون.

3. **أي Production migrations غير مطبقة**
   - لا يتم تطبيق أي Migration على Production اعتمادًا على سجل قديم.
   - يجب أولًا تحديد migrations المطلوبة من أحدث `main`/PR المعني، Full Verify Green، ثم موافقة صريحة منفصلة قبل التطبيق.

4. **Regression / handover verification النهائي**
   - قبل أي handover نهائي: lint + typecheck + unit + build + fresh DB + schema + integration/security/RLS + Browser Smoke حيث ينطبق.
   - يجب التأكد أن Permission-First وbranch/warehouse isolation وsend_to_kitchen والapprovals والطباعة لم يحدث لها Regression.

5. **مراجعة الأعمال المفتوحة/المتوازية قبل أي كتابة جديدة**
   - `main` تحرك عدة مرات يوم 2026-09-15؛ لا يُستخدم baseline قديم.
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

1. عدم لمس `development/mobile-delivery-app` أو PR #132 من هذا المسار؛ النموذج الآخر يكمل تطبيق الهاتف.
2. أي عمل جديد على النظام الأساسي يبدأ من أحدث `main` فقط وعلى فرع مستقل جديد.
3. قبل أي write جديد: افحص PRs/branches المتوازية وحدد overlap.
4. أبقِ حذف بيانات المبيعات التجريبية كخطوة Production مستقلة معلقة حتى مسار إداري مسموح وموافقة صريحة.
5. لا Merge ولا Production migration بدون Full Verify Green والموافقة المطلوبة لكل خطوة.

## التنفيذ القياسي

`Baseline -> Root Cause -> Small Change -> Focused Tests -> Integration/Regression -> Full Verify -> PR -> Merge only when allowed -> Verify main -> Deploy`

لا يُغيّر Business Logic صحيح لإرضاء اختبار خاطئ، ولا يُحذف Legacy إلا بعد إثبات الاستخدام/الاستبدال/التغطية ثم Full Verify.
