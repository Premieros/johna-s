# POS HARDENING REPAIR LOG — 2026-09-16

الحالة: ACTIVE

الفرع: `development/pos-hardening-20260916`

Baseline: `main@2901a3c58533706c80f61bdf670f758c6f3b598e`

الغرض: إصلاح ثغرات/فجوات نقطة البيع المكتشفة في مراجعة 2026-09-16 بدون إعادة بناء POS وبدون لمس `main` مباشرة.

## ثوابت التنفيذ

- Repository الوحيد: `Premieros/johna-s`.
- Production Supabase الوحيد: `azzdesuowpdcoflmyezn`، ولا يتم أي Production migration بدون Full Verify Green + موافقة صريحة.
- Permission-First؛ Super Admin فقط implicit bypass.
- ممنوع تخفيف RLS أو الاختبارات.
- `send_to_kitchen` يظل authority لاستهلاك المخزون: first send ثم delta فقط.
- لا تغيير في Print Agent / printer routing / queues خارج إصلاح محدد وموافق عليه.
- لا خلط مع `development/mobile-delivery-app` أو أي فرع مشروع آخر.
- أي إصلاح يجب أن يحتوي على focused regression test قبل اعتباره مغلقًا.

## قواعد POS المعتمدة لهذه المرحلة

1. طباعة الحساب من الطلب المفتوح **مسموحة** لأن الطلب يظل مفتوحًا أثناء عرض الحساب للعميل.
2. الطباعة تحتاج صلاحية `pos.receipt.print`.
3. زر الدفع لا يظهر/لا يتاح إلا بعد أول إرسال فعلي للمطبخ.
4. الدفع يحسب **الكميات المرسلة للمطبخ فقط**؛ الإضافات غير المرسلة لا تدخل في مبلغ الدفع.
5. الطباعة من الطلب المفتوح تطبع **الكميات المرسلة للمطبخ فقط**؛ الإضافات غير المرسلة لا تدخل حتى يتم إرسالها.
6. الإضافات اللاحقة تدخل في الدفع/الطباعة بعد `send_to_kitchen` كـdelta ناجح.
7. صلاحية الدفع هي `pos.payment.take`، وصلاحية الطباعة هي `pos.receipt.print`.
8. المستخدم الذي يملك View فقط لا يحصل ضمنيًا على Edit/Pay/Transfer/Cancel/Print.

## خطة الإصلاح

### P0 — صلاحيات ومسارات مالية

- [~] ربط زر/handler إلغاء الطلب بـ`pos.cancel_order` في الواجهة، مع إثبات أن السيرفر يفرض نفس الصلاحية والـbranch scope. **UI action gated؛ server audit ما زال مفتوحًا.**
- [~] ربط نقل الطلب بين الطاولات بـ`pos.order.transfer` في جميع نقاط الدخول. **Header + table-card entry points gated؛ handler/server atomic audit ما زال مفتوحًا.**
- [x] منع عرض زر الدفع للمستخدم الذي لا يملك `pos.payment.take` في شريط الطلب وقائمة الطلبات النشطة.
- [~] منع عرض/تنفيذ الطباعة بدون `pos.receipt.print` مع الحفاظ على Super Admin implicit bypass فقط. **الزر permission-gated؛ sent-only payload ما زال مفتوحًا.**
- [ ] إنشاء contract موحد لحساب `sent-only payable/printable items` من `order_items + kitchen sends`.
- [x] جعل زر الدفع يظهر فقط بعد وجود كمية مرسلة فعليًا للمطبخ.
- [ ] منع الدفع عن أي quantity غير مرسلة للمطبخ.
- [ ] منع طباعة quantity غير مرسلة للمطبخ من الطلب المفتوح.

### P0 — سلامة نقل الطاولات

- [ ] استبدال النقل الحالي متعدد الاستعلامات بعملية server-authoritative atomic transaction/RPC إذا لم يوجد RPC صحيح بالفعل.
- [ ] العملية يجب أن تتحقق من: permission + branch + source/target table state + order status + ownership/concurrency.
- [ ] تحرير الطاولة القديمة وتشغيل الجديدة وتحديث order.table_id في transaction واحدة.
- [ ] إضافة regression test لفشل منتصف العملية والتأكد من عدم وجود partial state.

### P1 — Kitchen / Audit / concurrency

- [ ] مراجعة `send_to_kitchen` للتأكد أن `sent_by` يؤخذ server-side من `auth.uid()` عند عدم تمريره، ولا يمكن spoof identity.
- [ ] اختبار simultaneous send من جلستين/جهازين وإثبات delta idempotency وعدم تكرار خصم المخزون.
- [ ] التأكد أن كل kitchen send/void يسجل المستخدم الفعلي في audit trail.

### P1 — Active Orders / View-only

- [ ] فصل واضح بين View / Resume / Edit / Pay في Active Orders.
- [ ] المستخدم View-only يمكنه عرض الطلب فقط بدون تعديل كميات/خصم/عميل/طاولة.
- [ ] المستخدم Pay-only يمكنه فتح طلب مرسل للمطبخ للدفع بدون اكتساب Edit.
- [x] إخفاء Pay/Cancel/Transfer من نقاط الدخول التي تمت مراجعتها عندما لا توجد الصلاحية المناسبة.

### P1 — Warehouse authority

- [ ] مراجعة عقد اختيار warehouse للطلب الجديد.
- [ ] إثبات أن POS availability وsend_to_kitchen وsettlement تستخدم نفس authoritative warehouse.
- [ ] منع silent fallback لمخزن مختلف إذا كان order مربوطًا بـ`inventory_warehouse_id`.

## اختبارات القبول الإلزامية

### Sent-only settlement

- [ ] أنشئ طلبًا بصنف A كمية 2، أرسله للمطبخ -> Pay يظهر.
- [ ] أضف صنف B كمية 1 بدون إرسال -> Pay/Print يحسب A فقط.
- [ ] أرسل B كـdelta -> Pay/Print يصبح A+B.
- [ ] عدل كمية صنف مرسل بإضافة quantity جديدة بدون إرسال -> الزيادة لا تدخل في Pay/Print.
- [ ] بعد إرسال الزيادة -> تدخل مرة واحدة فقط.

### Permissions

- [ ] `pos.view` فقط: عرض دون Edit/Pay/Transfer/Cancel/Print.
- [ ] `pos.payment.take` فقط مع view اللازم: يستطيع دفع sent-only ولا يستطيع edit/transfer/cancel.
- [ ] `pos.receipt.print` فقط مع view اللازم: يستطيع طباعة sent-only ولا يستطيع pay.
- [ ] `pos.order.transfer`: زر النقل + server operation يعملان فقط عند وجودها.
- [ ] `pos.cancel_order`: زر الإلغاء + server operation يعملان فقط عند وجودها.
- [ ] Super Admin: implicit bypass فقط، بدون role-name checks جديدة.

### Inventory / kitchen

- [ ] first send يخصم مرة واحدة.
- [ ] retry لا يكرر الخصم.
- [ ] delta يخصم الزيادة فقط.
- [ ] void لصنف مرسل يعيد الكمية الصحيحة فقط بعد approval/permission contract.
- [ ] cancel order بعد kitchen send يعكس الاستهلاك حسب العقد المعتمد ولا يسبب double restore.

## سجل التنفيذ الحي

### 2026-09-16 — بدء المسار

- ✅ تم جلب أحدث `main`: `2901a3c58533706c80f61bdf670f758c6f3b598e`.
- ✅ تم إنشاء الفرع `development/pos-hardening-20260916` من هذا الـbaseline بالضبط.
- ✅ تم توثيق قواعد الدفع والطباعة التي أكدها المستخدم.
- ✅ تم تثبيت أولويات الإصلاح P0/P1 واختبارات القبول قبل تعديل Business Logic.
- ✅ لا توجد أي كتابة على Production DB.
- ✅ لا يوجد أي تعديل على Print Agent أو mobile branch.

### 2026-09-16 — P0 دفعة 1: Permission/Sent action gating

Root Cause:
- شريط الطلب كان يعرض Pay بمجرد وجود أصناف، حتى لو لم يحدث أول `send_to_kitchen`.
- قائمة الطلبات النشطة كانت تعرض Pay/Cancel دون ربط صريح بصلاحيات POS المناسبة.
- Table card كانت تعرض Transfer طالما callback موجود، بدون فحص `pos.order.transfer` داخل نقطة الدخول نفسها.

Changes:
- `src/features/pos/components/order/PosOrderHeaderBar.tsx`
  - Pay يظهر فقط مع `perms.canPay && hasSent`.
  - Print يظل ظاهرًا لصاحب `pos.receipt.print` لكنه disabled قبل أول kitchen send.
- `src/features/pos/components/orders/ActiveOrdersDrawer.tsx`
  - Pay يحتاج `pos.payment.take` + kitchen send فعلي.
  - Cancel للطلب held يحتاج `pos.cancel_order`.
- `src/features/pos/components/tables/TableCard.tsx`
  - Transfer يحتاج `pos.order.transfer`.
- `tests/components/pos-hardening-permissions-sent-actions.test.ts`
  - Contract test يغطي القواعد السابقة.

Commits:
- `277d5e3f1100e6ed71db6ef3e02553170f833822` — Pay/Print first-send gate.
- `f226fd0bdbd1b9b4ff5b8f507bb7e8d62157cb70` — Active Orders Pay/Cancel permission gates.
- `ed914ed277d10faaeb5066f364e35bdca8806fa4` — Table transfer permission gate.
- `f430966a3a842ec95b856cbc0951dcc6a91dd5e4` — focused contract test.

Verification status:
- ⏳ Focused/Full Verify لم يُعتبر Green بعد؛ سيتم تشغيله على PR/CI قبل إغلاق البنود جزئيًا أو كليًا.
- ⏭️ NEXT: تنفيذ `sent-only payable/printable items` بحيث الإضافات غير المرسلة لا تدخل في الحساب أو الطباعة، ثم مراجعة server authority للـcancel/transfer.

## قاعدة تحديث هذا السجل

بعد كل إصلاح يتم إضافة:
- Root Cause
- الملفات/RPCs المعدلة
- الاختبارات المضافة/المحدثة
- نتائج focused tests
- نتائج Full Verify عند الوصول لمرحلة PR
- commit SHA / PR number
- ما تم إغلاقه وما بقي مفتوحًا

لا يُعلَّم أي بند `[x]` إلا بعد إثباته باختبار أو verify مناسب.