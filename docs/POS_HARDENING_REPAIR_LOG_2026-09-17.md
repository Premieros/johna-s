# POS HARDENING REPAIR LOG — 2026-09-17

الحالة: ACTIVE — final verification pending

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

## حالة البنود الأصلية

- Cancel server authority: VERIFIED (`set_order_status` يفرض `pos.cancel_order`, branch, operator, sent-item controlled void).
- Full-order transfer: IMPLEMENTED, awaiting final CI.
- Sent-only payable/printable: IMPLEMENTED, awaiting final CI/DB integration.
- Kitchen concurrency/audit: VERIFIED + contract locked.
- Warehouse authority: VERIFIED + contract locked.
- create/update server permissions: IMPLEMENTED, awaiting final CI/DB integration.
- View-only / Pay-only: UI edit gates موجودة + server create/edit hardened + Pay gates updated; final regression verification pending.

## CI

Latest intended verification head at time of this log:
`3805320444c9d4a650119d82860974b1d37e974c`

Workflow: `Verify main` run #1600 (`35186751043`).

Status at log creation: IN PROGRESS.

لا يُعتبر هذا المسار مغلقًا ولا PR جاهزًا للدمج قبل نجاح:
- verify
- fresh DB / migrations
- integration/security/RLS
- browser smoke

## Production

- لم يتم تطبيق أي migration من هذه الدفعة على Production.
- Production DB `azzdesuowpdcoflmyezn` استُخدمت للقراءة/التدقيق فقط.
- لا يوجد تغيير في Print Agent.
- لا يوجد تغيير في mobile app branch.
