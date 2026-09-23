# Permission Split — Inventory Count — 2026-09-23

## الهدف
فصل صلاحية الجرد المجمعة إلى إجراء واحد لكل صلاحية بدون تغيير منطق المخزون أو RLS أو حدود الفروع.

## الفرع
`development/permissions-split-inventory-count-20260923`

## العقد الجديد
- `inventory.count.approve`: اعتماد الجرد فقط.
- `inventory.count.reject`: رفض الجرد فقط.
- `inventory.count.apply`: تطبيق الجرد المعتمد على الرصيد فقط.
- الثلاثة تتطلب `inventory.view`.

## التوافق
الأدوار التي تملك `inventory.count.approve` قبل Migration تحصل على `inventory.count.reject` و`inventory.count.apply` أيضًا حتى لا يفقد المستخدم الحالي أي وظيفة بعد النشر.

## Backend
- `approve_stock_count` يبقى على `inventory.count.approve`.
- `reject_stock_count` ينتقل إلى `inventory.count.reject`.
- `apply_stock_count` ينتقل إلى `inventory.count.apply`.
- مسار `decide_operational_approval` يستخدم approve أو reject طبقًا للقرار.
- Migration تفشل إذا لم تجد بوابة الصلاحية القديمة داخل RPCs المتوقعة.

## UI
زر الاعتماد لم يعد يطبق الرصيد تلقائيًا. بعد الاعتماد يظهر زر التطبيق فقط لمن يملك `inventory.count.apply`. زر الرفض مستقل بصلاحية `inventory.count.reject`.

## محظورات محفوظة
- لا تعديل على الطباعة.
- لا تعديل على POS/Kitchen runtime.
- لا تطبيق Migration على Production ضمن هذا العمل.
- لا تعديل مباشر على main.
