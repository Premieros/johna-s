# SIMPLIFICATION MAP — خريطة تبسيط البنية الخلفية

> التاريخ: **2026-09-12** · الفرع: `development/architecture-baseline` · القاعدة: `main` (952b315)
> الهدف: **Simple inside — Same capabilities outside**. تبسيط داخلي للبيئة الخلفية دون تغيير أي Feature ظاهرة للمستخدم ودون فقد أي بيانات Production.
> This is the **PR 1** artifact (Simplification Map + dependency audit). No product code changed.

---

## 1) القرار

ممنوع:
- إعادة بناء من الصفر / v3/v4/new-pos / نسخة موازية.
- حذف أو تقليل Feature مستخدمة (POS، Tables، Kitchen، KDS، Purchases، Inventory، Approvals، Printing، Offline/Reconciliation، Reports...).
- تعديل أو حذف بيانات Production الحالية أو `branch_id`/`warehouse_id` بدون خطأ مثبت.
- تعديل `main` مباشرة أو Force Push.
- تخفيف RLS/الصلاحيات.

مسموح:
- حذف الازدواج الداخلي، المسارات الميتة، الـ helpers القديمة ببديل مثبت، وطبقات تاريخية متوازية **بعد إثبات عدم الاستخدام**.
- توجيه العمليات المعقدة عبر RPCs موثوقة (Transaction في الخلفية).
- تقوية نقطة حساب موحّدة للمخزون والتوفر والشراء والبيع والدفع.

---

## 2) Baseline الرسمي (شهر ناجح قبل أي تغيير)

| البند | النتيجة |
|---|---|
| `npm run lint` | 0 errors / 3 warnings قديمة (ProductImage، PosWorkspacePage kitchenSends، V2BranchContext) |
| `npm run typecheck:all` | ✅ أخضر |
| `npm run test:unit` | 498 ناجح / 3 إخفاقات **بيئية CRLF** مثبتة مسبقًا (قراءة نصوص ملفات) بلا تغيير Src |
| `npm run build` | ✅ |

ملاحظة: (Fresh DB / Integration / Browser Smoke) كي في CI — لا `SUPABASE_DB_URL` محليًا.

---

## 3) أرقام الجرد الفعلية

### 3.1 Frontend (src/)
- وحدات `features`: **15** (accounting, admin, auth, catalog, costing, dashboard, import-export, inventory, manufacturing, operations, parties, pos, reporting, subscription, trade).
- صفحات: **62** · مكونات: **43**.
- وصول بيانات: `supabase.from()` مباشر = **258** · RPC عبر `api.<domain>` = **113** · RPC مباشر في الصفحات = **34**.
- `src/api`: **128** RPC فريدة في **14** domain (بارrel `index.ts`، غلاف `rpc.ts`).
- أذونات: **110** إذنًا في `PERMISSION_GROUPS` (20 مجموعة) — **مصدر واحد** `lib/permissionDefs.ts`. لا RBAC موازٍ (useV2Can مجرّد مُفوض إلى useCan).
- Feature-gating الاشتراك (`services/subscription/feature-gate.service.ts`) = نظام حيّ منفصل فوق RBAC.

### 3.2 Backend (supabase/migrations/)
- ملفات migrations: **295**.
- `CREATE FUNCTION`: **572** جملة → **282** اسمًا فريدًا؛ **134 اسمًا معرّفًا أكثر من مرة** (~48%).
- أعلى إعادة تعريف: `private` (17×)، `process_sale` (13×)، `send_to_kitchen` (12×، حُسم overload)، `create_user` (10×)، `produce_inventory_unit` (7×).
- `ENABLE RLS`: **107** · `CREATE POLICY`: **684** · `DROP POLICY`: **702** (في 77 ملفًا). تكرار سياسات على نفس الجدول عبر ملفات (products/sales/recipe_items/audit_log...) — **الأحدث هو القانون** والقديم تاريخي ضمن سلسلة migrations.
- RPCs معرّفة في DB ولا يستدعيها `src`: **161** (غالبيتها Helpers داخلية مقصودة `_` / أسماء `private`) — تُوثَّق ولا تُحذف فورًا.
- استدعاءات `src` غير المعرفة في migrations: **0** (لا Drift غائب).

---

## 4) خريطة التصنيف: KEEP / MERGE / HIDE / LEGACY / REMOVE-LATER

⌛ = إثبات مستند في هذا القسم.

### 4.1 KEEP (مستخدم، يُحافظ عليه كما هو)
| المسار | الدليل |
|---|---|
| `src/api/**` كاملًا (client, rpc,types, index, domains) | الطبقة القانونية الوحيدة: 128 RPC عبرها 14 domain |
| `src/lib/permissionDefs.ts` + `permissions.ts` | مصدر RBAC الوحيد (useV2Can مفوّض إليه) |
| `src/lib/supabase.ts` | نقطة إنشاء عميل واحدة |
| `src/core/navigation/{routes,menu.config}.ts` | مصادر الحقيقة للمسارات والقوائم |
| `src/core/security` + `src/core/guard/*` | مثبّتة في App/providers |
| `src/services/subscription/{subscription.service, feature-gate.service, subscription.constants, subscription.types, index}.ts` | نظام feature-gating حيّ (SubscriptionPage, useSubscription، Plan bars) |
| صفحات الـ 15 وحدة المسجّلة في `routes.tsx` | الغالبية العظمى (سلسلة Usage من الجرد) |
| `scripts/db/pos_availability_diagnosis.sql` | أداة تشخيص POS فريدة (موروثة من عمل سابق تمت مراجعته — مفيد) |
| backend | كل migrations مطبَّقة = **تاريخ غير قابل للتعديل**؛ لا تُحذف/تعدّل مطبَّقة أبدًا (كسر للسلسلة) |

### 4.2 MERGE (توحيد داخلي بدون تغيير سلوك)
| المسار | الدليل | الخطوة |
|---|---|---|
| `src/services/subscription/subscriptionService.ts` | كائن `subscriptionService` **ميت** (صفر import خارجي؛ الوحيد `index.ts:5` إعادة تصدير؛ كل الصادرات مكررة من ملفاتها الأصلية عبر `index.ts:1-4`) | دمج في barrel ثم حذف (PR 2/3) |
| وصول `reporting/ReportsPage` | 27 استعلام `supabase.from` مباشر مقابل `api.reporting` موجود ومستخدم في FinancialReportsPage | تمرير عبر `api.reporting` (PR 6) |
| Fallbacks كتابة مباشرة في `api/domains/{manufacturing, pos, subscriptions}` | نمط "RPC أولًا ثم `supabase.from` عند الفشل" يفتح كتابة جداول من العميل | إلغاء fallback والاكتفاء بـ RPC (تدريجي) |
| أسماء `private` / دوال `_*` داخلية | 161 RPC غير مدعوة من src — غالبيتها Helpers داخلية مقصودة | توثيق + نقل مستقبلي لأسماء مساحة داخلية واحدة **بدون تغيير سلوك** |

### 4.3 HIDE (خلفيًا/تجريبي غير مرتبط بقائمة) — لا حذف فوري
| المسار | الدليل |
|---|---|
| `src/v2/**` (V2GatewayPage, capabilityRegistry, V2BranchContext, useV2Can) | routes مسجّلة (`/v2...`) لكن **غير ظاهرة في menu.config/تجزأ**؛ بوابة لا "تنفيذ ثانٍ"؛ `useV2Can` مستخدمها الوحيد ApprovalCenterPage فقط |
| `src/features/dashboard/pages/DashboardExecutiveInsightsV2.tsx` | "V2" في الاسم فقط — حيّة (يستوردها DashboardEnhancedPage) → LEGACY+حفاظ |

### 4.4 LEGACY (على قيد الاستخدام، موثّق)
| المسار | الدليل |
|---|---|
| دوال RPC قديمة مغطاة بـ new wrapper (مثل `get_pos_product_availability` بعد `get_pos_cart_product_availability`) | مصادر Truth POS متعددة على السطح → تُوثَّق canonical ويُبقي المراوح حتى انتقال callers (PR 2) |
| سياسات RLS مكررة عبر ملفات متعددة | أحدث file هو القانون؛ التاريخية تبقى كسلسلة (لا تُحذف) — تُوثَّق في DATABASE_CONTRACTS |

### 4.5 REMOVE-LATER (ميت بتصديق؛ الإزالة في PR مركّز بعد Baseline)
| المسار | الدليل (0 import خارجي) |
|---|---|
| `src/services/subscription/subscriptionService.ts` (بعد دمج barrel) | لا import للكائن `subscriptionService` في src/tests |
| `src/features/admin/pages/SubscriptionsAdminPage.tsx` | لا import؛ `routes.tsx:130` يعيد توجيه `/subscriptions` → `/super-admin` |
| `src/features/reporting/pages/ReportDeepLinkPage.tsx` | لا Route له؛ المرجع الوحيد testId في `lib/interactionIdentity.ts:63` |
| `src/components/subscription/SubscriptionBanner.tsx` (+ مسار `useSubscription` الخامل) | صفر import في App/providers؛ المستهلك الوحيد هو `useSubscription` → السلسلة كلها خاملة (dormant). قرار يحتاج مراجعة: إعادة تثبيت أو إزالة لاحقًا — **لا تتم إزالة في PR مبكر**.

> قاعدة REMOVE-LATER: لا تُحذف إلا داخل PR مستقل بعد `Baseline → Usage re-proof → Regression Green → حذف`.

---

## 5) خارطة الطريق (PR صغيرة، الترتيب المطلوب)

| PR | النطاق | المتوقع |
|---|---|---|
| **PR 1 (هذا)** | Simplification Map + Dependency Audit | مستندات فقط؛ بدون كود |
| PR 2 | Inventory contracts consolidation | توثيق canonical للمخزون/التوفر (get_pos_product_availability vs cart)، توحيد المخزون كـ Source of Truth واحد، لا تغيير سلوك |
| PR 3 | Catalog simplification | مسار واحد لإنشاء الخامة/المنتج/الوصفة (من فاتورة الشراء يستخدم نفس العقد)، توحيد product_units الرابط، حذف dead `*Service` |
| PR 4 | Purchases consolidation | عقد مشتريات واحد: create/edit transactional (reverse→reapply→audit)، receive، return، cancel — عبر RPC موثوقة لا كتابة مباشرة |
| PR 5 | Sales/POS/Kitchen consolidation | عقد بيع واحد؛ send_to_kitchen idempotent (first/delta/retry)؛ POS لا يعدّل stock؛ permissions granular محفوظة |
| PR 6 | Finance/Reports simplification | REST عبر `api.reporting` بدل 27 `from()`؛ توحيد مصادر الأرقام (orders/payments/shift) |
| PR 7 | Legacy cleanup المؤكد فقط | إزالة الملفات الميتة 4.5 + أي RPC/helper دون callers (بعد Regression) |

كل PR: Baseline → Change → Focused Tests → Full Verify → Regression Report → Merge.

---

## 6) قواعد ملزمة أثناء التنفيذ
1. Feature مستخدمة تُبقى؛ تبسيط Backend فقط.
2. أي حذف يتطلب: إثبات عدم استخدام (imports/routes/UI/RPCs/tests) + بديل كامل.
3. لا تعديل لمطبَّقة migrations؛ الإضافة بالاتجاه الأمامي فقط (forward-only) + Backward-Compatibility.
4. لا تغيير `branch_id`/`warehouse_id` للسجلات إلا بخطأ مثبت + Mapping واضح + اختبار قبل/بعد.
5. لا cross-branch / cross-warehouse fallback.
6. Authorization عبر Permission-First فقط؛ أسماء الأدوار Labels.
7. أي عملية متعددة الجداول = Transaction في Backend (RPC)، لا سلسلة من الواجهة.
8. Negative raw stock = Setting نظام (`Allow Negative Raw Stock ON/OFF`) تدار بـ settings.manage، لا Permission مستخدم.
9. Stock consumption عند `send_to_kitchen` فقط (first/delta/retry idempotent).
10. الدمج إلى `main` فقط عبر PR بعد Full Verify.

---

## 7) ما سبق وما بعده
- ما أُنجز قبل هذا (فرع clean + حفظ السكربت الفريد + Baseline أخضر) محفوظ كما هو — لم يُسحب شيء.
- الخطوة التالية فور اعتماد PR 1: بدء PR 2 (Inventory contracts) بحيث يجمع الأدلة من هذا المستند.