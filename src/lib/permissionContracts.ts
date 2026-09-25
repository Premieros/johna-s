import {
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  type Permission,
} from './permissionDefs';

export type PermissionContractKind =
  | 'screen'
  | 'action'
  | 'approval'
  | 'transport'
  | 'administration';

export type PermissionRisk = 'normal' | 'sensitive' | 'critical';

export interface PermissionContract {
  permission: Permission;
  kind: PermissionContractKind;
  risk: PermissionRisk;
  requires: Permission[];
  effectAr: string;
  effectEn: string;
  notesAr?: string;
  notesEn?: string;
}

const REQUIREMENTS: Partial<Record<Permission, Permission[]>> = {
  'pos.order.create': ['pos.view'],
  'pos.order.edit': ['pos.view'],
  'pos.payment.take': ['pos.view'],
  'pos.order.split': ['pos.view'],
  'pos.order.transfer': ['pos.view'],
  'pos.discount': ['pos.view'],
  'pos.change_price': ['pos.view'],
  'pos.hold': ['pos.view'],
  'pos.send_kitchen': ['pos.view'],
  'pos.void': ['pos.view'],
  'pos.cancel_order': ['pos.view'],
  'pos.change_branch': ['pos.view'],
  'pos.kds_update': ['pos.kds_view'],
  'pos.reprint': ['pos.receipt.print'],

  'floor_plan.manage': ['floor_plan.view'],

  'products.create': ['products.view'],
  'products.edit': ['products.view'],
  'products.delete': ['products.view'],
  'products.print': ['products.view'],
  'products.export': ['products.view'],
  'products.import': ['products.view'],
  'categories.manage': ['categories.view'],
  'components.manage': ['components.view'],

  'purchases.manage': ['purchases.view'],
  'purchases.print': ['purchases.view'],
  'purchases.delete': ['purchases.view'],

  'inventory.adjust': ['inventory.view'],
  'inventory.count.create': ['inventory.view'],
  'inventory.count.approve': ['inventory.view'],
  'inventory.count.reject': ['inventory.view'],
  'inventory.count.apply': ['inventory.view'],
  'inventory.transfer.create': ['inventory.view'],
  'inventory.transfer.approve': ['inventory.view'],

  'raw_materials.manage': ['raw_materials.view'],
  'recipes.manage': ['recipes.view'],
  'waste.create': ['waste.view'],
  'waste.approve': ['waste.view'],
  'waste.report': ['waste.view'],
  'warehouses.manage': ['warehouses.view'],

  'customers.manage': ['customers.view'],
  'customers.print': ['customers.view'],
  'customers.export': ['customers.view'],
  'suppliers.manage': ['suppliers.view'],
  'suppliers.print': ['suppliers.view'],
  'expenses.manage': ['expenses.view'],
  'expenses.print': ['expenses.view'],

  'sales.refund.create': ['sales.view'],
  'sales.payment.receive': ['sales.view'],
  'sales.print': ['sales.view'],
  'sales.export': ['sales.view'],
  'refunds.approve': ['sales.view'],

  'reports.print': ['reports.view'],
  'reports.export': ['reports.view'],

  'accounts.manage': ['accounts.view'],
  'accounting.journal.post': ['accounts.view'],
  'accounting.treasury.transfer': ['accounts.view'],
  'accounting.reconciliation.manage': ['accounts.view'],

  'shifts.open': ['shifts.view'],
  'shifts.close': ['shifts.view'],
  'shifts.close_with_open_orders': ['shifts.view', 'shifts.close'],
  'shifts.manage': ['shifts.view'],
  'shifts.report.user': ['shifts.view'],
  'shifts.report.shift': ['shifts.view'],
  'shifts.day_close': ['shifts.view'],

  'approvals.override': ['approvals.review'],
  'approvals.policy.manage': ['approvals.review'],
  'work.authorization.approve': ['approvals.review'],
  'work.authorization.manage': ['work.authorization.approve'],
  'work.authorization.bypass': ['work.authorization.approve'],

  'users.manage': ['users.view'],
  'users.create': ['users.view'],
  'users.branches.manage': ['users.view'],
};

const TRANSPORT = new Set<Permission>([
  'pos.receipt.print',
  'pos.print_kitchen',
]);

const APPROVAL = new Set<Permission>([
  'inventory.count.approve',
  'inventory.count.reject',
  'inventory.count.apply',
  'inventory.transfer.approve',
  'waste.approve',
  'refunds.approve',
  'approvals.review',
  'approvals.override',
  'work.authorization.approve',
  'work.authorization.bypass',
]);

const ADMIN = new Set<Permission>([
  'users.view',
  'users.manage',
  'users.create',
  'users.branches.manage',
  'roles.permissions.manage',
  'audit.view',
  'settings.manage',
  'branches.manage',
  'work.authorization.manage',
]);

const CRITICAL = new Set<Permission>([
  'pos.void',
  'pos.cancel_order',
  'purchases.delete',
  'products.delete',
  'inventory.adjust',
  'inventory.count.approve',
  'inventory.count.reject',
  'inventory.count.apply',
  'inventory.transfer.approve',
  'waste.approve',
  'refunds.approve',
  'shifts.close_with_open_orders',
  'shifts.day_close',
  'approvals.override',
  'work.authorization.manage',
  'work.authorization.bypass',
  'roles.permissions.manage',
  'settings.manage',
  'branches.manage',
  'users.manage',
  'users.branches.manage',
]);

const SENSITIVE = new Set<Permission>([
  'pos.payment.take',
  'pos.discount',
  'pos.change_price',
  'pos.reprint',
  'pos.order.split',
  'pos.order.transfer',
  'sales.refund.create',
  'accounting.journal.post',
  'accounting.treasury.transfer',
  'accounting.reconciliation.manage',
  'shifts.close',
  'approvals.review',
  'approvals.policy.manage',
  'work.authorization.approve',
]);

const EFFECTS: Partial<Record<Permission, { ar: string; en: string; notesAr?: string; notesEn?: string }>> = {
  'pos.view': {
    ar: 'يفتح مساحة نقطة البيع فقط؛ لا يمنح إنشاء أو تعديل أو دفع تلقائيًا.',
    en: 'Opens the POS workspace only; it does not implicitly grant create, edit, or payment.',
  },
  'pos.payment.take': {
    ar: 'يُظهر وينفذ التحصيل داخل POS. يحتاج شفت فرع مفتوح فعليًا، لكنه لا يمنح صلاحية فتح الشفت.',
    en: 'Shows and executes POS payment. An open branch shift must already exist; this does not grant shift opening.',
  },
  'pos.void': {
    ar: 'ينفذ Void لصنف مرسل للمطبخ مباشرة مع السبب والتدقيق ورد المخزون، ويشمل طلب مستخدم آخر داخل نفس الفرع.',
    en: 'Directly voids a sent kitchen item with reason, audit trail, and controlled inventory restoration, including another operator\'s order in the same branch.',
    notesAr: 'هذه الصلاحية لا تمنح تعديل أو نقل أو تغيير مالك طلبات المستخدمين الآخرين؛ الاستثناء محصور في مسار Void المرسل فقط. بدونها يبقى المستخدم على مسار موافقة المدير.',
    notesEn: 'This does not grant general edit, transfer, or ownership changes on other operators\' orders; the exception is limited to the controlled sent-item Void flow. Without it, users stay on the manager-approval path.',
  },
  'pos.cancel_order': {
    ar: 'يُظهر إلغاء الطلب الكامل غير المرسل بعد إدخال سبب واضح.',
    en: 'Shows full cancellation for eligible unsent orders after a required reason.',
    notesAr: 'الطلب الذي أُرسل للمطبخ يجب إلغاء عناصره المرسلة عبر Void أولًا.',
    notesEn: 'Sent orders must void their sent lines through the controlled Void flow first.',
  },
  'pos.receipt.print': {
    ar: 'يسمح بالطباعة الأولى للإيصال، ويُستخدم أيضًا بواسطة وكيل الطباعة الخلفي المصرح.',
    en: 'Allows first receipt printing and may also authorize the background print agent.',
    notesAr: 'مستقلة عمدًا عن pos.view حتى يعمل حساب وكيل الطباعة محدود الصلاحيات.',
    notesEn: 'Intentionally independent from pos.view for least-privilege print-agent accounts.',
  },
  'pos.print_kitchen': {
    ar: 'يسمح بتنفيذ تذاكر المطبخ بواسطة مسار الطباعة التشغيلي.',
    en: 'Allows operational kitchen-ticket execution.',
    notesAr: 'مستقلة عن شاشة POS وإعدادات الطابعات؛ إدارة الطابعات نفسها تبقى settings.manage.',
    notesEn: 'Independent from POS visibility and printer administration; printer settings remain settings.manage-only.',
  },
  'pos.reprint': {
    ar: 'يسمح بإعادة طباعة الإيصال بدون موافقة إضافية.',
    en: 'Allows receipt reprint without an additional approval.',
  },
  'sales.refund.create': {
    ar: 'يُظهر إنشاء المرتجع ويبدأ مسار المرتجع؛ إن لم يملك المستخدم اعتماد المرتجعات ينتقل للموافقة.',
    en: 'Exposes refund creation and starts the refund flow; non-approvers continue through approval.',
  },
  'refunds.approve': {
    ar: 'يسمح بتنفيذ المرتجع مباشرة بدل انتظار موافقة مدير أخرى.',
    en: 'Allows direct refund execution instead of waiting for another manager approval.',
  },
  'shifts.close_with_open_orders': {
    ar: 'استثناء حساس لإغلاق الشفت مع وجود طلبات مفتوحة، ويتطلب أيضًا صلاحية إغلاق الشفت.',
    en: 'Sensitive override for closing a shift with open orders; it also requires normal shift-close permission.',
  },
  'roles.permissions.manage': {
    ar: 'يفتح صفحة الصلاحيات ويسمح بتعديل أدوار النطاق المسموح فقط.',
    en: 'Opens the permissions page and allows editing roles only inside the caller\'s permitted scope.',
    notesAr: 'غير Super Admin لا يستطيع منح صلاحية لا يملكها بنفسه.',
    notesEn: 'Non-Super-Admins cannot grant a permission they do not own themselves.',
  },
  'settings.manage': {
    ar: 'إدارة إعدادات الفرع والطابعات ومحطات المطبخ داخل الفروع المسموح بها.',
    en: 'Manages branch settings, printers, and kitchen stations inside accessible branches.',
  },
  'approvals.override': {
    ar: 'يتجاوز قيد الموافقة الذاتية في المسارات التي تسمح بذلك؛ صلاحية عالية الحساسية.',
    en: 'Overrides self-approval restrictions where supported; this is a high-risk capability.',
  },
  'work.authorization.approve': {
    ar: 'يراجع طلبات بدء العمل ويوافق أو يرفض ويسحب الاعتماد داخل الفروع المسموح بها فقط.',
    en: 'Reviews work-start requests and approves, rejects, or revokes authorization only inside accessible branches.',
    notesAr: 'لا يسمح بالموافقة الذاتية ولا يوسع نطاق الفروع.',
    notesEn: 'Does not permit self-approval and never expands branch scope.',
  },
  'work.authorization.manage': {
    ar: 'يحدد من يحتاج اعتماد بدء العمل داخل الفروع المسموح بها.',
    en: 'Configures which users require work authorization inside accessible branches.',
    notesAr: 'يتطلب صلاحية اعتماد بدء العمل ولا يسمح بإدارة مستخدم خارج نطاق الفروع.',
    notesEn: 'Requires work authorization approval capability and cannot manage users outside accessible branches.',
  },
  'work.authorization.bypass': {
    ar: 'يتجاوز شرط اعتماد بدء العمل لحامل الصلاحية نفسه.',
    en: 'Bypasses the work-authorization requirement for the permission holder.',
    notesAr: 'صلاحية حرجة ولا تمنح أي صلاحية تشغيل أخرى؛ صلاحيات العملية الأصلية تبقى مطلوبة.',
    notesEn: 'Critical capability that grants no operational permission by itself; the original action permission is still required.',
  },
};

function kindOf(permission: Permission): PermissionContractKind {
  if (TRANSPORT.has(permission)) return 'transport';
  if (APPROVAL.has(permission)) return 'approval';
  if (ADMIN.has(permission)) return 'administration';
  if (
    permission.endsWith('.view')
    || permission === 'reports.financial'
    || permission === 'reports.costing'
  ) {
    return 'screen';
  }
  return 'action';
}

function riskOf(permission: Permission): PermissionRisk {
  if (CRITICAL.has(permission)) return 'critical';
  if (SENSITIVE.has(permission)) return 'sensitive';
  return 'normal';
}

export const PERMISSION_CONTRACTS: Record<Permission, PermissionContract> =
  Object.fromEntries(
    ALL_PERMISSIONS.map((permission) => {
      const labels = PERMISSION_LABELS[permission];
      const effect = EFFECTS[permission];
      return [
        permission,
        {
          permission,
          kind: kindOf(permission),
          risk: riskOf(permission),
          requires: [...(REQUIREMENTS[permission] ?? [])],
          effectAr: effect?.ar ?? labels.ar,
          effectEn: effect?.en ?? labels.en,
          notesAr: effect?.notesAr,
          notesEn: effect?.notesEn,
        } satisfies PermissionContract,
      ];
    }),
  ) as Record<Permission, PermissionContract>;

export function permissionContract(permission: Permission): PermissionContract {
  return PERMISSION_CONTRACTS[permission];
}

export function expandPermissionDependencies(input: Iterable<Permission>): Permission[] {
  const selected = new Set<Permission>(input);
  let changed = true;
  while (changed) {
    changed = false;
    for (const permission of [...selected]) {
      for (const required of PERMISSION_CONTRACTS[permission].requires) {
        if (!selected.has(required)) {
          selected.add(required);
          changed = true;
        }
      }
    }
  }
  return ALL_PERMISSIONS.filter((permission) => selected.has(permission));
}

export function removePermissionWithDependents(
  input: Iterable<Permission>,
  permission: Permission,
): Permission[] {
  const selected = new Set<Permission>(input);
  selected.delete(permission);

  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of [...selected]) {
      const required = PERMISSION_CONTRACTS[candidate].requires;
      if (required.some((dependency) => !selected.has(dependency))) {
        selected.delete(candidate);
        changed = true;
      }
    }
  }

  return ALL_PERMISSIONS.filter((candidate) => selected.has(candidate));
}

export function missingPermissionDependencies(input: Iterable<Permission>): Array<{
  permission: Permission;
  missing: Permission[];
}> {
  const selected = new Set(input);
  return [...selected]
    .map((permission) => ({
      permission,
      missing: PERMISSION_CONTRACTS[permission].requires.filter((required) => !selected.has(required)),
    }))
    .filter((row) => row.missing.length > 0);
}

export const POS_INTERACTIVE_PRESET_SCOPE: Permission[] = [
  'pos.view',
  'pos.order.create',
  'pos.order.edit',
  'pos.payment.take',
  'pos.order.split',
  'pos.order.transfer',
  'pos.discount',
  'pos.change_price',
  'pos.hold',
  'pos.send_kitchen',
  'pos.void',
  'pos.cancel_order',
  'pos.change_branch',
  'floor_plan.view',
  'floor_plan.manage',
];

export const POS_PERMISSION_PRESETS: Record<
  'view_only' | 'payment_only',
  { ar: string; en: string; permissions: Permission[]; noteAr: string; noteEn: string }
> = {
  view_only: {
    ar: 'عرض POS فقط',
    en: 'POS view only',
    permissions: ['pos.view'],
    noteAr: 'يرى شاشة البيع بدون إنشاء أو تعديل أو دفع.',
    noteEn: 'Can open POS without create, edit, or payment capability.',
  },
  payment_only: {
    ar: 'POS دفع فقط',
    en: 'POS payment only',
    permissions: ['pos.view', 'pos.payment.take'],
    noteAr: 'يفتح POS ويحصّل الطلبات المرسلة فقط. يحتاج شفت فرع مفتوح مسبقًا.',
    noteEn: 'Opens POS and takes payment for sent orders only. Requires an already-open branch shift.',
  },
};
