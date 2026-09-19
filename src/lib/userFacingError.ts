export type ErrorLanguage = 'ar' | 'en';

const ARABIC_RE = /[\u0600-\u06FF]/;
const TECHNICAL_MARKERS = [
  'permission_denied',
  'target_out_of_scope',
  'branch_access_denied',
  'role_not_assignable',
  'unknown_role',
  'violates row-level security',
  'duplicate key',
  'foreign key',
  'invalid input syntax',
  'postgres',
  'postgrest',
  'jwt',
  'fetch failed',
  'failed to fetch',
  'networkerror',
  'timeout',
  'relation "',
  'column "',
  'sqlstate',
  'pgrst',
  '42p01',
  '42703',
  '23505',
  '23503',
  '23514',
];

const permissionLabels: Record<string, { ar: string; en: string }> = {
  'users.create': { ar: 'إنشاء المستخدمين', en: 'Create users' },
  'users.manage': { ar: 'إدارة المستخدمين', en: 'Manage users' },
  'users.branches.manage': { ar: 'إدارة فروع المستخدمين', en: 'Manage user branch access' },
  'pos.payment.take': { ar: 'تحصيل المدفوعات', en: 'Take payments' },
  'pos.view': { ar: 'عرض نقطة البيع', en: 'View POS' },
  'pos.order.create': { ar: 'إنشاء الطلبات', en: 'Create orders' },
  'pos.order.edit': { ar: 'تعديل الطلبات', en: 'Edit orders' },
  'pos.send_kitchen': { ar: 'إرسال الطلب للمطبخ', en: 'Send orders to kitchen' },
  'pos.receipt.print': { ar: 'طباعة الإيصالات', en: 'Print receipts' },
  'settings.manage': { ar: 'إدارة الإعدادات', en: 'Manage settings' },
  'recipes.manage': { ar: 'إدارة الوصفات', en: 'Manage recipes' },
  'products.create': { ar: 'إنشاء المنتجات', en: 'Create products' },
  'products.edit': { ar: 'تعديل المنتجات', en: 'Edit products' },
  'inventory.adjust': { ar: 'تعديل المخزون', en: 'Adjust inventory' },
  'shifts.open': { ar: 'فتح الشفت', en: 'Open shift' },
  'shifts.close': { ar: 'إغلاق الشفت', en: 'Close shift' },
};

const messages: Record<string, { ar: string; en: string }> = {
  AUTH_REQUIRED: {
    ar: 'انتهت جلسة الدخول أو لم يتم تسجيل الدخول. سجّل الدخول مرة أخرى ثم حاول.',
    en: 'Your session is missing or expired. Sign in again and retry.',
  },
  PERMISSION_DENIED: {
    ar: 'لا تملك الصلاحية المطلوبة لتنفيذ هذه العملية.',
    en: 'You do not have the required permission for this action.',
  },
  TARGET_OUT_OF_SCOPE: {
    ar: 'لا يمكنك إدارة هذا السجل لأنه يتبع فرعًا خارج الفروع المسموح لك بها.',
    en: 'You cannot manage this record because it belongs to a branch outside your allowed scope.',
  },
  BRANCH_ACCESS_DENIED: {
    ar: 'هذا الفرع غير موجود ضمن الفروع المسموح لك بإدارتها.',
    en: 'This branch is outside the branches you are allowed to manage.',
  },
  ROLE_NOT_ASSIGNABLE: {
    ar: 'لا يمكن تعيين هذا الدور في الفرع المحدد. اختر دورًا صالحًا لهذا الفرع.',
    en: 'This role cannot be assigned in the selected branch. Choose a role valid for that branch.',
  },
  UNKNOWN_ROLE: {
    ar: 'الدور المحدد غير موجود أو غير نشط.',
    en: 'The selected role does not exist or is inactive.',
  },
  EMAIL_TAKEN: {
    ar: 'البريد الإلكتروني مستخدم بالفعل لمستخدم آخر.',
    en: 'This email address is already used by another user.',
  },
  USERNAME_TAKEN: {
    ar: 'اسم المستخدم مستخدم بالفعل. اختر اسمًا مختلفًا.',
    en: 'This username is already in use. Choose a different one.',
  },
  EMAIL_REQUIRED: {
    ar: 'أدخل البريد الإلكتروني أولًا.',
    en: 'Enter an email address first.',
  },
  USER_CREATION_DISABLED: {
    ar: 'إنشاء مستخدمين جدد متوقف حاليًا من إعدادات النظام.',
    en: 'Creating new users is currently disabled in system settings.',
  },
  LAST_ADMIN: {
    ar: 'لا يمكن حذف أو تعطيل آخر Super Admin في النظام.',
    en: 'The last Super Admin cannot be deleted or disabled.',
  },
  AT_LEAST_ONE_BRANCH: {
    ar: 'يجب اختيار فرع واحد على الأقل للمستخدم.',
    en: 'Select at least one branch for the user.',
  },
  WAREHOUSE_BRANCH_MISMATCH: {
    ar: 'المستودع المحدد لا يتبع الفرع المختار. اختر مستودعًا من نفس الفرع.',
    en: 'The selected warehouse does not belong to the selected branch.',
  },
  SUPPLIER_BRANCH_MISMATCH: {
    ar: 'المورد المحدد لا يتبع الفرع المختار. اختر موردًا من نفس الفرع.',
    en: 'The selected supplier does not belong to the selected branch.',
  },
  PURCHASE_BRANCH_REQUIRED: {
    ar: 'يجب تحديد الفرع قبل حفظ فاتورة المشتريات.',
    en: 'Select a branch before saving the purchase invoice.',
  },
  INSUFFICIENT_STOCK: {
    ar: 'الكمية المطلوبة غير متاحة في المخزون الحالي.',
    en: 'The requested quantity is not available in current stock.',
  },
  MANAGER_APPROVAL_REQUIRED: {
    ar: 'هذه العملية تحتاج موافقة مدير. تم إيقاف التنفيذ حتى تتم الموافقة.',
    en: 'This action requires manager approval. Execution is paused until approval.',
  },
  APPROVAL_REQUIRED: {
    ar: 'هذه العملية تحتاج موافقة قبل تنفيذها.',
    en: 'This action requires approval before it can be completed.',
  },
  SHIFT_NOT_OPEN: {
    ar: 'لا يوجد شفت مفتوح لهذا المستخدم أو المحطة. افتح الشفت أولًا.',
    en: 'There is no open shift for this user or station. Open a shift first.',
  },
  NO_OPEN_SHIFT: {
    ar: 'لا يوجد شفت مفتوح حاليًا.',
    en: 'There is no open shift right now.',
  },
  SHIFT_ALREADY_CLOSED: {
    ar: 'هذا الشفت مغلق بالفعل ولا يمكن تنفيذ العملية عليه.',
    en: 'This shift is already closed.',
  },
  OPEN_ORDERS_EXIST: {
    ar: 'لا يمكن الإغلاق لأن هناك طلبات مفتوحة. أغلق أو عالج الطلبات أولًا.',
    en: 'Closing is blocked because there are open orders. Resolve them first.',
  },
  SENT_ITEM_APPROVAL_REQUIRED: {
    ar: 'هذا الصنف أُرسل للمطبخ بالفعل، وتعديله يحتاج مسار الموافقة.',
    en: 'This item was already sent to kitchen and changing it requires approval.',
  },
  SENT_ITEM_CHANGE_REQUIRES_VOID: {
    ar: 'هذا الصنف أُرسل للمطبخ بالفعل. استخدم إلغاء الصنف (Void) بدل تعديل الكمية مباشرة.',
    en: 'This item was already sent to kitchen. Use Void instead of changing the sent quantity directly.',
  },
  SENT_ITEM_VOID_INCOMPLETE: {
    ar: 'تعذر إكمال إلغاء الصنف المرسل. حدّث الطلب وحاول مرة أخرى.',
    en: 'The sent-item void could not be completed. Refresh the order and retry.',
  },
  KITCHEN_EVENT_OVERAGE_REPAIR_FAILED: {
    ar: 'تعذر مزامنة سجل إرسال المطبخ مع المخزون. حدّث الطلب وحاول مرة أخرى.',
    en: 'Kitchen dispatch and inventory could not be reconciled. Refresh and retry.',
  },
  ITEM_ALREADY_SENT: {
    ar: 'لا يمكن تنفيذ هذه العملية لأن الصنف أُرسل للمطبخ بالفعل.',
    en: 'This action cannot be completed because the item was already sent to kitchen.',
  },
  MODIFIER_GROUP_HAS_OPEN_ORDERS: {
    ar: 'لا يمكن تعديل أو حذف مجموعة الإضافات لأنها مستخدمة في طلبات مفتوحة.',
    en: 'This modifier group cannot be changed or deleted while it is used by open orders.',
  },
  ROLE_IN_USE: {
    ar: 'لا يمكن حذف هذا الدور لأنه مستخدم بواسطة مستخدمين حاليين.',
    en: 'This role cannot be deleted because users are currently assigned to it.',
  },
  SYSTEM_ROLE: {
    ar: 'هذا دور أساسي في النظام ولا يمكن حذفه.',
    en: 'This is a system role and cannot be deleted.',
  },
};

function currentLanguage(): ErrorLanguage {
  if (typeof document !== 'undefined' && document.documentElement.lang?.toLowerCase().startsWith('en')) return 'en';
  return 'ar';
}

function extractMessage(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input.trim();
  if (input instanceof Error) return input.message.trim();
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    for (const key of ['detail', 'message', 'error', 'code']) {
      if (typeof obj[key] === 'string' && obj[key]) return String(obj[key]).trim();
    }
  }
  return String(input).trim();
}

function permissionLabel(code: string, lang: ErrorLanguage): string {
  return permissionLabels[code]?.[lang] || code;
}

function mappedCode(text: string): string | null {
  const upper = text.toUpperCase();
  for (const code of Object.keys(messages)) {
    if (upper.includes(code)) return code;
  }
  return null;
}

function looksTechnical(text: string): boolean {
  const lower = text.toLowerCase();
  return TECHNICAL_MARKERS.some((marker) => lower.includes(marker))
    || /\b(?:SQLSTATE|PGRST|PostgREST|PostgreSQL)\b/i.test(text)
    || /\b(?:23505|23503|23514|42501|42P01|42703)\b/i.test(text);
}

export function userFacingErrorMessage(input: unknown, lang: ErrorLanguage = currentLanguage()): string {
  const text = extractMessage(input);
  if (!text) {
    return lang === 'ar'
      ? 'تعذر إكمال العملية. حاول مرة أخرى، وإذا استمرت المشكلة تواصل مع مسؤول النظام.'
      : 'The action could not be completed. Retry, and contact the system administrator if the problem continues.';
  }

  const assignPermission = text.match(/cannot assign role containing permission\s+([a-z0-9_.-]+)/i);
  if (assignPermission) {
    const permission = assignPermission[1];
    return lang === 'ar'
      ? `لا يمكنك تعيين هذا الدور لأنه يحتوي على صلاحية لا تملكها: ${permissionLabel(permission, lang)} (${permission}). اطلب إضافة الصلاحية لك أو اختر دورًا بصلاحيات ضمن نطاقك.`
      : `You cannot assign this role because it contains a permission you do not have: ${permissionLabel(permission, lang)} (${permission}). Ask for that permission or choose a role within your permissions.`;
  }

  const requiredPermission = text.match(/(?:permission|PERMISSION_DENIED:)\s*([a-z0-9_.-]+)/i);
  if (requiredPermission && requiredPermission[1].includes('.')) {
    const permission = requiredPermission[1];
    return lang === 'ar'
      ? `لا تملك الصلاحية المطلوبة لتنفيذ العملية: ${permissionLabel(permission, lang)} (${permission}).`
      : `You do not have the required permission: ${permissionLabel(permission, lang)} (${permission}).`;
  }

  const code = mappedCode(text);
  if (code) return messages[code][lang];

  if (/row-level security|violates.*policy|42501/i.test(text)) {
    return lang === 'ar'
      ? 'لا تملك صلاحية الوصول إلى هذه البيانات في الفرع الحالي.'
      : 'You do not have permission to access this data in the current branch.';
  }
  if (/duplicate key|23505|already exists/i.test(text)) {
    return lang === 'ar'
      ? 'يوجد سجل بنفس البيانات بالفعل. راجع الاسم أو الكود أو الرقم ثم حاول مرة أخرى.'
      : 'A record with the same identifying data already exists. Check the name, code, or number and retry.';
  }
  if (/foreign key|23503|still referenced|is referenced by/i.test(text)) {
    return lang === 'ar'
      ? 'لا يمكن تنفيذ العملية لأن هذا السجل مرتبط ببيانات أخرى مستخدمة في النظام.'
      : 'This action cannot be completed because the record is linked to other data in the system.';
  }
  if (/check constraint|23514/i.test(text)) {
    return lang === 'ar'
      ? 'إحدى القيم المدخلة غير مسموح بها. راجع البيانات المطلوبة ثم حاول مرة أخرى.'
      : 'One of the entered values is not allowed. Review the required data and retry.';
  }
  if (/failed to fetch|fetch failed|networkerror|network request failed|connection/i.test(text)) {
    return lang === 'ar'
      ? 'تعذر الاتصال بالخادم. تحقق من الإنترنت ثم حاول مرة أخرى.'
      : 'Could not reach the server. Check your internet connection and retry.';
  }
  if (/jwt.*expired|token.*expired|session.*expired/i.test(text)) {
    return lang === 'ar'
      ? 'انتهت جلسة الدخول. سجّل الدخول مرة أخرى ثم أعد المحاولة.'
      : 'Your session has expired. Sign in again and retry.';
  }
  if (/timeout|timed out/i.test(text)) {
    return lang === 'ar'
      ? 'استغرقت العملية وقتًا أطول من المتوقع. حاول مرة أخرى.'
      : 'The operation took longer than expected. Please retry.';
  }
  if (/invalid input syntax|invalid uuid|malformed/i.test(text)) {
    return lang === 'ar'
      ? 'إحدى القيم المدخلة غير صحيحة. راجع البيانات ثم حاول مرة أخرى.'
      : 'One of the entered values is invalid. Review the data and retry.';
  }
  if (/relation .* does not exist|column .* does not exist|42p01|42703/i.test(text)) {
    return lang === 'ar'
      ? 'يوجد عدم توافق في إعدادات النظام أو قاعدة البيانات. لم يتم تنفيذ العملية؛ تواصل مع مسؤول النظام.'
      : 'There is a system/database configuration mismatch. The action was not completed; contact the system administrator.';
  }

  if (ARABIC_RE.test(text) && !looksTechnical(text)) return text;
  if (lang === 'en' && !looksTechnical(text) && text.length <= 220) return text;

  return lang === 'ar'
    ? 'تعذر إكمال العملية بسبب خطأ في النظام. لم يتم تنفيذ التغيير؛ حاول مرة أخرى وإذا استمرت المشكلة تواصل مع مسؤول النظام.'
    : 'The action could not be completed because of a system error. No change was made; retry and contact the system administrator if it continues.';
}
