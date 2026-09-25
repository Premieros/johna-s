# CURRENT WORK PLAN — johna-s — UNIFIED SOURCE OF TRUTH

## MANDATORY EXECUTION GATE — لا عمل بدون المرور بالسجل

- Mandatory active work log: `docs/SYSTEM_CLEANUP_ROOT_FIXES_2026-09-25.md`
- Current active branch: `development/system-cleanup-root-fixes-20260925`
- Current PR: `#372`
- أي تعديل جديد في هذا المسار يجب أن يبدأ بقراءة السجل النشط وتحديث `Next action` قبل التنفيذ.
- بعد كل مجموعة تغييرات يجب تحديث `Change ledger` بحالة الملفات/المنطق الذي تغير.
- بعد أي قياس أو اختبار يجب تحديث `Verification ledger` بالنتيجة الفعلية ورقم Run إن وجد.
- لا Merge ولا Production migration ما لم يسجل `Production gate` صراحة أن exact-head Full Verify أخضر وأن موافقة Production موجودة.
- السجل هو المرجع الإجباري للعمل؛ الذاكرة والمحادثة ليستا Source of Truth.
- CI يجب أن يفشل إذا السجل الإلزامي مفقود أو ناقص البنية المطلوبة أو لا يطابق فرع الـPR.



## ACTIVE — Opening FIFO cost repair final integration — 2026-09-25

- Branch: `development/fifo-opening-repair-final-20260925`
- Base: `main@c4178c9bcdf662bdffceb855e2d2398b12200f51` (includes merged Work Authorization PR #358).
- Live log: `docs/OPENING_FIFO_COST_REPAIR_FOLLOWUP_2026-09-24.md`.
- Scope: integrate the verified FIFO opening-cost repair, raw warehouse-transfer valuation support, historical debt rebase, and orphan-sale journal fallback onto current main.
- Printing / Print Agent / routing / KDS / send-to-kitchen remain frozen and untouched.
- No direct write to main; merge only through PR after exact-head Full Verify Green.

## SINGLE-WRITER EXECUTION FENCE

- Fence document: `docs/SINGLE_WRITER_EXECUTION_FENCE.md`
- Executable branch: `development/raw-material-financial-reports-20260925`
- Execution mode: **SINGLE_WRITER**
- Parallel execution: **FORBIDDEN**
- Unexpected HEAD policy: **STOP_AND_RECONCILE**
- Write mode: **SEQUENTIAL_ONLY**
- Any other section historically labelled `ACTIVE` below is backlog/history only and MUST NOT be interpreted as concurrent execution.
- Before every repository write, fetch the executable branch HEAD and require it to equal the expected HEAD from the prior successful write/checkpoint.
- After any interruption/tool error/conflict/cancelled workflow, re-read branch HEAD + mandatory active log + this gate before resuming.
- Never attribute an unknown commit to another worker unless the user explicitly confirms another writer exists.


## ACTIVE — Work Authorization Production activation — 2026-09-25

- Branch: `development/enable-work-authorization-gate-20260925`
- Base: `main@189973bb04e6ea81e766d2cea568ccbe7ab6c8da`.
- Live log: `docs/WORK_AUTHORIZATION_UI_FIRST_2026-09-24.md`.
- Current scope: production activation only — backend migrations are applied and verified; enable the existing gate in the GitHub Pages production build.
- Live approval queue behavior remains unchanged; preview makes zero Production writes.
- Printing / Print Agent / routing / KDS / send-to-kitchen remain frozen and untouched.
- Backend/RLS/RPC/enforcement are applied on Production; only the frontend feature-flag deployment remains pending.
- No merge or Production activation without exact-head verification and explicit approval.

## ACTIVE — Performance root-fix after reports truth merge — 2026-09-24

- Branch: `development/performance-rootfix-20260924`
- Base: `main@3c1aa6047893b5f2e47be575c08e0db8dbd581b5` (includes #351 and #353).
- Live log: `docs/PERFORMANCE_ROOTFIX_2026-09-24.md`.
- First priority: eliminate Inventory Ledger statement-timeout root cause without weakening Permission-First, branch isolation, or historical visibility.
- Then: income statement, trial balance/general ledger, and confirmed UI failures, each measured before/after.
- Printing / Print Agent / routing / KDS / send-to-kitchen remain frozen and untouched.
- Production migration: BLOCKED until exact-head Full Verify Green + explicit approval.



## ACTIVE — FIFO missing kitchen-event historical sale fallback — 2026-09-22

- Branch: `development/fifo-missing-kitchen-sale-fallback-20260922`
- Base: `main@67943a445e8444e6c63ef2a382e7c2c9c056b6a6`
- Log: `docs/FIFO_MISSING_KITCHEN_SALE_FALLBACK_2026-09-22.md`
- Trigger: approved opening-cost `apply` failed closed on a historical kitchen-send ledger whose event had been deleted while its completed sale survives.
- Production rollback verification: complete; original opening repair run remains `prepared`, no valuation or quantity change occurred.
- Scope: allow only missing-event historical rows that map to exactly one completed sale, with no live order and no event-keyed journal, to propagate valuation delta directly to sale COGS.
- Production migration NOT applied. Full Verify Green + explicit approval required before retrying the opening-cost apply.


## ACTIVE — Opening inventory / FIFO cost repair — 2026-09-22

- Branch: `development/opening-fifo-cost-repair-20260922`
- Base: `main@a59f4d91035f6637e25283ef76dcd0644a39e479`
- Live log: `docs/OPENING_FIFO_COST_REPAIR_2026-09-22.md`
- Scope: repair zero-cost positive raw opening inventory valuations and replay affected FIFO historical cost through the existing tested FIFO reconciliation engine.
- Production audit: 162 zero-cost opening batches in Smouha; all have exactly one opening ledger receipt; 140 have opening-time authoritative stock-count valuation and are eligible; 1 future-only candidate + 21 with no candidate remain unresolved/review-only.
- Safety: no physical stock quantity rewrite, no recipe/payment/sale-total changes, no printing changes.
- Production migration/backfill is NOT applied. First implementation Full Verify run 35718453901 was Green; exact-head Full Verify is pending after tightened future-price exclusion. Explicit approval is still required before Production apply.


## ACTIVE — Stability / integrity monitor & historical repair — 2026-09-22

- Branch: `development/stability-integrity-repair-20260922-v2`
- Base: `main@3b994c4fa20e97fd909e9ec565eeab3ac04b159a` (includes PR #305 business-day cutoff fix).
- Live audit: `docs/STABILITY_INTEGRITY_AUDIT_2026-09-22.md`.
- Production inspection remains read-only; printing / Print Agent / routing untouched.
- Repair scope only: 12 Smouha purchase headers with wrong Cleopatra warehouse identity + 4 fully-voided stale open order shells with zero effective items and zero net kitchen inventory.
- Raw/FIFO live invariants are healthy: raw inventory vs batches 515/515 matched; FIFO pending reconciliation delta = 0.
- Migration is forward-only, exact-ID scoped, assumption-guarded and no-op on fresh/already-repaired DBs.
- Previous v1 Full Verify run `35696371462` was Green end-to-end; v2 was rebuilt on latest main and requires exact-head Full Verify again.
- Production migration is NOT applied. Merge/apply require explicit approval plus final latest-main/Production-assumption recheck.

آخر تحديث: **2026-09-19 — synchronized through PR #228**

> هذا هو السجل الحي المختصر للمشروع. للتفاصيل التاريخية راجع `docs/STABILIZATION_WORK_LOG.md` وملفات الإغلاق السابقة. سجل إصلاح POS الحالي: `docs/POS_HARDENING_REPAIR_LOG_2026-09-16.md`.


## ACTIVE — Dashboard full width / card lines / sidebar collapse — synced 2026-09-21

- Branch: `development/dashboard-width-sidebar-collapse-sync-20260921`
- Base: `main@e6447639486ae7fdd41342740871219797dbc9de`
- Log: `docs/DASHBOARD_FULL_WIDTH_SIDEBAR_COLLAPSE_2026-09-21.md`
- Recreated from latest `main` after original PR #291 became stale by 152 commits.
- Colored card edge/top lines removed; faint tint remains only.
- Dashboard expands to full available width.
- Desktop sidebar hide/show added with persisted state and RTL/LTR-safe offsets.
- No DB / RLS / business logic / printing changes.
- Exact-head Full Verify pending.



## ACTIVE — Performance repair — 2026-09-21

- Branch: `development/performance-repair-20260921`
- Base: `main@e228162c308b365db0ba76ef31c5aa638462f5b5`
- Live log: `docs/PERFORMANCE_REPAIR_2026-09-21.md`
- Confirmed bottleneck: legacy POS maximum-availability RPC repeatedly probes every active product even though client quantity is not a saleability gate and raw-material negative sell-through is allowed.
- Implemented on development branch: lightweight sellability/configuration probe, removal of inventory/settlement availability rescans, removal of 5-second dashboard audit polling, POS Realtime burst coalescing, and safer dashboard query parallelization.
- Printing / Print Agent / printer routing / KDS / send-to-kitchen authority are untouched.
- DB migration `pos_sellability_performance` **applied to Production after exact-head Full Verify Green and explicit approval**; PR #293 remains the code deployment step.

## ACTIVE — Main Area count UI / POS active-table fix — 2026-09-21

- Branch: `development/main-area-count-ui-20260921`
- Base: `main@0d5ea68eeb62f31d03844cd6769753ae34de4d31`
- Live log: `docs/MAIN_AREA_COUNT_UI_FIX_2026-09-21.md`
- Root cause confirmed from current `main`: POS realtime loaded inactive `dining_tables`, the UI still hard-coded 50, and the per-branch count had no permission-first edit action.
- Fix in progress: active-only table query + Main Area edit action in POS and floor-plan surfaces + protected branch-scoped RPC.
- No printing/KDS/payment/inventory/accounting changes.
- Full Verify pending on current development head.



## COMPLETED — Cleopatra Main Area 20 tables — 2026-09-21

- PR #288 merged to `main` at `65bf325ec243d6dbe5d1a0721db5874a122f6111`.
- Production migration `branch_main_area_table_limit` applied successfully to `azzdesuowpdcoflmyezn`.
- Cleopatra `main_area_table_count = 20`.
- Verified Production: Main Area retains 50 canonical rows, with Table 01..20 active and Table 21..50 inactive; no inactive table has a non-final order.
- Smouha remains 50 active Main Area tables.
- Detailed log: `docs/CLEOPATRA_MAIN_AREA_20_TABLES_2026-09-21.md`.



## ACTIVE VISUAL WORK — 2026-09-21

- Active branch: `development/ui-surface-accent-20260921`
- Base at start: `main@ff2152b8f9849e9c03376fb69d87c83432f795d3`
- Live plan/log: `docs/UI_SURFACE_ACCENT_PLAN_2026-09-21.md`
- Status: Phase 0 ✅ / Phase 1 ✅ / Phase 2 ✅ / Phase 3 ✅ / Phase 4 safe rollout ✅. Run #2126 was Full Green on implementation head `79741aa7e75022697aa764d03dd1900290ecfe9b`; final docs-head Verify is now required. Phase 5 visual review remains pending for Light/Dark + Arabic/English + mobile widths.
- Scope: visual hierarchy only — softer Light/Dark page surfaces, subtle accent strips/borders for cards/sections/tables/filters, and explicit typography rules (Cairo RTL / Inter LTR, weights/sizes/line-height/clipping).
- No business logic, DB migration, RLS/permissions, printing, Print Agent, KDS or send-to-kitchen changes in this branch.
- The older baseline sections below are historical and have not been rewritten by this visual-only branch; exact current Git state must be taken from the active branch/main checks recorded in the live plan.


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

- `main@a2ba244d3a710621dbb79c6cb516892e42b40cfc`
- آخر دمج مثبت: PR #228 — **sent-order settlement read-only**.
- Full Verify للـPR #228: **Run #1825 Green بالكامل**:
  - lint ✅
  - typecheck ✅
  - application/test-suite typecheck ✅
  - unit ✅
  - build ✅
  - fresh DB + schema ✅
  - integration + security/RLS ✅
  - Browser Smoke ✅
- نطاق #228 كان ملف كود POS واحد + اختبار عقد واحد فقط؛ **لا تغيير في الطباعة أو محطات الطباعة أو الوكيل أو زر/مسار الإرسال للمطبخ أو أي Migration**.
- Production Supabase الوحيد `azzdesuowpdcoflmyezn` حالته ACTIVE_HEALTHY حسب آخر فحص قراءة.
- آخر Production migration مثبتة في الفحص: `20260918202741_costing_sales_summary_kitchen_cogs`.
- أي migrations أحدث على `main` تمس الطباعة أو kitchen-send/void **مجمّدة ولا تطبق** تحت قفل الطباعة/الإرسال الحالي.
- PRs القديمة #215 و#186 و#153 أغلقت لأنها superseded/obsolete؛ لم يتم حذف أو تعديل أي PR متعلق بالطباعة أو KDS/الإرسال.

### قفل الطباعة والإرسال — CURRENT FREEZE

حتى إشعار صريح جديد من المستخدم:
- ممنوع تعديل printer stations أو routing.
- ممنوع تعديل Print Agent / Windows Agent أو آلية claim/start/complete.
- ممنوع تعديل cloud print queues أو payloads أو print migrations.
- ممنوع تعديل أزرار الطباعة أو ربطها.
- ممنوع تعديل زر `send_to_kitchen` أو kitchen dispatch/routing أو KDS بسبب هذا المسار.
- ممنوع تطبيق أي Production migration مرتبطة بما سبق.
- أي فحص لهذه الأجزاء يكون **read-only فقط** ولا يعاد فتحها بدون Regression مثبت وطلب صريح.

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

### C) POS hardening — CURRENT BASELINE

- الإصلاحات الحرجة السابقة تم دمجها تدريجيًا حتى PR #228.
- الدفع للطلب الذي سبق إرساله أصبح read-only عند فتح/إكمال التحصيل؛ لا يعيد كتابة `order_items` في مسار الدفع.
- أي إعادة فتح لإصلاح POS قديم يجب أن تبدأ من أحدث `main` مع Regression مثبت، وليس من `development/pos-hardening-20260916`.
- `send_to_kitchen` والطباعة تحت القفل الحالي ولا يدخلان في أي تعديل جديد من هذا المسار.

### D) Shift Close / Day Close — MERGED BASELINE / REGRESSION CONTRACT

عند تنفيذ إغلاق الوردية يجب أن يكون الإغلاق **عملية تشغيلية ومالية كاملة** وليس مجرد تغيير حالة الشفت.

#### سلوك إغلاق الوردية المطلوب

1. إغلاق الوردية الحالية بشكل server-authoritative بعد التحقق من الصلاحية والفرع والشفت الفعلي المفتوح.
2. إغلاق/تسوية يومية الوردية المرتبطة بها ضمن نفس المسار التشغيلي، بحيث لا تبقى اليومية مفتوحة بشكل منفصل بعد نجاح الإغلاق.
3. جميع المصروفات المسجلة داخل الوردية تُحتسب ضمن تقرير الإغلاق وتُخصم من إجمالي الإيراد للوصول إلى **صافي إيراد الوردية**.
4. يجب التفريق في التقرير بين:
   - إجمالي المبيعات/الإيراد.
   - الخصومات.
   - المرتجعات والإلغاءات/voids حيث تنطبق.
   - المصروفات.
   - صافي الإيراد بعد المصروفات والتسويات.
   - طرق الدفع Cash / Card / Transfer / Credit وأي Split Tender فعلي.
   - النقدية المتوقعة مقابل النقدية الفعلية والفرق.
5. كل الطاولات التابعة للفرع تصبح **متاحة / vacant** بعد نجاح إغلاق الوردية، بشرط ألا يتم ترك طلب تشغيلي غير محسوم دون معالجة؛ أي تعارض يجب أن يفشل الإغلاق بوضوح بدل فقد البيانات.
6. لا يجوز أن يظل طلب مفتوح أو held أو حالة تشغيلية معلقة تُخفي مبيعات/مخزون بعد الإغلاق؛ يجب أن تكون قواعد التسوية واضحة ومختبرة قبل السماح بإغلاق الوردية.
7. المصروفات يجب أن تكون مرتبطة بالفرع + الوردية + المستخدم الذي سجلها، وتظهر في تقارير الإغلاق والتقارير المحاسبية دون ازدواج.
8. إغلاق الوردية يجب أن يحافظ على Permission-First وRLS وعزل الفروع، ولا يعتمد على اسم الدور؛ Super Admin فقط implicit bypass.
9. العملية يجب أن تكون atomic/idempotent قدر الإمكان: retry لا ينشئ إغلاقًا أو تقارير أو قيودًا مكررة.

#### التقارير الإلزامية عند الإغلاق

1. **تقرير لكل مستخدم شارك في الوردية** يشمل على الأقل:
   - اسم المستخدم.
   - إجمالي مبيعاته.
   - عدد الطلبات/الفواتير.
   - طرق الدفع وقيمها.
   - الخصومات/الإلغاءات/المرتجعات المنسوبة إليه حيث تنطبق.
   - المصروفات التي سجلها إن كانت ضمن صلاحياته.
   - صافي مساهمته التشغيلية في الوردية.
2. **تقرير مجمع للوردية** يشمل جميع المستخدمين والعمليات، مع إجمالي المبيعات والمصروفات وصافي الإيراد وطرق الدفع والنقدية المتوقعة/الفعلية والفرق.
3. يجب أن تكون أرقام تقرير المستخدمين قابلة للمطابقة حسابيًا مع التقرير المجمع للوردية بدون فروق غير مفسرة.
4. التقرير المجمع وتقرير كل مستخدم يجب أن يكونا قابلين للطباعة/الحفظ ضمن نفس دورة الإغلاق، مع الحفاظ على قواعد الطباعة الحالية وعدم إعادة تصميم Print Agent ضمن هذا المسار.
5. Day Close النهائي يجب أن يعتمد على ورديات مغلقة فقط، ويمنع الإغلاق إذا بقيت وردية مفتوحة أو عملية مالية غير محسومة.

#### Acceptance Criteria لإغلاق الوردية

- بعد نجاح Close Shift: الشفت مغلق، اليومية التابعة له محسومة، والطاولات متاحة.
- `Net Revenue = Gross Revenue - Discounts/Returns/Void effects - Expenses` حسب العقد المحاسبي النهائي المعتمد، مع عدم طرح نفس الأثر مرتين.
- مجموع تقارير المستخدمين = التقرير المجمع للوردية لكل المقاييس القابلة للجمع.
- لا مصروف أو عملية بيع أو دفعة تضيع من التقرير بسبب اختلاف المستخدم أو طريقة الدفع.
- لا يمكن إغلاق الوردية مرتين أو إنشاء تقارير/قيود مكررة بالـretry.
- لا cross-branch leakage في التقارير أو الطاولات أو المصروفات.
- اختبارات مطلوبة: multi-user shift + expenses + mixed payments + returns/voids + open tables/orders + retry/idempotency + branch isolation + report reconciliation.

## العمل العالق المؤكد

1. **PR #198 — Purchase branch visibility**
   - ما زال مفتوحًا وقديمًا بالنسبة إلى `main` الحالي.
   - لا يدمج مباشرة؛ يلزم إعادة تأسيسه على أحدث `main` ثم Full Verify جديد.
   - لا Production migration قبل Green وموافقة منفصلة.

2. **PR #217 — Compact UI actions/settings**
   - Draft ومتأخر عن `main`.
   - يتضمن سطحًا قريبًا من أزرار POS؛ لا يعاد فتحه أو دمجه أثناء قفل الطباعة إلا بعد فصل أي جزء يمس زر الطباعة تمامًا.

3. **PRs #214 و#189 — KDS**
   - تترك دون تعديل ضمن هذا المسار لأن KDS/الإرسال تحت القفل الحالي.
   - لا تنظيف/دمج/إعادة تأسيس لها من هذا المسار.

4. **PR #221 — Z-report / thermal payload**
   - متعلق بالطباعة مباشرة؛ **مجمّد بالكامل** ولا يلمس.

5. **PR #132 — Android waiter app**
   - Draft / مسار منفصل.
   - لا يخلط مع النظام الأساسي ولا يدمج دون مراجعة مستقلة.

6. **Production migration drift**
   - توجد ملفات migrations أحدث على `main` من آخر Production migration المثبتة في الفحص.
   - migrations التي تمس thermal printing أو sent-item/kitchen-send تبقى غير مطبقة تحت القفل الحالي.
   - لا تتم محاولة “مطابقة Production” بإجبار migrations محظورة؛ السلامة التشغيلية مقدمة على التطابق الشكلي.

7. **توثيق وتنظيف الفروع**
   - `CURRENT_WORK_PLAN.md` هو المرجع الحالي بعد هذا التحديث.
   - عدد فروع development كبير؛ الحذف الفعلي لا يتم إلا للفروع المثبت أنها merged/superseded ولا ترتبط بمسار طباعة/إرسال نشط.

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

## Active exception — Sales Invoice actions (2026-09-21)

User explicitly requested a limited invoice-page extension while the general print-system lock remains in force. The allowed scope is UI integration with the existing protected receipt path only: customer-receipt preview (non-authorizing), protected reprint, and existing refund workflow access. Print Agent, station routing, queue RPCs, and kitchen printing remain frozen. Implementation log: `docs/SALES_INVOICE_REFUND_PREVIEW_REPRINT_2026-09-21.md`.

## Active print-form work — Professional Receipt Form (2026-09-21)

User explicitly approved a renderer-only redesign of customer and kitchen receipts. Scope is limited to the fixed `template v1` form and preview parity; Print Agent protocol, cloud queue, printer stations, routing, authorization, RLS and Production DB remain frozen. Rollback baseline and execution details: `docs/PROFESSIONAL_RECEIPT_FORM_2026-09-21.md`.

## NEXT ACTION

1. لا تعديل على الطباعة أو محطات الطباعة أو الوكيل أو أزرار الطباعة أو `send_to_kitchen`/KDS تحت القفل الحالي.
2. أي إصلاح جديد يبدأ من أحدث `main` على فرع مستقل.
3. الأولوية غير المرتبطة بالطباعة/الإرسال: إعادة تأسيس PR #198 على أحدث `main` وفحصه فقط؛ Production migration تحتاج موافقة منفصلة بعد Green.
4. PR #217 لا يلمس قبل فصل أي تغييرات مرتبطة بزر الطباعة.
5. استمر في تنظيف PRs/الفروع القديمة فقط عندما يكون superseded مثبتًا ولا توجد علاقة بمسار الطباعة/الإرسال.
6. قبل أي Merge: exact-head Full Verify Green ثم التأكد أن `main` لم يتحرك.
7. Production ليست test environment؛ لا migrations تجريبية ولا reset/reseed.

## التنفيذ القياسي

`Baseline -> Root Cause -> Small Change -> Focused Tests -> Integration/Regression -> Full Verify -> PR -> Merge only when allowed -> Verify main -> Deploy`

لا يُغيّر Business Logic صحيح لإرضاء اختبار خاطئ، ولا يُحذف Legacy إلا بعد إثبات الاستخدام/الاستبدال/التغطية ثم Full Verify.


## 2026-09-25 — Raw material reporting rebuild (in progress)
- Branch: `development/raw-material-financial-reports-20260925`.
- Added three reports: raw-material movement/consumption, current residual FIFO valuation, and finance summary/detail.
- Authoritative sources: `inventory_ledger` for period movement/COGS and `raw_material_batches` for current residual FIFO value.
- Quantity totals remain per material; financial summaries aggregate values only to avoid mixing kg/litre/piece quantities.
- No main merge and no Production migration without Full Verify green + approval.

- Added `daily_closing_range`: open date-range day closing report with one row per business day and payment-method split (cash/card/transfer/credit/legacy/other), sourced from `get_day_closing_report` so monthly/period totals reconcile to day closing.
