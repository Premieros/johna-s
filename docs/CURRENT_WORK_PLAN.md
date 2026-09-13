# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

آخر تحديث: **2026-09-13 — Post-PR7 closure**

> هذا هو السجل الحي المختصر للمشروع. للتفاصيل التاريخية راجع `docs/STABILIZATION_WORK_LOG.md` و`docs/PLAN_CHECKPOINT_2026-09-13.md` و`docs/STABILIZATION_WORK_LOG_2026-09-13_ADDENDUM.md` و`docs/PR7_CONFIRMED_LEGACY_CLEANUP_CLOSURE.md`.

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
- ممنوع reset/reseed/delete/rewrite لبيانات المستخدم أو الإعدادات أو الأرصدة لتسهيل الاختبار أو refactor.
- أي Migration: forward-only + append-only؛ لا تعديل Migration مطبقة.
- لا Production migration قبل Full Verify Green وموافقة صريحة عند الحاجة.
- قبل كل write/merge: اجلب أحدث `main` والفرع/PR وافحص أي عمل أحدث أو متوازٍ.

## الحالة الحالية المثبتة

- `main@433ff97d9dd4425df74e82f65170497bfd28bab2`
- PR #105 — PR7 Confirmed Legacy Cleanup: **MERGED**
- Post-merge Verify main #1286: **Full Green**
- Deploy #630: **Green** بما في ذلك Production API parity والنشر على GitHub Pages
- لا Production migration ولا reset/reseed/backfill ولا تعديل لبيانات المستخدم تم ضمن PR7.

## برنامج التبسيط — الحالة النهائية

مغلق ومثبت:

1. PR1 — Architecture / Simplification Map ✅
2. PR2 — Inventory Contracts ✅
3. PR3 — Catalog Simplification 6A / 6B / 6C / 6D ✅
4. PR4 — Purchases End-to-End — PR #98 ✅
5. PR5 — Sales / POS / Tables / Kitchen / Payments — PR #99 ✅
6. PR6 — Shift / Finance / Reports — PR #100 ✅
7. PR7 — Confirmed Legacy Cleanup — PR #105 ✅

### PR7 — آخر مرحلة تنظيف بعد إثبات أن الأكواد القديمة غير مستخدمة

هذه المرحلة **مغلقة**، ولم يكن مسموحًا حذف أي Legacy لمجرد أنه قديم.

قاعدة الإغلاق الإلزامية كانت:

`usage proof -> replacement proof -> regression coverage -> removal -> Full Verify`

المعنى التنفيذي:

- إثبات أن الكود/المسار القديم لم يعد جزءًا من الـsupported product flow.
- إثبات أن الوظيفة المطلوبة محفوظة أو أن المسار الملغي لم يعد له استخدام مدعوم.
- إضافة Regression coverage تمنع رجوع الاعتماد القديم بالخطأ.
- إزالة الـLegacy المؤكد فقط، بدون حذف تاريخ قاعدة البيانات أو عقود لازمة لعمل حالي.
- Full Verify قبل الدمج ثم Verify/Deploy بعد الدمج.

في PR #105 تم تطبيق ذلك على Subscription/Billing/Trial runtime والواجهة القديمة فقط بعد فصل callers وإثبات عدم اعتماد الـsupported flow عليها. لم يتم حذف migrations تاريخية أو جداول/RPCs من Production، ولم يتم تغيير POS/Kitchen/Payments/Inventory business rules.

## عقود ثابتة لا يعاد فتحها بلا Regression مثبت

- Permission-First؛ Super Admin فقط implicit bypass.
- granular POS permissions تشمل view/create/edit/pay/split/transfer/receipt/send-kitchen.
- `send_to_kitchen` هو authority لاستهلاك المخزون؛ first send مرة ثم delta، وretry لا يكرر الاستهلاك.
- branch + warehouse isolation وRLS لا يتم تخفيفها.
- approval system enforced.
- username يظهر على الطاولة المشغولة وما يخص المستخدم حيث يلزم.
- printer management فقط لصاحب صلاحية الإعدادات.
- print once + controlled reprint، ولا physical print success كاذب.
- لا network/offline ambiguity تتحول إلى sale/payment success وهمي.
- Reports compact/tabular + filters + Excel export.
- guided prerequisite routing بدل raw errors حيث أمكن.
- Production ليست test environment.

## Settings / Permissions / Offline

- عقود Settings/Permissions الأساسية أصبحت جزءًا من العقود الثابتة أعلاه، وليست مرحلة تنظيف مفتوحة لإعادة البناء من الصفر.
- Offline/Reconciliation safeguards أُغلقت ضمن POS/Sales contracts، ولا تُفتح إلا عند Regression مثبت.
- أي تحسين UX أو Permission جديد بعد ذلك ينفذ كـscope مستقل صغير مع اختبارات، وليس بإعادة فتح المراحل المغلقة.

## المسار النشط المنفصل — Premier Print Agent

الطباعة مسار مستقل عن برنامج التبسيط المغلق.

الحالة الحالية:

- PR #78 — Windows Print Agent + cloud printing: Draft / غير مدمج.
- PR #104 — branch kitchen-station printer routing: Draft / غير مدمج.
- PR #106 — توحيد شغل Print Agent على فرع تطوير: Draft، وقاعدته `development/print-agent-unified` وليست `main`.

قواعد هذا المسار:

- لا إنشاء Station model أو Print Queue بديلة إذا الموجود الحالي يكفي.
- printer management فقط مع `settings.manage`.
- queues مستقلة لكل طابعة؛ تعطل طابعة لا يوقف الأخرى.
- Kitchen print لا يُسجل قبل نجاح `send_to_kitchen` authoritative، وأي retry للطباعة لا يكرر stock/order mutations.
- receipt print success يجب أن يعني physical confirmation حقيقية، لا success وهمي.
- لا Production migration قبل Full Verify Green وموافقة صريحة.

## NEXT ACTION

1. لا تعِد فتح PR1–PR7 إلا بوجود Regression مثبت.
2. أكمل توحيد Premier Print Agent على أحدث `main` بدون خلط الفروع المتوازية.
3. نفذ Full Verify + Windows artifact/routing/idempotency/print-truth gates قبل أي دمج للطباعة.
4. أي تطوير وظيفي جديد مثل Modifier Groups أو تحسين Catalog/POS UX يكون في PR مستقل صغير بعد فحص آخر `main`.

## التنفيذ القياسي

`Baseline -> Root Cause -> Small Change -> Focused Tests -> Integration/Regression -> Full Verify -> PR -> Merge only when allowed -> Verify main -> Deploy`

لا يُغيّر Business Logic صحيح لإرضاء اختبار خاطئ، ولا يُحذف Legacy إلا بعد إثبات الاستخدام/الاستبدال/التغطية ثم Full Verify.
