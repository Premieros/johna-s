# خطة Johnas: تقليل التكرار مع استمرار البيع بالسالب
Repository: `Premieros/johna-s`
Production Supabase: `azzdesuowpdcoflmyezn`
Branch: `development/kitchen-negative-stock-dedup-20261012`
Current PR: #497
Last updated: 2026-10-12
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

### P2 — أسعار الخامات المميزة مرة في الإرسال
**بدأ التنفيذ التجريبي المعزول؛ لا تفعيل إنتاج.**

Candidate: `scripts/experiments/kitchen_component_price_reuse_dispatch_candidate_20261012.sql`. Two revoked SECURITY INVOKER entry points; no canonical function replacement or trigger DDL in this script. Disposable integration tests redirect the active capture trigger inside rollback fixtures only.

Server-owned temporary context is accepted only when its owner matches the canonical dispatch owner, namespace is this backend's actual temporary namespace, client roles have no read/write access, and branch + auth actor + timestamp + transaction + fresh event id match. A client-owned namesake is ignored; the canonical reader remains the fallback. The backend-local temporary object uses ON COMMIT DELETE ROWS; context data is cleared at each fresh multi-line dispatch and at transaction commit. It is not a shared business balance/cache table. Initial creation/revoke is once per backend; repeated scope reset uses DELETE, avoiding per-send catalog creation/drop/revoke/truncate. Context is cleared at each fresh multi-line dispatch; approved raw prices and explicit unknown NULL are reused within that scope. No client GUC or supplied price is trusted; no SECURITY DEFINER shortcut.

New tests compare all three dispatch variants, try a client-owned forged table, check ACL, and prove new dispatch repricing versus frozen original resend. Benchmark counts actual approved-price reader calls as well as recipe resolver calls. Permission/source/as-of reader itself stays canonical; stock, FIFO and ledger writes unchanged.
- البناء على خطة القراءة في #496 بدل استنساخها.
- لقطة سعر معتمدة بتاريخ الإرسال لكل خامة، ثم توزيع نفس المصدر على السطور.
- المجهول NULL؛ لا أسعار مستقبلية ولا أسعار اليوم للماضي.
- وضع آلية ربط موثوقة على الخادم؛ لا ثقة بجدول مؤقت أو GUC يستطيع العميل تزويره.
- حماية الرؤية المالية وRLS. لا تعطيل لملتقط الأسعار لمجرد تسريع القياس.

### P3 — الرصيد والحركة مرة لكل مفتاح مادة/فرع/مخزن
- استخدام السلطة الموجودة؛ تصميم رصيد مخزن محفوظ فقط إذا أثبتت الحاجة والكلفة، دون سلطة منافسة.
- جمع الاحتياج المتكرر مع الحفاظ على تخصيص كل سطر ودفعة FIFO وتكلفته ودينه.
- تحديث الرصيد ذريًا مع الأقفال ومنع الخصم المتكرر.
- منع مسح التاريخ لإجابة «هل تكفي الكمية؟» في وضع البيع بالسالب.
- ضبط كل الكاتبِين معًا: إرسال، شراء، جرد، نقل، مرتجع، إلغاء، إصلاح تكلفة.
- حفظ متوسط التكلفة الموجب وآخر متوسط صحيح؛ تجميع التحديث لا يجوز أن يغيّر نتيجة نفاد الدفعات أو وصول الرصيد للصفر/السالب.
- التنفيذ المقاس في #494 ليس قرارًا نهائيًا؛ يقبل أو يرفض بحسب الحمل الكلي.

### P4 — الزيادات والتسويات
- تقييم Stage A في #494 مستقلًا: تحديث دفعة الاستلام مرة خارج حلقة الديون مع حفظ تسوية كل مصدر.
- اختبار الشراء بعد السالب والجرد المعتمد بعده والنقل والمرتجع.
- لا إعادة تسوية مرتين ولا تغيير القيود التاريخية.
- تسوية فجوة canonical migrations التي رصدها #494 قبل أي طرح، دون تكرار جداول الإنتاج.

### P5 — قبول القياس والطرح
- مقارنة baseline/candidate في نفس المخطط والبيانات والفهرس وبترتيب عينات متبادل.
- أصناف متكررة وأسطر مختلفة 1/5/20/50، وصفات متداخلة، مخازن متعددة، رصيد سالب، واستلام 12/100/2000 مصدر وفق opt-in معزول.
- قياس CPU/زمن كامل RPC، buffers/قراءات، WAL/كتابات، locks/deadlocks، p50/p95/p99 وعدد الاستدعاءات الداخلية.
- صحة: تطابق الكميات والدفاتر وFIFO/COGS ولقطات السعر وأرقام السطور ومحتوى تذكرة الإرسال.
- جلستان مستقلتان: نفس الطلب/نفس الخام/خامات مختلفة، شراء وجرد/نقل متزامن، إلغاء وإعادة إرسال.
- لا ادعاء مكسب أداء من نجاح الاختبارات الوظيفية أو عينة واحدة.
- سياسة طرح تدريجي واختبار/رجوع قبل أي موافقة على SQL إنتاج.

## Verification ledger
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
- Final new-head results pending. No performance acceptance, production DDL, merge or deployment from this step.


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
