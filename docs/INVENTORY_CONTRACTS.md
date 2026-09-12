# INVENTORY CONTRACTS — عقود المخزون والتوفر (PR 2)

> التاريخ: **2026-09-12** · الفرع: `development/inventory-contracts` · القاعدة: `main` (952b315)
> PR 2 من برنامج Backend Simplification (راجع `docs/SIMPLIFICATION_MAP.md` §5).
> الهدف: **توثيق canonical** لكل عقود المخزون/التوفر — توصيف Source of Truth واحدة لكل طبقة، تعيين consumers، وكشف التجاوزات والازدواجات — **دون تغيير أي سلوك** (Detection & Documentation فقط).
> ملاحظة: هذا الفرع **مستقل** عن PR 1 (لا يحوي مستنداته) — يبدأ من `main` مباشرة.

---

## 0) الحكم

- لا كود، لا migration، لا تغيير RLS/Schema، لا حذف، لا تغيير سلوك في هذا الـ PR.
- أي تعديل سلوك مستقبلي يشتق من هذا المستند يُنفَّذ فقط في PR مستقل بإذن صريح.
- جميع المراجع `file:line` من جرد فعلي لكامل الريبو (2026-09-12).

---

## 1) سلسلة الثقة: من الشراء إلى البيع

```
Purchase receive ─► batches (FIFO) ─► availability (check_product_availability) ─► sale deduction (RPC Transaction) ─► ledger
```

- لا توجد `CREATE TRIGGER ... AFTER` لأي جدول تخزين عبر الـ295 migration — **لا شيء يحافظ على الأرصدة تلقائيًا**؛ كل تحريك مخزون يحدث داخل SECURITY DEFINER RPC/helpers.
- راجع `docs/STABILIZATION_WORK_LOG.md` (Root Stage B: warehouse identity) — البنية الحالية نتيجة إغلاق Stage B.

---

## 2) عقود القراءة — Availability (canonical)

### 2.1 المقيّم الوحيد (authoritative checker — أساس كل القرارات)

| العقد | التعريف canonical | الدور |
|---|---|---|
| `check_product_availability(uuid,uuid,uuid,numeric)` → `jsonb` | `20260912075859:127` | يُقيّم (product, branch, warehouse, qty) عبر: `inventory_batches` للجاهز (167-181)، `product_unit_links`+`inventory_units` (199-265)، `inventory_unit_batches` (310-331)، وصفات الوحدات المصنعة مع wastage (369-393، حارس دورة 290)، `raw_material_batches` (400-409). يرجع `INSUFFICIENT_*` للمعوقات؛ GRANT authenticated/service_role (423-424). |

### 2.2 كاميرات POS (snapshots — مشتقة من المقيّم)

| العقد | التعريف canonical | المستهلك |
|---|---|---|
| `get_pos_product_availability(uuid,uuid,integer)` | `20260912075859:432` | POS full snapshot — **مباشر**: `PosWorkspacePage.tsx:152` (`stockMap`/`rawShortageMap`/`availabilityErrorMap`، يعمل **بحثًا ثنائيًا + رمية أسّية** على `check_product_availability` 496-556؛ يرفع `BRANCH_ACCESS_DENIED`/`WAREHOUSE_NOT_IN_BRANCH` 456-470). |
| `get_pos_cart_product_availability(uuid,uuid,jsonb,integer)` | `20260911173000:259` | Cart-aware — **مباشر**: `useCartAwareAvailability.ts:95` (الطلب من `cartAvailability.ts:15-37`)؛ نتائجه تنشر إلى `ProductBrowser.tsx:45` عبر `cartAvailabilityStore.ts`. |
| `check_pos_cart_availability` → strict `_strict_20260912` ثم lax wrapper | `20260912113000:13-21` | لعمليات ما قبل البيع: lax يُخفف فقط `INSUFFICIENT_RAW_MATERIAL_STOCK` عندما يكون رصيد المستودع المصدر ≤ 0 (63-72) ولا يوجد مخزن آخر بالفرع إيجابي (77-87)، ثم **يعيد التحقق لكل عنصر** عبر `check_product_availability` (103-108). **لا استعارة عبر مخازن** (74-87). |
| `raw_material_warehouse_inventory` VIEW (security_invoker) | `20260911150000:13` | إسقاط مستودعي للخامة: `SUM(quantity)+avg_cost` من `raw_material_batches` حيث `warehouse_id IS NOT NULL`. |

### 2.3 قاعدة القراءة

- قرارات التوفر/البيع تُقرأ **عبر العقد الثلاثة أعلاه فقط**.
- أي `supabase.from()` مباشر على جداول الأرصدة (فقرات §3 بالأسفل) = شارات/تقارير UI **ثانوية** — موثقة في §7 ولا تُستخدم لقرار بيع.

---

## 3) مصادر الحقيقة (Source of Truth) لكل طبقة

| الطبقة | Source of Truth | تعريف canonical | ملاحظات |
|---|---|---|---|
| بضاعة تامة (جاهز) | `inventory` (تجمّع لكل product+warehouse) + `inventory_batches` (طبقات FIFO، CHECK qty ≥ 0) | التجمع: `013:90-99` (`_product_inv_add` upsert ON CONFLICT product_id,warehouse_id) · الطبقات: `011:320` | `inventory` يُحدَّث فقط عبر helpers RPC؛ قراءة مباشرة في شارات UI أعلاه. |
| خامة | `raw_material_batches` (دُفعات warehouse FIFO — المصدر التشغيلي) | `011:122`; warehouse_id أُضيف `20260911150000:6-7`; سياسة negative `20260911160000` (إسقاط CHECK≥0 25-26، سماح ببيع ضمن حد) | `raw_material_inventory` (`011:101`) = **ملخّص branch فقط** (UNIQUE raw,branch) — **ليس مصدر availability/FIFO**. |
| وحدات مصنعة | `inventory_unit_batches` (FIFO) + `inventory_units` (التعريف) | الوحدات: `084:14` · الطبقات: `084` (تعليق 92) · إدراج الحركة: `084:98`/`088:143`/`093:76`/`094:94`/`20260901224500:79` | القيد راجع `20260903201500:201` (خصم وحدة البيع). |
| الدفتر (Ledger) | `inventory_ledger` (بقيمة تكلفة) · `inventory_unit_entries` · `stock_transactions` (append-only) | ledger: `013:105/170/251/310/383` · وحدات: `084:98` · طبقة الحركة: `003:22` | views التاريخ: `inventory_movements` `095:5`، `raw_material_movements` `095:24`. |
| العد والتحويل والهدر | `stock_counts`/`stock_count_items` (`061:2/22`) · `warehouse_transfers` (`011`) · `waste_entries` (`20260904055000`) | | كلها تعمل عبر RPC فقط (الجدول 4). |

---

## 4) عقود الكتابة — التزام **RPC-only** (canonical write paths)

| نطاق | RPCs (الدور) | آخر تعريف canonical |
|---|---|---|
| صلاح الرصيد | `adjust_stock` · `adjust_raw_stock` | `020:703` · من فروق raw (branch agg) |
| تحويل | `create_warehouse_transfer` · `approve_warehouse_transfer` · `reject_warehouse_transfer` | `20260911004000:109` (نطاق فرع 139) |
| جرد فعلي | `create_stock_count` → `add/update/remove_stock_count_item` → `submit` → `approve` → `apply_stock_count` | `20260911194500`/`20260911194600` |
| إضافة دفعة | `add_inventory_batch` | `073:11` |
| هدر | `create_waste_entry` · `approve_waste` (الخصم عند الموافقة؛ warehouse إلزامي) | `20260904055000:24/51/110` |
| إنتاج | `produce_inventory_unit` | `20260906220500:7` |
| استلام مشتريات | `receive_purchase_order` (يُرصّد stock خادميًا) | `075:945` |
| بيع | `process_sale` · `process_sale_split` · `deduct_sale_unit_inventory` (وحدات) | `020:28` (bidked) · `20260903201500:201` |
| مطبخ | `send_to_kitchen` (نقطة الخصم) — core: `_deduct_sale_inventory_with_modifiers_core` (يعيد تحقق، يسمح raw negative 191-200) | `20260905001500:16` · core `20260911160000:83` |

غلاف الواجهة القانوني: `src/api/domains/inventory.ts` (**21 إجراءً**) + `catalog.ts` (`replaceProductUnits`, `getWasteReport`, `produceInventoryUnit`, `getProductionVariance`) + `procurement.ts:15` (`receivePurchaseOrder`) + `pos.ts` (`sendToKitchen`/`processSale`/`processSaleSplit`) — كلها تعبر `src/api/rpc.ts`.

---

## 5) تجاوزات موثّقة (client writes غير RPC) — **بلا إصلاح في PR 2**

| الموقع | النوع | الخطر | الملاحظة |
|---|---|---|---|
| `src/api/domains/manufacturing.ts:156-241` (`completeOrder` fallback) | **UPDATE/INSERT مباشرة**: `raw_material_inventory` (156-167)، `raw_material_movements` (172-179، production_consume سالب)، `production_waste` (190-197)، `inventory` (227-241) | **الأعلى** — تنفيذ موازٍ كامل لتحريك المخزون الذرّي في العميل عند فشل RPC | الحل: تقوية `complete_production_order` ثم حذف fallback (PR مستقبل)؛ لا يُتاح العميل لكتابة أرصدة كقاعدة. |
| `src/lib/comprehensiveDemoSeeder.ts:190-209, 365-373` | upsert/insert raw + inventory | منخفض | dev/demo only — يُبقى، لكنه يُنقل لاحقًا لمصدر seed/عقود إن لزم. |
| إعدادات الهيكل (`catalog.ts:27-75`, `ProductsPage.tsx:190-198`, `ProductSetupWizardPage.tsx:199`, `InventoryUnitsPage.tsx:110-170`, `import-executor.ts:194-202/606-610`) | insert/update/delete على `inventory_units`/`product_unit_links`/`inventory_unit_recipes`/`product_units` | منخفض | **تعريف/هيكل وليست أرصدة** — مقبولة ضمن نطاقها. |

> **قاعدة ملزمة:** لا يُكتب رصيد (`batch`/`inventory`/`raw_material_*`) من العميل إطلاقًا.

---

## 6) طبقات Legac/ازدواج موثّقة (بلا إزالة)

| المزدوج/Legacy | مقابل canonical | القرار |
|---|---|---|
| `consume_order_kitchen_inventory` `20260830000000:155` (مسار مباشر + single-active-warehouse fallback 189-193) | `send_to_kitchen` `20260905001500:16` + `_deduct_sale_inventory_with_modifiers_core` `20260911160000:83` | HIDE/LEGACY — يُبقى لمدى Review؛ أي طريق قادم عبر `send_to_kitchen`. |
| `_raw_remove_fifo` legacy bridge `20260912133000:34` (صيانة mesht per purchase) | canonical `20260911160000:37` (10 args، `allow_negative`، FOR UPDATE، debt batch 61، contract 729) | LEGACY — الإزالة لاحقًا بعد إثبات callers؛ الغموض (9-args) أُزيل مسبقًا `20260912135000:14-24`. |
| `_raw_add` legacy bridge `20260911151500:4` | warehouse-aware `20260911150000:28` (advisory lock 44) | LEGACY كما أعلاه. |
| `src/lib/sales-deduction.ts` — **ميت** (0 imports؛ يغلف `deduct_sale_unit_inventory` + `computeUnitStockCost` يقرأ `inventory_unit_batches`) | عقد البيع الموحد (`process_sale`/`process_sale_split`/kitchen send + RPC `deduct_sale_unit_inventory`) | REMOVE-LATER (مرتبط PR 7) — لا يحذف في PR مبكر. |
| تكرار سياسات RLS على نفس الجداول عبر ملفات (products/sales/recipe_items/audit_log...) | الأحدث هو القانون | أرشيف سلسلة migrations — لا يُحذف/يُعدَّل. |
| اتساق `get_pos_product_availability` vs `get_pos_cart_product_availability` | كلاهما canonical من مقيّم واحد (§2) | **توثيق أصبح نهائيًا** — إبقاء الاثنين حتى انتقال callers؛ لا دمج. |

---

## 7) توحيد القراءة عبر `src/api/inventory` — خارطة تحويل (مستقبل، **لا تنفيذ الآن**)

قراءات `supabase.from()` المباشرة على الأرصدة → يُعاد توجيهها عبر `api.inventory` (أو RPC قراءة جديدة) في PR لاحق **مع Regression**:

| الصفحة/المكوّن | الجدول | ref |
|---|---|---|
| `InventoryPage` | `inventory` | `28-33` |
| `InventoryBatchesPage` | `inventory_batches` | `52-57` |
| `InventoryLedgerPage` | `inventory_ledger` | `24-29` |
| `StockCountsPage` | `stock_counts` (+items) | `37-38` |
| `TransfersPage` | `warehouse_transfers` + `raw_material_inventory`(avg_cost) + `inventory_batches`(cost) | `38-40/125/129` |
| `RawMaterialsPage` | `raw_material_inventory`, `raw_material_batches` | `75-76` |
| `LowStockAlertsPage`/`RawMaterialBranchStockPanel` | `raw_material_inventory` | `118-120/87-89` |
| `ReportsPage` (stock/low/waste) · `VisualDashboardPage` · `DashboardExecutiveInsightsV2` | `inventory`, `waste_entries` | `277/491/560` · `156/204` · `49` |
| `ProductsPage`/`ComponentsPage` (شارات) | `inventory` | `81/50` |

> ملاحظة فرص توحيد فوري (قيمة، بلا سلوك): `LowStockAlertsPage`/`getLowStockSummary`/`getLowStockAlerts` RPCs موجودة سابقًا — استدعاؤها عبر `api.inventory` يلغي قراءة `raw_material_inventory` فيه (`118-120`).

---

## 8) قواعد ملزمة مستقبلية (لا تنفيذ الآن)

1. الخصم عند `send_to_kitchen` فقط (first/delta/retry idempotent).
2. لا cross-branch / cross-warehouse fallback إطلاقًا.
3. أي تعديل رصيد متعدد الجداول = Transaction في Backend (RPC)، لا سلسلة من الواجهة.
4. لا كتابة أرصدة من العميل (بما فيها الاستمارة manufacturing fallback §5).
5. `warehouse_id` إلزامي في كل حركة — لا NULL ولا استنتاج من اسم.
6. Negative raw stock = سياسة نظام (`settings.manage`)، لا صلاحية مستخدم (راجع `20260911160000`).
7. أي قراءة تُحوَّل إلى RPC تُغلَّف بـ Regression (قيم + نطاق فرع/مخزن).

---

## 9) تحقق PR 2

- `npm run lint`: **0 errors** / 3 warnings قديمة (ProductImage, PosWorkspacePage kitchenSends, V2BranchContext) — نفس Baseline.
- لا ملف كود/migration/schema أُغيّر — diff يتضمن هذا المستند + تحديثات السجلات فقط.
- كل مراجع `file:line` أعلاه مأخوذة من جرد فعلي (dual audit backend+frontend).
- (Fresh DB / Integration / Browser Smoke) = CI-only (لا `SUPABASE_DB_URL` محليًا).

---

## 10) الترتيب والتبعات

- PR 1 (#84) مفتوح؛ PR 2 مستقل من `main`. عند دمج PR 1 لاحقًا يُعاد rebase لهذا الفرع.
- الخطوة التالية بعد اعتماد PR 2 → PR 3 (Catalog) يستند إلى نفس العقود (§2-4).
- كل إزالة لتجاوزات §5 أو طبقات §6 تتم فقط داخل PR مرخّص بعد `Baseline → Usage re-proof → Regression Green`.