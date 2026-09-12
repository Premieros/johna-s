# CATALOG CONTRACTS — عقود الكتالوج (PR 3)

> التاريخ: **2026-09-12** · الفرع: `development/catalog-simplification` · القاعدة: `main` (42a7c66، بعد دمج PR 1 وPR 2)
> PR 3 من برنامج Backend Simplification (راجع `docs/SIMPLIFICATION_MAP.md` §5).
> الهدف: **عقد إنشاء واحد** للخامة/المنتج/الوصفة (يدوي + معالج + استيراد + مراجع من فاتورة الشراء)، **توحيد رابط product_units**، و**حذف الخيوط الميتة** في طبقة `api/catalog` — **باقتراح تغيّر مركّز، Catalog فقط، دون cleanup واسع**.
> منهج مرتبط: PR 1 (`docs/SIMPLIFICATION_MAP.md`) وPR 2 (`docs/INVENTORY_CONTRACTS.md`) مُدمجان؛ هذا المستند يبني على أدلتها.

---

## 0) الحكم

- هذه الوثيقة + الأدلة هي الارتكاز؛ **أي تغيير سلوك يَنفذ بموافقة صريحة منفصلة** (خطة §6).
- **لا cleanup واسع:** لا يُلمس POS/Purchases/Reporting/v2/Offline/Printing خارج أي بند مُدرَج هنا.
- forward-only migrations فقط؛ لا تعديل لمطبَّقة.
- لا تغيير أرصدة/توفر/أسعار بعيدًا عن عقد الإنشاء نفسه.

---

## 1) سطح الكتالوج FE الحالي (مُشتَّت)

| العملية | الشكل الحالي | المرجع |
|---|---|---|
| إنشاء/تعديل/حذف **خامة** | `from('raw_materials')` مباشر (insert/update/delete) — **بلا RPC** | `RawMaterialsPage.tsx:137/:132/:148` |
| تعديل رصيد خامة | `api.inventory.adjustRawStock` → `adjust_raw_stock` | `RawMaterialsPage.tsx:163` |
| إنشاء/تعديل/حذف **منتج** | `from('products')` مباشر (insert 172، update 165، delete 235، bulk import 251) | `ProductsPage.tsx` |
| وحدات بيع المنتج | RPC `replace_product_units` عبر `api.catalog.replaceProductUnits` | `ProductsPage.tsx:168/:176` · RPC canonical `077:18` |
| روابط الوحدات `product_unit_links` | **مباشر** من الصفحة (delete/update/insert) | `ProductsPage.tsx:190-198` |
| `product_components` (fallback) | **مباشر** من الصفحة (delete/insert) | `ProductsPage.tsx:206-209` |
| معالج إنشاء المنتج (Wizard) | **100% مباشر بلا RPC**: products 181-193، product_unit_links 199-203، recipes 208-215، recipe_items 218-223، rollback delete 243 | `ProductSetupWizardPage.tsx` |
| إنشاء **وصفة** | مباشر `from('recipes')` + `recipe_items` | `RecipesPage.tsx:159/:162` |
| تعديل **وصفة** | RPC مباشر غير مغلَّف `update_recipe_with_items` | `RecipesPage.tsx:145` · canonical `20260906180000:20` |
| حذف **وصفة** | RPC مباشر `delete_recipe_controlled` | `RecipesPage.tsx:174` · canonical `20260906180000:144` |
| وحدات مصنعة (config) | **مباشر** bypass للـ api wrappers | `InventoryUnitsPage.tsx:110/114/170/154/157` |
| الاستيراد | **مباشر على كل جداول الكتالوج** بلا RPC (انظر §2) | `import-executor.ts` |

> قراءات `product_unit_links`/`inventory_unit_recipes`/`inventory_units` من الصفحات تبقى كما هي (قراءة فقط).

---

## 2) مسار الاستيراد والفاتورة — لا يشارك العقد المحروس

### 2.1 import-executor (مباشر 100%)
| الجدول | المرجع |
|---|---|
| `categories` (auto/create/update) | `import-executor.ts:112-116, 265-276` |
| `products` (create/update/auto/forced-manufactured/price) | `:144-178, 430-456, 597-600` |
| `product_units` (insert base / update price) | `:194-202, 606-613` |
| `raw_materials` (create/update/auto) | `:339-358, 469-479` |
| `recipes` + `recipe_items` (delete/insert) | `:506-543` |
| `purchases`/`purchase_items`/`inventory_movements`/`production_orders` | `:723-1009` (سياق شراء/إنتاج مباشر) |

> النتيجة: **المسار المستورد لا يمرّ عبر `update_recipe_with_items`/`replace_product_units`/أي عقد محروس** — أتمّ تعليق المهمة "من فاتورة الشراء يستخدم نفس العقد".

### 2.2 SQL — لا إنشاء داخل مسار الشراء/الاستلام
- `process_purchase` (`020:28`) و`receive_purchase_order` (`075:945`) **يستشهدان فقط بـ product_id/raw_material_id موجودة** — لا `INSERT INTO products/raw_materials` في أي مسار شراء.
- إدراجات `products`/`raw_materials` في migrations كلها **demo/seeding** فقط (`049:82`, `050:83`, `20260906181200:70`, `20260817100000:133`).

---

## 3) الجهة الخلفية: canonical + المفقود

| الوظيفة | canonical | ملاحظة |
|---|---|---|
| `update_recipe_with_items` | `20260906180000:20` | SECURITY DEFINER؛ `recipes.manage` + branch؛ يحظر تكرار/mismatch خامة؛ `version` bump؛ audit (:110-141) |
| `delete_recipe_controlled` | `20260906180000:144` | SECURITY DEFINER؛ row-lock؛ `recipes.manage` + branch |
| `replace_product_units` | `077:18` | SECURITY DEFINER؛ استبدال ذرّي لـ `product_units`؛ `is_pos_admin()` + branch؛ `NO_BASE_UNIT` check (:64-84) |
| `save_product_modifiers` | `20260902121500:8` | validation-then-mutate؛ رول+branch؛ rollback (:190-196) |
| `produce_inventory_unit` | `20260906220500:7` | FIFO استهلاك + إنتاج؛ `production.manage` + branch |
| `validate_recipe_item_branch_match` | `20260912075859:28-51` | trigger BEFORE INSERT/UPDATE على `recipe_items` (:53-60)؛ SQLSTATE `23514` |
| **`create_product`** | **NOT FOUND** | لا وجود — الإنشاء عبر write مباشر بخلاف RLS |
| **`create_raw_material`** | **NOT FOUND** | لا وجود — مثل أعلاه |
| **`create_inventory_unit` / `update_inventory_unit`** | **NOT FOUND** | config تُكتب مباشرة من الصفحات |

> القاعدة المحروسة: DML المباشر على `recipes`/`recipe_items` مرفوض عبر RLS `USING(false)` (`20260906180000:6-18`) — الوصفة فقط عبر الـ RPC. **المنتج/الخامة/الوحدات لا تملك RPC وتبقى مفتوحة للكتابة المباشرة بصلاحيات الجدول.**

---

## 4) الازدواج والتشتت الموثّق (الحلول)

| البند | الأدلة | التعامل |
|---|---|---|
| `product_units` (001:89) مقابل `product_unit_links` (084:48) | مرافقة التوفر/البيع تقرأ `product_unit_links` (`20260912075859:202-211/254-260/488-494`) بينما `replace_product_units` يمسّ `product_units` القديمة (`077:64-84`) | **canonical للإنشاء/البيع = `product_unit_links`** (+ `inventory_units`)؛ `product_units` تبقى طبقة legacy يُكتب منها فقط عبر RPC موحَّد أو تتعرض للقراءة — توحيد بدون حذف جداول |
| 16/26 من صادرات `api/domains/catalog.ts` **بلا أي call site** | `getInventoryUnit`, `createInventoryUnit`, `updateInventoryUnit`, `deleteInventoryUnit`, `getProductUnitLinks`, `setProductUnitLinks`, `getInventoryUnitRecipes`, `setInventoryUnitRecipes`, `listMeasurementUnits`, `listWasteCategories`, `listWasteEntries`, `getWasteReport`, `getProductionVariance`, `listInventoryUnitProductions`, `getKitchenQueue`, `routeToStation` | مرشّحي حذف بعد `Regression` (ضمن خطة §6C) — لا حذف الآن |
| RPC مباشر غير مغلَّف في صفحات (6) | `update_recipe_with_items`/`delete_recipe_controlled` (`RecipesPage.tsx:145/174`) · `get_product_modifiers_admin` (`ProductModifiersPage.tsx:134`) · `get_kitchen_station_assignments`/`get_kitchen_station_editor_context`/`save_kitchen_station_assignments` (`KitchenStationsPage.tsx:98/190/214`) | ربطها عبر `src/api` (تغليف) — لا تغيير سلوك |
| `product_components` كمصدر تركيب fallback مكتوب مباشرة | `ProductsPage.tsx:206-209`, `ComponentsPage.tsx:98/113/122`؛ آخر كتابة في migrations 2026 = helper فقط (`20260817100000:23`) | غير مستخدم في توفر POS/recette → **لا يُكتب في المسار الموحّد الجديد** (توقف وليس حذف) |
| خدمات ميتة | `subscriptionService.ts` ملف التفاف ميت (0 مستخدم) | REMOVE-LATER (نطاق PR 7) — **خارج PR 3** |
| لا يوجد `catalog.service`/`product.service` أصلاً | grep | لا حاجة لطبقة جديدة |

---

## 5) فجوات حماية (أدلة تُستكمل بالعقد)

| الفجوة | الدليل |
|---|---|
| لا unique على `products` (sku/barcode/name) | `001:63-67` (أعمدة عادية؛ فهرس غير فريد فقط `001:373`) — تُفرض app-side فقط |
| `raw_materials.unit_id` **nullable** وقابل للتغيير | `011:74` (`REFERENCES units(id) ON DELETE SET NULL`) — ولا trigger يمنع تغييره؛ شرط "الوحدة إلزامية عند الإنشاء وغير قابلة للتغيير" **(موثّق فقط في `CURRENT_WORK_PLAN.md:143`، غير مُنفَّذ SQL)** |
| `recipe_items` محروسة؛ بقية الكتالوج مفتوحة لكتابة مباشرة | RLS `USING(false)` للوصفات فقط (`20260906180000:6-18`) |

---

## 6) خطة تغيير مركّزة مقترحة — **بانتظار موافقة صريحة**

> لكل خطوة: `Baseline → Change → Focused Tests → Full Verify → Regression Report`. ينفَّذ داخل PR 3 فقط بعد موافقتك على النطاق، وإلا فتُبقى وثيقة.

- **6A. عقد إنشاء واحد:**
  - Migration forward-only جديد: `create_product` و`create_raw_material` (SECURITY DEFINER، Permission-First مثل نمط الوصفة: `is_pos_admin()`/`can_permission` + branch، تحقق `code` unique للخامة، استقبال `product_unit_links`/`product_units` داخل نفس المعاملة) — يلتقط كل ما يفعله `ProductSetupWizardPage`/`RawMaterialsPage`/`import-executor` حاليًا.
  - توجيه: Wizard ← `create_product`؛ `RawMaterialsPage` و`import-executor` (أي إنشاء خامة/product/recipe) ← نفس العقد؛ الإغلاق: **فاتورة الشراء تستشهد بمنتج/خامة موجودة فقط** (تُوثَّق كقاعدة).
  - **بدون** لمس مسار البيع/التوفر/الأسعار خارج نطاق الإنشاء.
- **6B. توحيد رابط unit:** قرار canonical أعلاه (§4) + `replace_product_units` يحجز المسؤولية الوحيدة على `product_units`؛ صفحات اللينكات تستخدم `api.catalog.setProductUnitLinks` (موجود لكنه معطَّل — call site صفر) بدل الكتابة المباشرة؛ **لا حذف جداول**.
- **6C. حذف الـ 16 wrapper الميتة** في `api/domains/catalog.ts` بعد Regression يؤكد صفر call sites (موثوق §4).
- **6D. تغليف الـ 6 RPCs المباشرين** عبر `src/api` (RecipesPage/Modifiers/KitchenStations) — لا تغيير سلوك.
- **اختبارات مركّزة (Focused):** إنشاء خامة/منتج/وصفة عبر العقد الموحّد (يدوي + Wizard + استيراد)؛ ref من فاتورة الشراء لنفس المنتج/الخامة؛ RLS `USING(false)` للوصفات لا تضعف؛ branch isolation.

> ملاحظة انضباط النطاق: هذا **ليس** cleanup واسع — لا يحذف ميزة، لا يدمج POS/purchase/reporting، لا يمسّ `src/v2`، لا يغيّر أرصدة.

---

## 7) قواعد ملزمة لـ PR 3

1. لا يتجاوز الكتالوج؛ أي شيء خارجه يحتاج PR مستقل.
2. forward-only؛ لا تعديل/حذف مطبَّقة migrations.
3. الكتابة المباشرة من العميل لجداول الأرصدة ممنوعة (عقد PR 2 §5) — وإنشاء الكتالوج عبر RPC بعد 6A.
4. ظبط الجداول محفوظ عبر Permission-First و RLS؛ لا تخفيف.
5. Regression Green إلزامي قبل أي دماج؛ لا دماج إلا بموافقة صريحة.

---

## 8) تحقّق المرحلة الحالية (وثيقة فقط)

- `npm run lint`: **0 errors** / 3 warnings قديمة (نفس baseline).
- لا كود/migration أُغيّر بعد — `git diff` = هذا المستند + سجل PR 3 فقط.
- (Fresh DB / Integration / Browser Smoke) CI-only.
- الأدلة أعلاه من جرد ثنائي (FE + SQL) بتاريخ اليوم بمراجع `file:line`.

---

## 9) قرار مفتوح للاعتماد

هل أُنفّذ **6A–6D** (ضمن PR 3 نفسه بعد Regression واختبارات مركّزة) أم أُبقي PR 3 **وثيقة + خطة فقط** ويصبح التنفيذ PR 3.1 منفصلًا؟ الإجابة تحدد الخطوة التالية بعد إنشاء الـ PR.