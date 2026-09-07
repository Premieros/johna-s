# POST-REPAIR DEVELOPMENT PLAN

> هذه الخطة لا تبدأ قبل إغلاق الإصلاحات النشطة الحالية والتحقق منها. الهدف: منع خلط التطويرات الجديدة مع bug-fix batches وحماية العقود المغلقة.

## قاعدة التنفيذ
- أكمل الإصلاحات الحالية أولًا، وأغلق كل batch عبر: Regression -> Full Verify -> Merge -> Production migration/parity عند الحاجة -> Post-Check -> merged-main Verify -> Deploy/Runtime verification.
- لا يبدأ أي بند تطوير جديد داخل PR إصلاح قائم إلا إذا كان جزءًا مباشرًا من root cause نفسه.
- قبل كل WRITE: اجلب HEAD الحالي لـ`main` و`development/final-handover` وراجع أي commits متوازية.
- لا force push. لا weakening لـRLS/tests. Super Admin فقط implicit bypass؛ باقي الأدوار Labels.
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`.

## نقطة البدء
1. إغلاق Stage 4.1 / PR #47 — Shift Cash Integrity + Branch Scope.
2. إغلاق Stage 4.2 — POS Operator Ownership & Table Transfer، وهو جزء من الإصلاحات وليس تطويرًا اختياريًا.
3. إكمال Stage 4 Runtime/Zero-Drift + Stage 3 Printing + Stage 2 Release Hardening + Stage 1 Handover.
4. بعد انتهاء الإصلاحات والتسليم التشغيلي المستقر، تبدأ التطويرات التالية بالترتيب أدناه.

## التطويرات المعتمدة بعد انتهاء الإصلاحات

### D1 — POS Permission Matrix Finalization
- فصل صلاحيات: view/create/edit/pay/discount/cancel/hold/split/transfer/print/reprint.
- اختبار كل صلاحية منفردة وعدم ربط التنفيذ باسم Role.

### D2 — Table Lifecycle Finalization
- Available -> Occupied -> Kitchen -> Ready -> Paid -> Available.
- عرض employee owner + guest count + opened time.
- split/merge/transfer بصورة آمنة.
- منع concurrent edits لنفس الطلب/الطاولة.

### D3 — POS Concurrency Safety
- منع جهاز ثانٍ من الكتابة فوق نسخة أقدم من Order.
- version/conflict detection + safe refresh/retry policy.
- idempotency للعمليات المالية الحساسة.

### D4 — KDS / Kitchen Final Contract
- first send مرة واحدة فقط.
- delta send للتعديلات اللاحقة.
- controlled void للصنف المرسل.
- station routing + New/Preparing/Ready/Served.
- عدم double inventory deduction.

### D5 — Inventory + Cost End-to-End
- Purchase -> Stock -> BOM/Components -> Sale -> Consumption -> Return/Void -> Cost.
- تحقق من branch/warehouse isolation ومنع stock drift.

### D6 — Guided Routing
- لا فرع -> اختيار/إنشاء فرع.
- لا مخزن -> إعداد مخزن.
- لا Shift -> فتح وردية.
- إعداد ناقص -> توجيه للمكان الصحيح بدل raw error.

### D7 — Operational Alerts
- Low stock.
- KDS delay.
- drawer/shift variance.
- failed printing.
- pending approvals.
- delivery delays where applicable.

### D8 — Printing Professionalization
- receipt + kitchen/station tickets.
- print once / reprint permission.
- audit لمن طبع ومتى ولماذا أعاد الطباعة.
- shift close + day close reports.

### D9 — Offline / Reconciliation
- التركيز على POS والوردية فقط حيث يلزم.
- connection state واضح.
- safe queue + idempotency + reconciliation عند عودة الاتصال.
- منع تكرار payment/order close بعد reconnect.

### D10 — Unified Audit Center
- discounts, voids, refunds, transfers, reprints, drawer open, cash in/out, shift close, manager overrides.
- actor / branch / before / after / timestamp / reason حسب العملية.

### D11 — Reports Finalization
- صفحة تقارير موحدة ومنظمة بلا charts مزدحمة.
- filters: branch/date/payment/employee/product/order type.
- totals + custom columns + Excel export.
- sales/discounts/refunds/voids/shift variance/inventory/cost.

### D12 — UX Final Polish
- Arabic RTL primary + English LTR.
- desktop/tablet/mobile.
- touch-friendly POS.
- product-area scrolling + clear states Loading/Empty/Error.
- permission-aware actions without breaking server-side enforcement.

### D13 — Security + Release Completion
- Leaked Password Protection + auth regression.
- protect `main` + required checks.
- final full E2E + published runtime smoke.

## Definition of Done لكل تطوير
- Root contract موثق قبل الكتابة.
- Regression tests تغطي success/denied/cross-branch/concurrency حسب الحاجة.
- لا duplication للbusiness logic بين UI وDB/RPC.
- Full Verify أخضر قبل الدمج.
- Production parity مثبت بعد أي migration.
- تحديث السجلات باختصار بعد الإغلاق.

## الأولوية
`صلاحيات POS -> دورة الطاولات -> concurrency -> KDS -> inventory/cost -> guided routing -> alerts -> printing -> offline -> audit -> reports -> UX -> security/release finalization`.
