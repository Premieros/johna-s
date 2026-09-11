# Change Impact & Regression Guard — Mandatory

هذا الشرط إلزامي على أي تعديل أو إصلاح أو تطوير في المشروع قبل اعتباره مكتملًا أو جاهزًا للدمج.

## القاعدة الأساسية

أي تعديل يجب ألا يُختبر بمعزل عن نفسه فقط. يجب تحديد واختبار علاقاته وتأثيره على الأجزاء المرتبطة به، والتأكد من عدم كسر أي وظيفة كانت تعمل مسبقًا.

## قبل التنفيذ

1. تحديد Root Cause الحقيقي، وليس عرض المشكلة فقط.
2. عمل Impact Map للتعديل يشمل عند الحاجة:
   - الجداول والأعمدة والـFK/constraints/indexes.
   - RPC/API contract والـfrontend types.
   - الصلاحيات Permission-First.
   - branch / warehouse scope وRLS.
   - الـledger وحركات المخزون والآثار المالية.
   - الصفحات والمكونات التي تقرأ أو تكتب نفس البيانات.
   - approvals / printing / reports / offline flows إذا كان التعديل يصل إليها.
3. فحص الاستدعاءات والاستخدامات الحالية قبل تغيير أي contract مشترك.

## أثناء التنفيذ

- لا تعديل UI يعتمد على schema/RPC غير مطبق أو غير موجود في البيئة المستهدفة.
- أي schema change يجب أن يظل backward-compatible متى أمكن، أو يحدّث جميع المستهلكين في نفس التغيير.
- ممنوع استخدام workaround يخفي المشكلة أو يضعف RLS/permissions/tests.
- ممنوع مضاعفة side effects عند retry: stock, ledger, payment, kitchen send, printing أو approvals.

## الاختبارات الإلزامية قبل الدمج

يجب إثبات كل ما ينطبق من الآتي:

1. Focused test للوظيفة المعدلة نفسها.
2. Contract/schema check للتأكد أن Frontend/API/DB متطابقة.
3. Relationship regression للوظائف التي تعتمد على نفس الجداول/RPCs/permissions.
4. Branch/RLS/permission regression، مع اختبار رفض الوصول غير المصرح به.
5. Side-effect regression للتأكد من عدم تكرار المخزون/ledger/payment/consumption عند retry.
6. Fresh DB + migrations/schema verification عند وجود تعديل قاعدة بيانات.
7. lint + typecheck + unit + integration/security tests.
8. Browser smoke للصفحة المعدلة والصفحات المرتبطة بها عندما تكون واجهة مستخدم.
9. Full Verify Green قبل الدمج.

## Merge Gate

لا يُسمح باعتبار PR جاهزًا للدمج إذا تحقق واحد من الآتي:

- لم يتم تحديد العلاقات المتأثرة.
- يوجد فشل أو skip سببه التعديل في اختبار مطلوب.
- يوجد mismatch بين schema وAPI contract والواجهة.
- تم اختبار Happy Path فقط دون فشل/رفض/صلاحيات.
- يوجد Regression في وظيفة كانت خضراء قبل التعديل.
- لم يتم التحقق من أحدث main/HEAD قبل الدمج.

الدمج يجب أن يستخدم expected HEAD SHA guard متى أمكن، ويُعاد التحقق إذا تحرك main أو تغيرت الملفات المشتركة.

## تعريف النجاح

نجاح التعديل = الوظيفة المطلوبة تعمل + كل العلاقات المتأثرة تعمل + لا Regression مثبت + Full Verify Green.

نجاح الكود أو الشاشة وحدهما لا يكفيان.