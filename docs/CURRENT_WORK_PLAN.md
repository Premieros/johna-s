# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

آخر تحديث: **2026-09-16 — POS hardening workstream started**

> هذا هو السجل الحي المختصر للمشروع. للتفاصيل التاريخية راجع `docs/STABILIZATION_WORK_LOG.md` وملفات الإغلاق السابقة. سجل إصلاح POS الحالي: `docs/POS_HARDENING_REPAIR_LOG_2026-09-16.md`.

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

- `main@2901a3c58533706c80f61bdf670f758c6f3b598e`
- آخر دمج مثبت على `main`: PR #168 — fit customer receipt to thermal paper.
- Full Verify للـPR #168 كان Green على exact head قبل الدمج.
- فرع إصلاح POS الحالي: `development/pos-hardening-20260916`، بدأ من هذا الـbaseline بالضبط.
- لا توجد Production DB writes ضمن بدء مسار POS hardening.
- Print Agent / printer routing / queues ليست ضمن scope هذا المسار إلا بتغيير منفصل وموافقة صريحة.

## فصل مسارات العمل — إلزامي

### A) تطبيق الهاتف — مملوك لمسار/نموذج آخر

- الفرع: `development/mobile-delivery-app`
- PR: #132 — **Draft / Open** حسب آخر سجل مثبت قبل هذا المسار.
- هذا الفرع تحت عمل نموذج آخر؛ **ممنوع تعديله أو دفع commits إليه من مسار POS hardening**.
- الاتجاه المعتمد: تطبيق Android لنادل الصالة/الكابتن داخل المطعم، وليس كابتن توصيل.
- العميل مؤجل لمرحلة لاحقة.
- نفس التطبيق يجب أن يعرض الوظائف حسب صلاحيات المستخدم الفعلية عند الربط؛ المدير يرى فقط ما يملكه، والنادل كذلك.
- Permission-First فقط؛ لا Authorization بأسماء الأدوار.
- لا تعديل للنظام الحالي أو Production أو الطباعة أو Business Logic من مسار الموبايل إلا بموافقة منفصلة صريحة.
- `send_to_kitchen` يظل authority الحالي للمخزون.

### B) النظام الأساسي / Production stabilization

لا يتم خلطه مع فرع الموبايل. أي إصلاح أو تغيير جديد للنظام الأساسي يبدأ من أحدث `main` على فرع مستقل بعد فحص الأعمال المتوازية.

### C) POS hardening — ACTIVE

- الفرع: `development/pos-hardening-20260916`.
- السجل الحي: `docs/POS_HARDENING_REPAIR_LOG_2026-09-16.md`.
- الهدف: إغلاق فجوات الصلاحيات والـatomicity ومسار sent-only للدفع والطباعة، بدون إعادة بناء POS.
- الأولويات P0:
  1. ربط Cancel وTransfer بالـpermissions في كل UI/handler/server path.
  2. جعل نقل الطاولة server-authoritative وatomic.
  3. زر الدفع يظهر فقط بعد أول kitchen send ناجح.
  4. Pay وPrint للطلب المفتوح يحسبان **sent-to-kitchen quantities فقط**.
  5. الإضافات غير المرسلة لا تدخل في الدفع أو الطباعة حتى نجاح delta send.
- قواعد الصلاحيات المثبتة:
  - الدفع: `pos.payment.take`.
  - الطباعة: `pos.receipt.print`.
  - النقل: `pos.order.transfer`.
  - الإلغاء: `pos.cancel_order`.
  - Super Admin فقط implicit bypass؛ ممنوع role-name checks جديدة.
- لا يتم تعليم أي إصلاح مغلقًا قبل focused regression test، ثم Full Verify قبل PR/merge.

## العمل العالق المؤكد

1. **POS hardening — ACTIVE**
   - راجع السجل الحي المذكور أعلاه.
   - NEXT: تدقيق server contracts/RPCs لـcancel/transfer/send_to_kitchen/process_sale ثم تنفيذ أول P0 صغير مع test.

2. **PR #132 — تطبيق النادل Android**
   - مستمر عند المسار الآخر فقط.
   - المطلوب قبل اعتباره جاهزًا: إكمال التصميم/الوظائف المعتمدة، Full Verify المناسب، ثم مراجعة مستقلة قبل الدمج.

3. **حذف سجل المبيعات التجريبي من Production**
   - خطوة Production مستقلة معلقة.
   - لا تنفذ ضمن POS hardening.

4. **أي Production migrations غير مطبقة**
   - لا يتم تطبيق أي Migration على Production اعتمادًا على سجل قديم.
   - يجب أولًا تحديد migration المطلوبة من أحدث `main`/PR، Full Verify Green، ثم موافقة صريحة منفصلة.

5. **Regression / handover verification النهائي**
   - lint + typecheck + unit + build + fresh DB + schema + integration/security/RLS + Browser Smoke حيث ينطبق.
   - يجب التأكد أن Permission-First وbranch/warehouse isolation وsend_to_kitchen والapprovals والطباعة لم يحدث لها Regression.

6. **مراجعة الأعمال المفتوحة/المتوازية قبل أي كتابة جديدة**
   - توجد فروع POS قديمة/متوازية؛ لا يُسحب منها شيء تلقائيًا إلى POS hardening.
   - قبل كل تغيير جديد يجب جلب current `main` وفحص overlap لتجنب إعادة تنفيذ عمل موجود.

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
- طباعة الحساب من الطلب المفتوح مسموحة بصلاحية `pos.receipt.print`، لكن تطبع sent-to-kitchen quantities فقط.
- الدفع من الطلب المفتوح مسموح بعد أول kitchen send فقط وبصلاحية `pos.payment.take`، ويدفع sent-to-kitchen quantities فقط.
- لا network/offline ambiguity تتحول إلى sale/payment success وهمي.
- Reports compact/tabular + filters + Excel export.
- guided prerequisite routing بدل raw errors حيث أمكن.
- Production ليست test environment.

## NEXT ACTION

1. استمرار العمل فقط على `development/pos-hardening-20260916` لهذا الـscope.
2. تدقيق RPC/server authority لـcancel/transfer/send_to_kitchen/process_sale قبل تعديل Business Logic.
3. تنفيذ P0s بترتيب: permission gates -> sent-only pay/print -> atomic transfer -> concurrency/audit.
4. تحديث `docs/POS_HARDENING_REPAIR_LOG_2026-09-16.md` بعد كل commit/اختبار.
5. عدم لمس `development/mobile-delivery-app` أو أي مشروع/قاعدة أخرى.
6. لا Merge ولا Production migration بدون Full Verify Green والموافقة المطلوبة لكل خطوة.

## التنفيذ القياسي

`Baseline -> Root Cause -> Small Change -> Focused Tests -> Integration/Regression -> Full Verify -> PR -> Merge only when allowed -> Verify main -> Deploy`

لا يُغيّر Business Logic صحيح لإرضاء اختبار خاطئ، ولا يُحذف Legacy إلا بعد إثبات الاستخدام/الاستبدال/التغطية ثم Full Verify.
