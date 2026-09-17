# POS HARDENING REPAIR LOG — 2026-09-17

الحالة: FULL VERIFY GREEN — code scope verified; PR remains Draft / unmerged

الفرع: `development/pos-hardening-20260916`

PR: `#170`

هذا الملف امتداد مباشر لـ `docs/POS_HARDENING_REPAIR_LOG_2026-09-16.md` ويحتوي على حالة التنفيذ بعد استئناف العمل.

## تم تنفيذه في هذه الدفعة

### 1) Full-order table transfer أصبح Atomic

- Migration: `20260917083000_atomic_transfer_order_to_table.sql`.
- RPC جديدة: `transfer_order_to_table(order_id, target_table_id)`.
- التحقق server-side من:
  - `pos.order.transfer`.
  - branch access.
  - order owner / managed-other-order scope.
  - order status open/held.
  - source dine-in table.
  - target table active + same branch.
  - رفض target عليه live order لأن النقل الكامل ليس merge.
- تحديث `orders.table_id` + source table + target table في transaction واحدة.
- المصدر لا يصبح vacant إذا ظل عليه live order آخر.
- Audit action: `ORDER_TABLE_TRANSFERRED`.
- public `usePosOrder` route أصبح يستخدم RPC الجديدة بدل 3 client updates.
- Regression contract: `tests/unit/posAtomicTableTransferContract.test.ts`.

### 2) Sent-only settlement — server authority

- Migration: `20260917084500_sent_only_order_settlement.sql`.
- Preview موحد: `get_order_settlement_preview(order_id)`.
- Preview مسموح فقط مع `pos.payment.take` أو `pos.receipt.print` + branch/operator checks.
- payable quantities مشتقة من `order_kitchen_inventory_events` التي:
  - `settled_sale_id IS NULL`.
  - `sent_quantity > voided_quantity`.
- Fail-closed إذا kitchen event لا يمكن ربطه بسطر order صالح.
- settlement queue تحفظ event IDs الدقيقة، وليس order item فقط.
- Payment settlement لا يخصم المخزون مرة ثانية؛ يقرأ آثار `order_kitchen_inventory_effects` الموجودة من kitchen send.
- `process_sale` يستخدم sent-only items للطلب المرتبط.
- الطلب لا يغلق إلا عندما:
  - remaining unsettled kitchen quantity = 0.
  - remaining unsent order quantity = 0.
- لو بقيت إضافات غير مرسلة يظل order مفتوحًا والطاولة occupied.
- credit مسموح أن يكون paid amount = 0؛ يبقى accounting AR/unpaid حسب التسوية.
- payment status للطلب يعاد حسابه من sales المرتبطة بأحداث kitchen التي تم تسويتها.

### 3) Sent-only settlement — frontend

- Service جديد: `src/features/pos/services/settlementPreview.ts`.
- قبل فتح checkout لطلب قائم:
  - إن كان المستخدم يملك edit، يتم حفظ snapshot الحالي أولًا حتى لا تضيع إضافات غير مرسلة.
  - بعدها يتم جلب authoritative settlement preview.
- checkout totals أثناء التحصيل تستخدم preview sent-only.
- الدفع يرسل preview items/totals فقط.
- بعد partial settlement:
  - checkout يغلق.
  - الطلب يظل مفتوحًا.
  - الإضافات غير المرسلة تبقى على الطلب.
- عند اكتمال كل الكميات فقط يتم reset workspace.
- open-order receipt يستخدم نفس sent-only preview.
- final sale receipt يحتفظ بمسار single-print authorization.
- Contract test updated: `tests/components/pos-open-order-sent-only-contract.test.ts`.

### 4) Server-side create/edit authorization hardened

- Migration: `20260917090000_harden_order_create_update_permissions.sql`.
- `create_order` الآن يفرض داخل SECURITY DEFINER:
  - auth.
  - `pos.order.create`.
  - `user_may_access_branch`.
- normal client لا يستطيع spoof `p_cashier_id`; cashier authority = `auth.uid()`.
- `update_order` الآن يفرض:
  - auth.
  - `pos.order.edit`.
  - branch scope.
  - order owner أو approved managed-other-order capability.
- update_order يرفض نقل الطلب إلى table عليها live order.
- sent kitchen line لا يمكن تقليل كميته تحت sent quantity.
- sent kitchen line لا يمكن حذفه/إعادة تكوينه من `update_order`; يجب المرور بالـcontrolled void flow.
- Error contract: `SENT_ITEM_CHANGE_REQUIRES_VOID`.
- Regression contract: `tests/unit/posOrderMutationServerAuthorityContract.test.ts`.

### 5) Kitchen concurrency / identity / warehouse audit

تمت مراجعة التعريف الفعلي لـ `send_to_kitchen` و `_send_to_kitchen_core_20260914`:

- order row locked `FOR UPDATE` قبل حساب delta.
- delta = `order_item.quantity - sent_quantity` داخل نفس transaction.
- normal authenticated path لا يثق في `p_sent_by`; `sent_by = auth.uid()`.
- service-role فقط يمكنه تمرير sent_by المخصص.
- first send يختار authoritative active/default warehouse إذا order لا يملك warehouse.
- warehouse يكتب في `orders.inventory_warehouse_id`.
- subsequent sends تستخدم نفس order warehouse.
- settlement migration ترفض warehouse مختلف عبر `KITCHEN_WAREHOUSE_MISMATCH`.
- payment settlement لا يعمل physical deduction ثانية.
- Regression contract: `tests/unit/posKitchenWarehouseAuthorityContract.test.ts`.

### 6) Tables panel Pay gate

- وجد مسار UI إضافي كان يعرض Pay بدون permission/send gate.
- `TablesPanel` الآن يحتاج:
  - `perms.canPay` (`pos.payment.take`).
  - `order.kitchen_sent_at` موجود، أي حدث أول kitchen send.
- Contract: `tests/unit/posTablesPanelPayGateContract.test.ts`.

### 7) Final Verify regression repairs

خلال Full Verify ظهرت فروق عقدية فعلية وتم إصلاحها بدون تخفيف RLS أو الاختبارات:

- normal authenticated `create_order` يرفض صراحة spoof لـ `p_cashier_id` عبر `ORDER_OPERATOR_ASSIGNMENT_FORBIDDEN`.
- `process_sale` يتحقق مبكرًا من branch identity للطلب المرتبط ويعيد `BRANCH_MISMATCH`/`ORDER_NOT_FOUND` بشكل صريح.
- non-linked sale يحتفظ بـ `p_discount_type` الأصلي، بينما linked sent-only settlement يستخدم amount semantics المشتقة من preview.
- operator ownership guard في `process_sale` يعيد `ORDER_OPERATOR_REQUIRED` قبل المعالجة المالية.
- sent-line mutation detail يثبت أن التغيير يتطلب controlled void/approval boundary.
- sent-only full-payment contract يستخدم `FULL_PAYMENT_REQUIRED_FOR_SENT_ITEMS`.
- modifier UUID ordering تم تطبيعه server-side قبل مقارنة settlement payload حتى لا يرفض نفس مجموعة modifiers بسبب اختلاف الترتيب فقط.
- Browser Smoke تم تحديثه ليتبع العقد النهائي: Kitchen Send أولًا ثم Pay.
- تم إصلاح race حقيقي في الواجهة: نجاح `send_to_kitchen` الموثق server-side يوفّر session-local send state حتى تصل صفوف Realtime، لذلك Pay/Print لا يظلان مخفيين بعد نجاح الإرسال بسبب تأخر Realtime فقط.
- E2E mock أصبح يحاكي persisted order/items/kitchen sends وauthoritative settlement preview بدل نجاح RPC ناقص الحالة.

## حالة البنود الأصلية

- Cancel server authority: VERIFIED (`set_order_status` يفرض `pos.cancel_order`, branch, operator, sent-item controlled void).
- Full-order transfer: VERIFIED — Full Verify Green.
- Sent-only payable/printable: VERIFIED — Full Verify Green.
- Kitchen concurrency/audit: VERIFIED + contract locked.
- Warehouse authority: VERIFIED + contract locked.
- create/update server permissions: VERIFIED — Full Verify Green.
- View-only / Pay-only: VERIFIED ضمن Permission-First regressions؛ edit gates منفصلة عن payment gate.
- Browser send→pay flow: VERIFIED بعد إزالة Realtime race.

## Full Verify — GREEN

Code HEAD verified:
`202f0b84af2ef0af468428f470aab866dd39fc56`

Workflow: `Verify main` run #1626 (`35198974446`).

النتيجة:
- Locked Supabase identity ✅
- Frontend API contract ✅
- Lint ✅
- TypeScript ✅
- Typecheck application + tests ✅
- Unit ✅
- Build ✅
- Fresh canonical DB migrations ✅
- Schema verification ✅
- Integration / Security / RLS ✅
- Browser Smoke / Playwright ✅

PR #170 ظل Draft/Open وغير مدمج بعد نجاح التحقق، انتظارًا لأمر صريح بالدمج.

## Production

- لم يتم تطبيق أي migration من هذه الدفعة على Production.
- Production DB `azzdesuowpdcoflmyezn` لم يتم تعديلها أثناء هذا المسار.
- لا يوجد تغيير في Print Agent.
- لا يوجد تغيير في mobile app branch.
- لا يوجد تعديل مباشر على `main`.
