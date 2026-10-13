# خطة Johnas: تقليل التكرار مع استمرار البيع بالسالب
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/kitchen-negative-stock-dedup-20261012`
Current PR: #497
Last updated: 2026-10-13
Execution mode: **SINGLE_WRITER**
Parallel execution: **FORBIDDEN**
Unexpected HEAD policy: **STOP_AND_RECONCILE**
Write mode: **SEQUENTIAL_ONLY**

## Work status
State: **BLOCKED** for production. User authorized continued development and explicitly requested notification before merge. Do not merge or apply production SQL. Development/testing proceeds; no production SQL, merge, deployment or real operating tests.

## Guardrails
- البيع بالسالب يبقى مسموحًا؛ لا نعيد فحص كفاية الرصيد أو حواجز stockMap القديمة.
- الصلاحيات والفرع والمخزن وقفل العملية ومنع التكرار تبقى إلزامية.
- لا حذف لديون FIFO أو الدفاتر أو القيود ولا إعادة كتابة تاريخية.
- لا تعديل للطباعة أو KDS أو الموافقات أو الدفع/الشيفت، ولا اختبارات طلبات أو طباعات في المطعم.
- التنفيذ متسلسل في هذا الفرع فقط. #492–#494 مرجع قراءة، لا مسارات تنفيذ متزامنة.
- لا جداول ظل أو مشغّل لكل دفعة لمجرد جعل قراءة واحدة أسرع. معيار القرار هو الحمل الكلي.
- الجرد يثبت الكمية المعدودة ويطبّق الفرق؛ لا يجمع الكمية المعدودة مع الرصيد القديم.
- زيادة الرصيد من الشراء/النقل/المرتجع/التصنيع/الجرد تحافظ على المصدر وصلاحياته وتسويته.

## Baseline
main 859aa9e148077e0dd02b8f596ffb339e279a23c5. #496 merged/deployed, postmerge Verify 38295468229 GREEN. Its SQL candidates remain unwired.
#494 latest reviewed head ed4db8c6e7a3155bd89b0e99bf0398f2056ba375, Verify 38259374517 GREEN. Stage A receipt batching and Stage B balance deltas are not applied.
برنامج PR1–PR7 وفصل الخدمات والصلاحيات والمصادر والتقارير والاستعادة موجود؛ لا نعيد بناء الأساسات.

## Root-cause ledger
- الإرسال يستهلك فرق الكمية فقط، لكنه يعيد حل الوصفات وتحديد الخام والأسعار وتحديثات الملخص عند تكرار الأصناف والخامات.
- current balance raw_material_inventory موجود، لكن جمع دفعات المخزن/الفرع وحارس متوسط التكلفة ما زال جزءًا من العمل.
- #494: تسوية 2000 دين تحسّنت في الاختبار المعزول؛ إرسال 50 صنفًا مختلفًا مع Stage B كان أبطأ 13.35% وWAL أعلى 4.82% وbuffer hits أعلى 46.54%. لا نفعّل هذا التنفيذ كتحسين للمطبخ.
- حراس التوافر على الكارت سبق إزالتها في #484. المطلوب تقليل أعمال حساب/تسجيل الحركة، لا حذف الحماية أو فقدان الرصيد.
- بعض كتّاب الدفعات يعتمدون على أقفال أخرى أو نداءات الآباء؛ يلزم تتبع كل المسارات قبل إعادة استخدام رصيد بين الخصومات.

## Change ledger
### P0 — المرجع والقواعد
تحديد هذا الفرع والسجل الوحيد، إغلاق الإحالة التنفيذية إلى #496 المدمج، حفظ الأدلة والقياسات السابقة. توثيق ما هو منشور وما هو تجريبي.

### P1 — مكونات الوصفات مرة لكل تكوين داخل الإرسال
**التنفيذ التجريبي قائم؛ توسعت اختبارات المقارنة والقياس، والتحقق الجديد جارٍ.**

Implementation: `scripts/experiments/kitchen_component_reuse_dispatch_candidate_20261012.sql` builds per-configuration plans and consumes them from a copied isolated canonical dispatcher. All three candidates use SECURITY INVOKER, client execution revoked; canonical FIFO and active price snapshot trigger retained. No migration or runtime wiring.

Tests: `tests/integration/kitchenComponentReuseDispatchCandidate.test.ts` runs only on loopback disposable PostgreSQL, BEGIN/ROLLBACK and SAVEPOINT replay. Compares core-versus-core quantities, per-item sends, tickets and frozen ingredient snapshots; checks negative-first selling, resend no-op and denied client execution. This does not yet cover every modifier/error/inbound/concurrency case or establish a total-load performance gain.
- إعادة استخدام حل مكونات المنتج والاختيارات المتطابقة ضمن دفعة إرسال واحدة.
- حفظ هوية كل سطر وملاحظاته وكمية فرق الإرسال والتطبيع والتقريب.
- ربط ذلك بمسار إرسال تجريبي حقيقي في قاعدة اختبار معزولة.
- إبقاء FIFO والسالب والدفاتر ولقطات السعر والحماية كما هي في هذه المرحلة.
- اختبار عدم التكرار/الفشل الكامل والعزل والوصفات المختلفة/السطر المتكرر/الخام غير المكوّن.
- لا تبنّي التحسين إذا زادت كلفة الإرسال الكلية.
- Live read-only `_ensure_pos_fallback_product_raw` review proved that fallback can create the PRODUCT recipe during dispatch. If ANY configuration of a product resolves empty or errors, ALL configurations of that product keep canonical per-line resolution. Hoisting must not hide the newly materialized base recipe from a later modifier configuration. New replay test uses repeated plain lines then an extra ingredient, and proves three auto-raw deductions plus the extra raw, with the recipe initially unconfigured.

### P2 — أسعار الخامات المميزة مرة في الإرسال
**بدأ التنفيذ التجريبي المعزول؛ لا تفعيل إنتاج.**

Candidate: `scripts/experiments/kitchen_component_price_reuse_dispatch_candidate_20261012.sql`. Two revoked SECURITY INVOKER entry points; no canonical function replacement or trigger DDL in this script. Disposable integration tests redirect the active capture trigger inside rollback fixtures only.

Server-owned temporary context is accepted only when its owner matches the canonical dispatch owner, namespace is this backend's actual temporary namespace, client roles have no read/write access, and branch + auth actor + timestamp + transaction + fresh event id match. A client-owned namesake is ignored; the canonical reader remains the fallback. The backend-local temporary object uses ON COMMIT DELETE ROWS; context data is cleared at each fresh multi-line dispatch and at transaction commit. It is not a shared business balance/cache table. Initial creation/revoke is once per backend; repeated scope reset uses DELETE, avoiding per-send catalog creation/drop/revoke/truncate. Context is cleared at each fresh multi-line dispatch; each product configuration is resolved once for deduction, and all known raw IDs are sent together to ONE canonical approved-price lookup; approved raw prices and explicit unknown NULL are reused within that scope. The capture trigger lazily reads only new materials not in the resolved set, such as a newly created fallback raw. No client GUC or supplied price is trusted; no SECURITY DEFINER shortcut.

New tests compare all three dispatch variants, try a client-owned forged table, check ACL, and prove new dispatch repricing versus frozen original resend. Benchmark counts actual approved-price reader calls as well as recipe resolver calls. Permission/source/as-of reader itself stays canonical; stock, FIFO and ledger writes unchanged.
- البناء على خطة القراءة في #496 بدل استنساخها.
- لقطة سعر معتمدة بتاريخ الإرسال لكل خامة، ثم توزيع نفس المصدر على السطور.
- المجهول NULL؛ لا أسعار مستقبلية ولا أسعار اليوم للماضي.
- وضع آلية ربط موثوقة على الخادم؛ لا ثقة بجدول مؤقت أو GUC يستطيع العميل تزويره.
- حماية الرؤية المالية وRLS. لا تعطيل لملتقط الأسعار لمجرد تسريع القياس.

### P3 — الرصيد والحركة مرة لكل مفتاح مادة/فرع/مخزن
**تنفيذ تجريبي لتجميع الخامات المتكررة غير الموجبة؛ لا تفعيل إنتاج ولا تجميع عام للخامات الموجبة.**

New isolated script: `scripts/experiments/kitchen_negative_reuse_dispatch_candidate_20261013.sql`. Three client-revoked SECURITY INVOKER functions. Starting from the P2 dispatcher, only fixed plans with repeated raw IDs qualify. If ANY product can materialize a fallback recipe, the whole send skips this stock reuse. Known materials are locked in UUID order using the canonical material+branch advisory key before the initial read. A raw qualifies only when it has NO positive batch anywhere in the branch, not merely a negative warehouse net. Warehouse quantity is read once and carried as internal JSON through each deduction; separate OV batch, ledger before/after boundary and FIFO debt stay per source. Original oversold-price/work-authorization triggers remain enabled. Official raw_material_inventory is recomputed from canonical batches once per eligible raw at the end, under the same held locks. No competing persistent balance table, no client GUC, no quantity sufficiency gate. Positive, unique and dynamic materials use canonical FIFO/summary behavior; the original average guard remains active. In this fully nonpositive interval there is no new positive average to lose; positive-to-zero exhaustion deliberately bypasses reuse.

Four additional component cases cover actual summary-write counts, ledger/effect/debt/snapshot and resend parity, another warehouse's positive batch forcing canonical behavior, last positive average on FIFO exhaustion, and private invoker ACL. The existing invalid-later-line case now begins with repeated negative deductions and checks complete rollback for all FOUR variants. Benchmark measures actual summary row writes, with an identical temporary audit trigger on all sides, 1/5/20/50 positive/negative repeated/shared/unique raw profiles, warmup plus seven alternating samples. New exact-head verification pending. Audit callback overhead is included in all measurements; this is not uninstrumented production latency.

Read-only live catalog audit reconfirmed 11 direct raw-batch writers. Absence of a direct advisory call is not automatically an unguarded quantity write: `_fifo_adjust_warehouse_transfer_delta` changes destination batch cost and summary average under transfer/batch row locks; `update_purchase_invoice` delegates quantity reversal/replacement to canonical purchase helpers and directly rewrites created_at. Administrative seed/delete paths still need maintenance/lock reconciliation. No private cached warehouse quantity is activated.

`apply_stock_count` currently reads warehouse quantity before its canonical raw helper takes the material lock. The isolated `_apply_stock_count_material_lock_candidate` now prelocks all counted raw IDs in UUID order, using the EXACT same material+branch key as `_raw_add`/`_raw_remove_fifo`, before reading variance. All original branch/permission checks, inbound/FIFO, accounting and terminal-count rules retained. New function is SECURITY INVOKER and client execution revoked.

`tests/integration/kitchenCountMaterialLockCandidate.test.ts`: localhost only, two DB connections, a material lock held in the second session, lock_timeout and no partial stock/count mutation, unrelated material lock availability, then a real canonical kitchen deduction into negative stock before applying the precreated physical count. Checks counted quantity replaces the warehouse net, another warehouse is unchanged, one balanced journal, no retry reapply and frozen send snapshot. This is lock exclusion + sequential recovery, NOT simultaneous committed quantity writers or complete writer-throughput/deadlock proof.
- استخدام السلطة الموجودة؛ تصميم رصيد مخزن محفوظ فقط إذا أثبتت الحاجة والكلفة، دون سلطة منافسة.
- جمع الاحتياج المتكرر مع الحفاظ على تخصيص كل سطر ودفعة FIFO وتكلفته ودينه.
- تحديث الرصيد ذريًا مع الأقفال ومنع الخصم المتكرر.
- منع مسح التاريخ لإجابة «هل تكفي الكمية؟» في وضع البيع بالسالب.
- ضبط كل الكاتبِين معًا: إرسال، شراء، جرد، نقل، مرتجع، إلغاء، إصلاح تكلفة.
- حفظ متوسط التكلفة الموجب وآخر متوسط صحيح؛ تجميع التحديث لا يجوز أن يغيّر نتيجة نفاد الدفعات أو وصول الرصيد للصفر/السالب.
- التنفيذ المقاس في #494 ليس قرارًا نهائيًا؛ يقبل أو يرفض بحسب الحمل الكلي.

### P4 — الزيادات والتسويات
**بدأ التنفيذ التجريبي المستقل 2026-10-13؛ لا تفعيل إنتاج.**

`scripts/experiments/raw_fifo_receipt_reuse_candidate_20261013.sql` copies the read-only live receipt/add definitions into revoked SECURITY INVOKER candidates. No canonical replacement, new index, trigger wiring or Stage B balance deltas. Successful sale/kitchen debt reconciliations accumulate a pending receipt reduction, flushed once at completion. Before any production/transfer/other source reconciliation, pending receipt changes are flushed in canonical order: those propagation paths can mutate downstream stock and are not assumed equivalent under deferred quantity. All debt/estimate/source ledger/COGS and oversold batches still update per source.

`tests/integration/rawReceiptReuseCandidate.test.ts` is loopback-only BEGIN/ROLLBACK. It requires the estimate tables from canonical migration replay, reconstructs the otherwise identical live baseline and replays partial/zero-cost/final receipts, estimates and retry; tests later-source failure rollback and multiwarehouse isolation. A transactional audit trigger counts actual receipt batch row updates: assertions expect 6→3 across three receipts and 100→1 for a 100-source receipt. Timing/buffers/WAL are exploratory single samples with audit overhead on both sides, not performance acceptance. Verification pending on the new HEAD; do not carry forward the previous green status to these files.

- تقييم Stage A في #494 مستقلًا: تحديث دفعة الاستلام مرة خارج حلقة الديون مع حفظ تسوية كل مصدر.
- اختبار الشراء بعد السالب والجرد المعتمد بعده والنقل والمرتجع.
- لا إعادة تسوية مرتين ولا تغيير القيود التاريخية.
- Restored two historical files VERBATIM from production supabase_migrations.schema_migrations: 20260925000002_raw_fifo_prior_price_fallback and 20260925122552_raw_fifo_prior_price_prepare_null_guard. These exact versions/names are ALREADY APPLIED in production; this is repository history recovery, not newly authored privileged functions or permission bypasses. Their existing restricted service-role grants and RLS remain verbatim. No historical prepare/apply/reverse was executed, no production migration was applied. New CI must replay them and all later canonical migrations. The regression fixture no longer synthesizes any estimate tables; all three canonical tables/ACL/RLS must exist. Do not rerun historical files blindly on production, and do not infer every remaining live/replay difference is reconciled.
- The source-boundary mixed propagation regression observes the receipt quantity before the generic reference adjustment: canonical 3 writes versus candidate 2, same error/settlement state. Actual recursive production/transfer acceptance remains open.

### P5 — قبول القياس والطرح
- مقارنة baseline/candidate في نفس المخطط والبيانات والفهرس وبترتيب عينات متبادل.
- أصناف متكررة وأسطر مختلفة 1/5/20/50، وصفات متداخلة، مخازن متعددة، رصيد سالب، واستلام 12/100/2000 مصدر وفق opt-in معزول.
- قياس CPU/زمن كامل RPC، buffers/قراءات، WAL/كتابات، locks/deadlocks، p50/p95/p99 وعدد الاستدعاءات الداخلية.
- صحة: تطابق الكميات والدفاتر وFIFO/COGS ولقطات السعر وأرقام السطور ومحتوى تذكرة الإرسال.
- جلستان مستقلتان: نفس الطلب/نفس الخام/خامات مختلفة، شراء وجرد/نقل متزامن، إلغاء وإعادة إرسال.
- لا ادعاء مكسب أداء من نجاح الاختبارات الوظيفية أو عينة واحدة.
- سياسة طرح تدريجي واختبار/رجوع قبل أي موافقة على SQL إنتاج.

## Verification ledger
### Canonical binding rehearsal — 2026-10-13
- First rehearsal Fast DB 115198804838 on 0a4989c8c0a8a2936a59c670a7c91eab0c591715 caught a REAL assembly error: capture uses $capture$, but the generator assumed $function$ and extracted the following dispatcher body into a trigger function. No production application. Fixed extraction to detect each actual dollar delimiter and reject crossing a function boundary; trigger body validated to return NEW. Reverification mandatory, not green yet.
- Added `tests/integration/kitchenCanonicalCommittedConcurrency.test.ts`, enabled ONLY in GitHub CI on loopback. It creates its OWN random qa_kitchen database, replays canonical migrations/CI stubs and rehearsal there, commits real transactions, then closes clients and drops only that owned database. Shared integration DB remains untouched; no Supabase/restaurant access.
- Two committed scenarios: two authenticated sends for the SAME order (second must visibly block behind first PID, then return zero fresh items after COMMIT); send into deeper negative followed by authorized physical count (wait under exact material key, then read newly committed quantity, settle debts, apply physical 2, balanced journal and retry no-op). Independent raw lock and frozen prior component snapshots checked. This is two scenarios, NOT exhaustive all-writer throughput/deadlock/CPU/p95 acceptance.

- Previous exact head b5db453e9d0546f95b1ee5b5e27139dcf5c7ffd3 passed Fast 38357319642 and Full 38357325296: 1708 frontend, 1028 DB/RLS, 132 Chromium, no retries.
- Added `scripts/experiments/kitchen_canonical_binding_rehearsal_20261013.sql`: LOCAL ONLY, not a migration or authorized production rollout. Rebinds four existing canonical function bodies to the tested candidates while retaining their live signatures/security/search_path. No new privileged function, ACL/RLS/trigger/table/index change. Dependency helpers remain revoked invokers.
- New public wrapper fixture calls authenticated send_to_kitchen for original and bound definitions; compares stock/debt/ledger aggregates, frozen snapshots and tickets; checks resend no-op. Second session holds the exact material lock: bound send must return timeout without stock/send mutation, then succeed after release. This is lock exclusion/recovery, not committed multi-writer throughput/deadlock proof.
- Asserts canonical function OIDs, owner, security modes, search_path and ACL remain identical; original trigger definition/OID/enabled state unchanged. SAVEPOINT rollback must restore exact original function definitions. New exact-head CI pending.
- Production binding/rollback package, maintenance policy and full COMMIT/concurrency acceptance remain OPEN. No SQL was applied to production; read-only catalog confirmed unchanged live fingerprints before preparing rehearsal.


### Continued execution — 2026-10-13
- P4 and restored canonical FIFO history on d5e1ec201a3d6e11e574213719dafb5108bc988f passed Fast 38354663814 and Full 38354669323: 1708 frontend, 1024 DB/RLS, 132 Chromium, no retries. Archived files verified byte-for-byte against production migration statements; restored receipt body matches the live body. P4 100-source receipt: actual receipt row writes 100→1; full DB sample 60.223→51.320ms, WAL 331318→284559, shared hits 33102→26482. One instrumented isolated sample, NOT whole purchase/COMMIT or production acceptance.
- P3 exploratory Fast DB 115161485088 on 56576949e4af25b34367bed5fc99b43634eeeb3a passed parity/counter benchmark but failed two new fixture assertions: prior avg summary was never established (canonical also 0), and create_order selected the newly introduced positive warehouse (canonical also consumed there). Fixed by establishing the actual prior positive official summary and pinning replay order warehouse. No production effect; require new exact-head verification. Do not accept the failed run as green or present its timing as final acceptance.
- Continued into the P3 negative-only repeated-material prototype after the full run succeeded. New head requires its own tests. P3/P4 probes do not authorize production, replace all-writer concurrency acceptance or prove maintenance writers coherent.
- Prior HEAD ad4df5a34836c560617276e59353bd8dfa3995a7 passed Fast 38313001246 and Full 38313007263: 1708 frontend, 1018 DB/RLS and 132 Chromium, no retries.
- P4 receipt candidates and six regression/measurement cases added. New exact-head CI required; P3 bulk balance aggregation, production/transfer recursive propagation parity, full remaining schema audit, whole-RPC/COMMIT and concurrency acceptance remain open.
- No merge, deploy, production SQL or restaurant test orders/prints.

### Follow-up execution — 2026-10-12
- Previous exact-head 2a6ab0e4d9c7055ecfd00da4bd359a9e6b0d3faf: Full Verify 38304278383 succeeded, 1702 frontend + 1007 DB/RLS; browser 129 passed + one 390px scrolling test passed only on retry.
- Closing sidebar remains geometrically over the document during its 200ms transform. Layout now disables pointer events immediately while closed, with explicit desktop visibility override. This is a cause hypothesis backed by a no-retry repeated close/scroll regression; new CI must prove it.
- Added six open/close/scroll cycles each at 390px and 1366px, retries=0, with hit-test ownership assertions. No fixed sleeps or relaxed scrolling assertions.
- Expanded P1 parity to stock batches, official balance, ledger quantity/cost aggregates and debt quantities, modifiers, invalid later-line atomic rollback, fallback and branch/auth rejection.
- Added rollback-replayed full-core EXPLAIN ANALYZE/BUFFERS/WAL for 1/5/20/50 repeated or distinct configurations at positive and zero/negative stock, warmup + seven alternating samples each; actual resolver call counts checked through pg_stat_xact_user_functions. Same indexes, FIFO and price capture both sides. This is core-versus-core, not outer send wrapper or end-to-end browser/print latency; small-sample empirical p95 is not production p95.
- First exploratory run (Fast Verify 38306838973, DB job 115003021199) passed eight candidate tests. Repeated 50 lines: resolver calls 50→1, seven-sample median core time 188.012→155.274ms, shared hits 34402→31742, median WAL 299855→292088 bytes. Distinct configurations did not show a stable benefit; candidate now bypasses planning when all configurations are unique. Final remeasurement includes positive and negative stock, per-line ledger/effect costs and known/unknown/as-of price snapshots.
- Added candidate-only static safety contracts; no new privileged helper or production wiring.
- Verification caught and corrected a bypass edit scoped to the wrong SQL function body (42601), plus stale source-string direction expectations; no production effect. Rebuilt from the verified candidate baseline, restricted the replacement to the dispatch function, and asserted both helper bodies are unchanged. Direction and pointer ownership expressions are now independent. Exact new-head rerun required.
- Corrected P1 Fast DB job 115006908978 on e8fb806fafa9485d2219e7c0878f3352f79740bb passed all eight expanded tests. Negative repeated 50: resolver 50→1, median time 196.409→169.940ms, hits 41452→38860, WAL 322404→323777 bytes (+0.43%). Positive repeated 50: 165.526→155.900ms; no stable distinct-configuration gain. P1 proves resolver reduction, NOT reduced operational writes. Seven exploratory samples; full/RLS/browser/latest P2 results still required.
- P2 now implemented behind separate isolated entry points; measure ownership checks/temp-context overhead and do not assume it wins. P3/P4 concurrency and canonical replay drift remain open.
- First P2 Fast DB job 115009021473 on ba76ca8b86ccc2f77bfd4b5ad713db2e38639001 passed 11 tests including forged-temp-context rejection, private ACL and frozen resend/new-price lifetime. Reader calls 50→1; negative repeated-50 median 164.672→113.577ms, but WAL 323758→347841 (+7.44%). Five-line catalog churn was worse. This DROP-per-transaction context lifetime is REJECTED as a total-load improvement.
- P2 revised to backend-local ON COMMIT DELETE ROWS, create/revoke once and DELETE per new scope. Benchmark reports first context creation separately, then identical warm-backend savepoint replays. This is an explicit first-use/steady split, not a claim that new backend connections are free. The first-use penalty, pooled lifecycle and RLS/security remain production gates.
- P2 backend-reuse DB job 115010728779 passed 11 tests. First context creation sample: baseline 32287 WAL bytes vs 41975 (one-time +9688); object startup is not free. Warm repeated-50 negative median 170.163→118.868ms, WAL 307135→314335 (+2.34%); repeated-50 positive 129.523→79.144ms. This iteration retained canonical temporary worktables in the fixture transaction, so revised final benchmark now recreates canonical ON COMMIT DROP worktables for BOTH variants, while retaining only the protected empty price context. Never present the earlier warm setup as exact PostgREST transaction behavior.
- P3 count-lock prerequisite and two-session/recovery tests added. Quantity aggregation, all-writer concurrency, receipt/debt replay drift and real production acceptance remain OPEN.
- Expanded final benchmark distinguishes repeated products, distinct products sharing one raw, and distinct products with genuinely distinct raws; prior distinct-product observations were SHARED-RAW fixtures, not 50 independent materials. P2 now preloads all resolved materials through a single canonical reader call, avoiding lazy per-material reader overhead for genuinely distinct recipes. Canonical working-table recreation and first-context catalog cost remain explicit.
- Hardened the hostile-table fixture: valid actor/branch/as-of/transaction/event id plus forged approved-looking price 999 must still yield canonical price 7. This proves refusal with otherwise valid scope, not merely malformed metadata.
- UI input classes now explicitly independent of direction classes; final static and no-retry browser checks must pass.
- Latest exact-head verification and benchmark results are recorded in PR #497 and its GitHub Actions checks; pending is never a merge/production approval. Final new-head run is pending. No performance acceptance, production DDL, merge or deployment from this step.


Implementation commits: be52d830063c0becba52279edb3b3f30190336ba; first parity tests c2bc78320b92c5ec5ac54c6b8eb6a6c37e74a028, fixture cleanup ef618e0a1070a01eef87c7cdc330c1886b552b0d. CI must be evaluated at the latest documentation head; pending is not green.

- Main/head and open PRs read before branch creation; no unknown baseline accepted.
- Previous worklog and cancelled-scope guard reviewed. No cancelled management/treasury scope revived.
- First implementation and executable tests will record exact results below.
- Isolated database tests only; no production mutation or print ticket.

## Production gate
State: **BLOCKED**
Full Verify on exact final head + proven total-load/correctness improvement + permission/schema/concurrency reconciliation + reviewed rollout + separate owner approval. P1/P2/P3/P4 can be accepted/rejected independently. No automatic migrations from experimental scripts.

## Next action
Complete expanded parity and full-core benchmark, inspect any regressions and record measured acceptance/rejection. Resolve sidebar gesture ownership via no-retry regression. Verify P2 security/parity and full-core total-load results, then trace and reconcile all P3/P4 writers before any stock-summary reuse or deployment. Keep existing production stock and printing behavior.

## Mandatory update protocol
Fetch branch HEAD before every sequential write and require exact expected SHA. Record coherent changes/results. On interruption/error, re-read HEAD, this log and CURRENT_WORK_PLAN. Stop writes during exact-head verification except a real failure or explicitly directed new scope.


### Guarded rollout review package — 2026-10-13
- Exact head f8a97bedec57f76b6350f4392018acb68e822a75 completed Fast 38369465257 and Full 38369473113: 1708 frontend, 1031 DB/RLS, 132 Chromium; no retries. Main remained 859aa9e148077e0dd02b8f596ffb339e279a23c5.
- Added scripts/rollout/kitchen_dedup_forward_review_20261013.sql and kitchen_dedup_rollback_review_20261013.sql. REVIEW ONLY, outside migrations and automatic deployment. Self-contained: three new client-revoked SECURITY INVOKER helpers plus four existing canonical bodies, no dependency on experimental dispatch functions. Existing canonical security modes/owner/ACL are retained, no new definer bypass.
- Read-only production catalog reconfirmed original bodies/owner/security/search_path/ACL. Forward tripwires require those exact values and absence of the new helper identities. Rollback requires the expected bound bodies and untouched helper definitions, restores exact archived original definitions and drops only its three helpers without CASCADE. It reverses code, not completed business transactions or historical valuation.
- Both files own BEGIN/COMMIT, use bounded lock/statement timeouts, require postgres and explicit app.kitchen_rollout_ack review acknowledgement. This acknowledgement is an operator mistake guard, NOT user approval or authorization. Connection identity must separately be verified by scripts/db/verify-database-identity.js for project azzdesuowpdcoflmyezn; no credentials are embedded.
- Owned loopback CI database now uses the self-contained package instead of loading experimental candidates. New case rejects missing acknowledgement and changed search_path before helper installation, checks exact code/ACL rollback and unchanged stock, then reactivates for both committed concurrency cases. New HEAD requires fresh CI; old green result is not current approval.
- Maintenance policy remains an explicit production BLOCKER: no seed/delete, opening/backfill/repair or deployments overlapping operational stock transactions. Activation/rollback require a quiet maintenance window with no in-flight kitchen/count/purchase/transfer writers, identity confirmation and separate owner approval. The package does not retrofit global writer locks or enforce this operational window automatically. Code rollback must follow the same quiescence, including draining connections using the new bodies; otherwise no activation.
- Broad purchase/transfer/reversal concurrency, recursion acceptance, full RPC/COMMIT tails/CPU and production maintenance enforcement remain OPEN. No merge, deployment or production SQL mutation performed.

- Initial package Fast DB 115222490229 on 94e1cab19dae39cf3d1dc9d3960b12ae7c738dfb failed the new roundtrip case (27 passed/1 failed): archived pg_get_functiondef strings lacked statement terminators between restored functions, producing syntax error before guard execution. Forward canonical body/ACL tripwires and both committed writer scenarios passed. Added explicit SQL terminators to the rollback assembly; original function bodies are unchanged. New exact-head reverification required; no production application.
