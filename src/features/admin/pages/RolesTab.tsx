import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCheck,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useRoles, type RoleScope } from '@/context/RolesContext';
import { useBranches } from '@/hooks/useBranches';
import { useAuth } from '@/context/AuthContext';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { logAudit } from '@/lib/audit';
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  ROLE_META,
  useCan,
  type Permission,
} from '@/lib/permissions';
import {
  expandPermissionDependencies,
  missingPermissionDependencies,
  permissionContract,
  POS_INTERACTIVE_PRESET_SCOPE,
  POS_PERMISSION_PRESETS,
  removePermissionWithDependents,
} from '@/lib/permissionContracts';
import type { Role } from '@/lib/types';

function samePermissions(a: Permission[], b: Permission[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((permission, index) => permission === right[index]);
}

function riskLabel(
  risk: ReturnType<typeof permissionContract>['risk'],
  isAr: boolean,
): { text: string; className: string } {
  if (risk === 'critical') {
    return {
      text: isAr ? 'عالية الحساسية' : 'Critical',
      className: 'bg-ui-danger-soft text-ui-danger',
    };
  }
  if (risk === 'sensitive') {
    return {
      text: isAr ? 'حساسة' : 'Sensitive',
      className: 'bg-ui-warning-soft text-ui-warning',
    };
  }
  return {
    text: isAr ? 'تشغيلية' : 'Operational',
    className: 'bg-ui-page-alt text-ui-subtle',
  };
}

function kindLabel(
  kind: ReturnType<typeof permissionContract>['kind'],
  isAr: boolean,
): string {
  const labels = {
    screen: isAr ? 'شاشة' : 'Screen',
    action: isAr ? 'إجراء' : 'Action',
    approval: isAr ? 'اعتماد' : 'Approval',
    transport: isAr ? 'تشغيل/طباعة' : 'Transport',
    administration: isAr ? 'إدارة' : 'Administration',
  };
  return labels[kind];
}

export function RolesTab() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { user } = useAuth();
  const can = useCan();
  const canManageRoles = can('roles.permissions.manage');
  const isPlatformAdmin = user?.role === 'super_admin';
  const {
    rolePermissionsMap,
    roleMeta,
    rolesList,
    loading,
    saveRole,
    createRole,
    deleteRole,
  } = useRoles();
  const { branches } = useBranches();
  const isAr = lang === 'ar';

  const [drafts, setDrafts] = useState<Record<string, Permission[]>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({
    role: '',
    name_ar: '',
    name_en: '',
    scope: 'global' as RoleScope,
    branch_id: '',
    description_ar: '',
    description_en: '',
  });
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [showAdvancedDetails, setShowAdvancedDetails] = useState(false);

  useEffect(() => {
    if (loading || Object.keys(rolePermissionsMap).length === 0) return;
    setDrafts((prev) => {
      const merged = { ...prev };
      for (const role of Object.keys(rolePermissionsMap)) {
        if (!merged[role]) merged[role] = [...rolePermissionsMap[role]];
      }
      return merged;
    });
  }, [loading, rolePermissionsMap]);

  const branchIsVisible = (branchId: string | null | undefined) =>
    !branchId || branches.some((branch) => branch.id === branchId);

  const roles: string[] = rolesList.length > 0
    ? rolesList
        .filter((role) =>
          isPlatformAdmin || (role.scope === 'branch' && branchIsVisible(role.branch_id)),
        )
        .map((role) => role.role)
    : (isPlatformAdmin ? Object.keys(ROLE_META) : []);

  useEffect(() => {
    if (roles.length === 0) return;
    if (!selectedRole || !roles.includes(selectedRole)) setSelectedRole(roles[0]);
  }, [roles, selectedRole]);

  const currentRole = selectedRole || roles[0] || '';
  const currentDef = rolesList.find((role) => role.role === currentRole);
  const currentSystem = !!ROLE_META[currentRole as Role];
  const currentPlatformAdmin = currentRole === 'super_admin';
  const currentCustom = !!currentRole && !currentSystem;
  const currentPermissions = drafts[currentRole] ?? rolePermissionsMap[currentRole] ?? [];
  const persistedPermissions = rolePermissionsMap[currentRole] ?? [];

  const mayEditRole = (role: string) => {
    if (!canManageRoles || role === 'super_admin') return false;
    if (isPlatformAdmin) return true;
    const def = rolesList.find((candidate) => candidate.role === role);
    return def?.scope === 'branch' && branchIsVisible(def.branch_id);
  };

  const canGrantPermission = (permission: Permission): boolean =>
    isPlatformAdmin || can(permission);

  const unavailablePermissions = isPlatformAdmin
    ? []
    : currentPermissions.filter((permission) => !canGrantPermission(permission));
  const currentHasUnownedPermissions = unavailablePermissions.length > 0;
  const canEditCurrent = mayEditRole(currentRole) && !currentHasUnownedPermissions;

  const dependencyErrors = missingPermissionDependencies(currentPermissions);

  const hasUnsavedChanges = !samePermissions(
    currentPermissions,
    persistedPermissions,
  );

  const setDraft = (role: string, permissions: Permission[]) => {
    setDrafts((prev) => ({ ...prev, [role]: permissions }));
  };

  const requiredClosureCanBeGranted = (permission: Permission): {
    ok: boolean;
    required: Permission[];
    blocked: Permission[];
  } => {
    const required = expandPermissionDependencies([permission]);
    const blocked = required.filter(
      (candidate) =>
        !currentPermissions.includes(candidate) && !canGrantPermission(candidate),
    );
    return { ok: blocked.length === 0, required, blocked };
  };

  const toggle = (role: string, permission: Permission) => {
    if (!mayEditRole(role)) return;
    const list = drafts[role] ?? rolePermissionsMap[role] ?? [];
    const has = list.includes(permission);

    if (has) {
      setDraft(role, removePermissionWithDependents(list, permission));
      return;
    }

    const check = requiredClosureCanBeGranted(permission);
    if (!check.ok) {
      show(
        isAr
          ? `لا يمكنك منح ${permission} لأنك لا تملك: ${check.blocked.join(', ')}`
          : `You cannot grant ${permission}; missing grant authority for: ${check.blocked.join(', ')}`,
        'error',
      );
      return;
    }

    setDraft(role, expandPermissionDependencies([...list, permission]));
  };

  const ownedGrantableCatalog = (): Permission[] => {
    if (isPlatformAdmin) return [...ALL_PERMISSIONS];
    const owned = ALL_PERMISSIONS.filter((permission) => canGrantPermission(permission));
    const selected = owned.filter((permission) => {
      const closure = expandPermissionDependencies([permission]);
      return closure.every((dependency) => canGrantPermission(dependency));
    });
    return expandPermissionDependencies(selected).filter((permission) =>
      canGrantPermission(permission),
    );
  };

  const setAll = (role: string, value: boolean) => {
    if (!mayEditRole(role)) return;
    setDraft(role, value ? ownedGrantableCatalog() : []);
  };

  const setGroup = (role: string, permissions: Permission[], value: boolean) => {
    if (!mayEditRole(role)) return;
    let next = drafts[role] ?? rolePermissionsMap[role] ?? [];

    if (!value) {
      for (const permission of permissions) {
        if (next.includes(permission)) {
          next = removePermissionWithDependents(next, permission);
        }
      }
      setDraft(role, next);
      return;
    }

    const blocked: Permission[] = [];
    for (const permission of permissions) {
      const check = requiredClosureCanBeGranted(permission);
      if (!check.ok) {
        blocked.push(permission);
        continue;
      }
      next = expandPermissionDependencies([...next, permission]);
    }

    setDraft(role, next);
    if (blocked.length > 0) {
      show(
        isAr
          ? `تم تجاهل صلاحيات لا تملك حق منحها: ${blocked.join(', ')}`
          : `Skipped permissions you cannot grant: ${blocked.join(', ')}`,
        'info',
      );
    }
  };

  const applyPosPreset = (presetKey: keyof typeof POS_PERMISSION_PRESETS) => {
    if (!canEditCurrent) return;
    const preset = POS_PERMISSION_PRESETS[presetKey];
    const blocked = preset.permissions.filter(
      (permission) => !currentPermissions.includes(permission) && !canGrantPermission(permission),
    );
    if (blocked.length > 0) {
      show(
        isAr
          ? `لا يمكنك تطبيق هذا القالب لأنك لا تملك: ${blocked.join(', ')}`
          : `Cannot apply this preset; you cannot grant: ${blocked.join(', ')}`,
        'error',
      );
      return;
    }

    const preserved = currentPermissions.filter(
      (permission) => !POS_INTERACTIVE_PRESET_SCOPE.includes(permission),
    );
    setDraft(
      currentRole,
      expandPermissionDependencies([...preserved, ...preset.permissions]),
    );
  };

  const resetDraft = () => {
    if (!currentRole) return;
    setDraft(currentRole, [...persistedPermissions]);
  };

  const save = async (role: string) => {
    if (!mayEditRole(role)) return;
    const draft = drafts[role] ?? [];

    const missing = missingPermissionDependencies(draft);
    if (missing.length > 0) {
      const first = missing[0];
      show(
        isAr
          ? `لا يمكن الحفظ: ${first.permission} تحتاج ${first.missing.join(', ')}`
          : `Cannot save: ${first.permission} requires ${first.missing.join(', ')}`,
        'error',
      );
      return;
    }

    if (!isPlatformAdmin) {
      const unowned = draft.filter((permission) => !canGrantPermission(permission));
      if (unowned.length > 0) {
        show(
          isAr
            ? `لا يمكن الحفظ قبل إزالة صلاحيات لا تملكها: ${unowned.join(', ')}`
            : `Remove permissions you do not own before saving: ${unowned.join(', ')}`,
          'error',
        );
        return;
      }
    }

    setSavingRole(role);
    const ok = await saveRole(role, draft);
    setSavingRole(null);
    if (ok) show(t('saveSuccess'), 'success');
    else {
      show(
        isAr
          ? 'تعذر حفظ الصلاحيات. راجع نطاق الفرع والصلاحيات التي تملك حق منحها.'
          : 'Failed to save permissions. Check branch scope and grant authority.',
        'error',
      );
    }
  };

  const openCreate = () => {
    if (!canManageRoles) return;
    setCreateForm({
      role: '',
      name_ar: '',
      name_en: '',
      scope: isPlatformAdmin ? 'global' : 'branch',
      branch_id: isPlatformAdmin ? '' : (branches[0]?.id || ''),
      description_ar: '',
      description_en: '',
    });
    setCreating(true);
  };

  const submitCreate = async () => {
    if (!canManageRoles) return;
    if (!createForm.role.trim() || !createForm.name_ar.trim()) {
      show(t('required'), 'error');
      return;
    }
    const scope: RoleScope = isPlatformAdmin ? createForm.scope : 'branch';
    const branchId = scope === 'branch' ? (createForm.branch_id || null) : null;
    if (scope === 'branch' && !branchId) {
      show(t('required'), 'error');
      return;
    }

    const res = await createRole({
      role: createForm.role,
      name_ar: createForm.name_ar,
      name_en: createForm.name_en,
      scope,
      branch_id: branchId,
      description_ar: createForm.description_ar,
      description_en: createForm.description_en,
      permissions: [],
    });

    if (!res.success) {
      if (res.error === 'ROLE_EXISTS') {
        show(isAr ? 'الدور موجود بالفعل' : 'Role already exists', 'error');
      } else if (res.error === 'ROLE_CODE_REQUIRED') {
        show(isAr ? 'أدخل رمزًا صالحًا للدور' : 'Enter a valid role code', 'error');
      } else {
        show(
          `${isAr ? 'تعذر إنشاء الدور: ' : 'Failed to create role: '}${res.error || 'unknown'}`,
          'error',
        );
      }
      return;
    }

    await logAudit('create', 'roles', res.role, {
      role: createForm.role,
      scope,
      branch_id: branchId,
    });
    show(t('saveSuccess'), 'success');
    setCreating(false);
    setSelectedRole(res.role || createForm.role);
  };

  const confirmDelete = async () => {
    if (!deleting || !mayEditRole(deleting)) return;
    const roleToDelete = deleting;
    const res = await deleteRole(roleToDelete);
    if (!res.success) {
      if (res.error === 'ROLE_IN_USE') {
        show(
          isAr
            ? 'الدور مستخدم من قبل أحد الموظفين ولا يمكن حذفه'
            : 'Role is assigned to users and cannot be deleted',
          'error',
        );
      } else if (res.error === 'SYSTEM_ROLE') {
        show(
          isAr ? 'لا يمكن حذف الأدوار النظامية' : 'System roles cannot be deleted',
          'error',
        );
      } else if (res.error === 'PERMISSION_DENIED') {
        show(
          isAr ? 'ليس لديك صلاحية حذف هذا الدور' : 'You do not have permission to delete this role',
          'error',
        );
      } else {
        show(
          `${isAr ? 'تعذر حذف الدور: ' : 'Failed to delete role: '}${res.error || 'unknown'}`,
          'error',
        );
      }
      return;
    }
    await logAudit('delete', 'roles', roleToDelete, { role: roleToDelete });
    show(t('deleteSuccess'), 'success');
    setDeleting(null);
    setSelectedRole('');
  };

  const permissionQuery = permissionSearch.trim().toLowerCase();
  const visibleGroups = PERMISSION_GROUPS.map((group) => ({
    ...group,
    permissions: group.permissions
      .filter((permission) => isPlatformAdmin || canGrantPermission(permission))
      .filter((permission) => {
        if (!permissionQuery) return true;
        const labels = PERMISSION_LABELS[permission];
        const contract = permissionContract(permission);
        return (
          (labels?.ar || '').toLowerCase().includes(permissionQuery)
          || (labels?.en || '').toLowerCase().includes(permissionQuery)
          || contract.effectAr.toLowerCase().includes(permissionQuery)
          || contract.effectEn.toLowerCase().includes(permissionQuery)
          || group.ar.toLowerCase().includes(permissionQuery)
          || group.en.toLowerCase().includes(permissionQuery)
        );
      }),
  })).filter((group) => group.permissions.length > 0);

  if (loading) {
    return (
      <Card className="p-10 text-center text-ui-subtle">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mb-3" />
        <p className="text-sm">
          {isAr ? 'جارٍ تحميل الأدوار والصلاحيات...' : 'Loading roles and permissions...'}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="permissions-contract-workspace">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            <h1 className="font-bold text-xl text-ui-text flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-brand-600 dark:text-brand-400" />
              {isAr ? 'الأدوار والصلاحيات التشغيلية' : 'Operational Roles & Permissions'}
            </h1>
            <p className="mt-1 text-sm text-ui-subtle max-w-3xl">
              {isAr
                ? 'حدد فقط الوظائف التي تريد السماح بها لهذا الدور. المتطلبات التقنية تُدار تلقائيًا، ولن تظهر للمدير أي صلاحية أعلى من صلاحياته.'
                : 'Choose only the functions this role may use. Technical prerequisites are handled automatically, and managers never see permissions above their own access.'}
            </p>
          </div>
          {canManageRoles && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="w-4 h-4" />
              {isAr ? 'دور جديد' : 'New role'}
            </Button>
          )}
        </div>
      </Card>

      <Card className="p-3 sm:p-4">
        <div
          className="flex gap-2 overflow-x-auto pb-1"
          role="tablist"
          aria-label={isAr ? 'الأدوار' : 'Roles'}
        >
          {roles.map((role) => {
            const def = rolesList.find((candidate) => candidate.role === role);
            const rolePermissions = drafts[role] ?? rolePermissionsMap[role] ?? [];
            const visibleCount = isPlatformAdmin
              ? rolePermissions.length
              : rolePermissions.filter((permission) => canGrantPermission(permission)).length;
            const visibleCatalogCount = isPlatformAdmin
              ? ALL_PERMISSIONS.length
              : ALL_PERMISSIONS.filter((permission) => canGrantPermission(permission)).length;
            const active = role === currentRole;
            const platformAdmin = role === 'super_admin';
            return (
              <button
                key={role}
                type="button"
                onClick={() => {
                  setSelectedRole(role);
                  setPermissionSearch('');
                }}
                className={`shrink-0 rounded-xl border px-3 py-2 text-start transition ${
                  active
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300'
                    : 'border-ui-border bg-ui-surface text-ui-text hover:bg-ui-page-alt'
                }`}
              >
                <span className="block text-sm font-semibold">
                  {roleMeta[role]?.[lang] || role}
                </span>
                <span className="block text-[11px] text-ui-subtle mt-0.5">
                  {platformAdmin
                    ? (isAr ? 'تجاوز منصة كامل' : 'Full platform bypass')
                    : `${visibleCount}/${visibleCatalogCount}`}
                  {def?.scope === 'branch' ? ` · ${isAr ? 'فرع' : 'Branch'}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {currentRole && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4 mb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-ui-text">
                  {roleMeta[currentRole]?.[lang] || currentRole}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-xs bg-ui-page-alt text-ui-muted">
                  {currentSystem
                    ? (isAr ? 'نظامي' : 'System')
                    : (isAr ? 'مخصص' : 'Custom')}
                </span>
                {currentDef?.scope === 'branch' && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-ui-info-soft text-ui-info">
                    {isAr ? 'فرع' : 'Branch'}:{' '}
                    {branches.find((branch) => branch.id === currentDef.branch_id)?.name || '-'}
                  </span>
                )}
                {hasUnsavedChanges && !currentPlatformAdmin && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-ui-warning-soft text-ui-warning">
                    {isAr ? 'تعديلات غير محفوظة' : 'Unsaved changes'}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-ui-subtle">
                <code>{currentRole}</code> ·{' '}
                {currentPlatformAdmin ? ALL_PERMISSIONS.length : currentPermissions.length}
                {' / '}
                {ALL_PERMISSIONS.length} {isAr ? 'صلاحية' : 'permissions'}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {canEditCurrent && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAll(currentRole, true)}
                  >
                    <CheckCheck className="w-4 h-4" />
                    {isPlatformAdmin
                      ? (isAr ? 'كل الصلاحيات' : 'All permissions')
                      : (isAr ? 'كل ما أملك' : 'All I can grant')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setAll(currentRole, false)}
                  >
                    {t('none')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={resetDraft}
                    disabled={!hasUnsavedChanges}
                  >
                    <RotateCcw className="w-4 h-4" />
                    {isAr ? 'تراجع' : 'Reset'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => save(currentRole)}
                    disabled={
                      savingRole === currentRole
                      || !hasUnsavedChanges
                      || dependencyErrors.length > 0
                      || (!isPlatformAdmin && unavailablePermissions.length > 0)
                    }
                  >
                    <Save className="w-4 h-4" />
                    {savingRole === currentRole ? '...' : t('save')}
                  </Button>
                </>
              )}
              {currentCustom && canEditCurrent && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleting(currentRole)}
                >
                  <Trash2 className="w-4 h-4" />
                  {t('delete')}
                </Button>
              )}
            </div>
          </div>

          {currentPlatformAdmin ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-4 text-sm text-brand-800 dark:border-brand-900 dark:bg-brand-950/20 dark:text-brand-300">
              {isAr
                ? 'سوبر أدمن فقط يملك التجاوز الضمني الكامل. لا يتم تقييده بهذه المصفوفة.'
                : 'Super Admin is the only implicit full-access bypass and is not constrained by this matrix.'}
            </div>
          ) : (
            <>
              {!canEditCurrent && !currentHasUnownedPermissions && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-ui-border bg-ui-page-alt p-3 text-sm text-ui-subtle">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    {isAr
                      ? 'عرض فقط: تحتاج roles.permissions.manage، والأدوار العامة لا يعدلها إلا Super Admin. مدير الفرع يعدّل فقط أدوار الفروع المسموح له بها.'
                      : 'Read only: roles.permissions.manage is required; global roles are Super-Admin-only. Branch managers may edit only roles inside their accessible branches.'}
                  </span>
                </div>
              )}

              {!isPlatformAdmin && currentHasUnownedPermissions && (
                <div className="mb-4 rounded-xl border border-ui-warning/40 bg-ui-warning-soft p-3 text-sm text-ui-warning">
                  <div className="flex gap-2">
                    <Lock className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">
                        {isAr
                          ? 'هذا الدور يتضمن صلاحيات خارج نطاق إدارتك.'
                          : 'This role contains permissions outside your management scope.'}
                      </p>
                      <p className="mt-1 text-xs">
                        {isAr
                          ? 'تم إخفاء هذه الصلاحيات ولن تستطيع تعديل هذا الدور. يلزم مستخدم بصلاحيات أعلى لإدارته.'
                          : 'Those permissions are hidden and this role is read-only for you. A higher-authority user must manage it.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {dependencyErrors.length > 0 && (
                <div className="mb-4 rounded-xl border border-ui-warning/40 bg-ui-warning-soft p-3 text-sm text-ui-warning">
                  <div className="flex gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">
                        {isAr ? 'هذا الدور يحتاج استكمال صلاحيات أساسية.' : 'This role is missing required base permissions.'}
                      </p>
                      {isPlatformAdmin && showAdvancedDetails && (
                        <div className="mt-1 space-y-1 text-xs">
                          {dependencyErrors.slice(0, 6).map((row) => (
                            <p key={row.permission}>
                              <code>{row.permission}</code> → {row.missing.join(', ')}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {canEditCurrent && (
                <div className="mb-4 rounded-xl border border-ui-border bg-ui-page-alt/60 p-3">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ui-text">
                        {isAr ? 'قوالب POS الآمنة' : 'Safe POS presets'}
                      </p>
                      <p className="text-xs text-ui-subtle mt-0.5">
                        {isAr
                          ? 'تغيّر صلاحيات التفاعل داخل POS فقط، ولا تلمس صلاحيات الطباعة الخلفية أو باقي النظام.'
                          : 'Only changes interactive POS capabilities; background printing and non-POS permissions are preserved.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(POS_PERMISSION_PRESETS) as Array<
                        keyof typeof POS_PERMISSION_PRESETS
                      >).map((key) => {
                        const preset = POS_PERMISSION_PRESETS[key];
                        return (
                          <Button
                            key={key}
                            size="sm"
                            variant="outline"
                            onClick={() => applyPosPreset(key)}
                            title={isAr ? preset.noteAr : preset.noteEn}
                          >
                            {isAr ? preset.ar : preset.en}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-ui-subtle" />
                <input
                  value={permissionSearch}
                  onChange={(event) => setPermissionSearch(event.target.value)}
                  placeholder={
                    isAr
                      ? 'ابحث باسم الوظيفة: دفع، إلغاء، طباعة...'
                      : 'Search by function: payment, cancel, print...'
                  }
                  className="w-full rounded-xl border border-ui-border bg-ui-surface py-2.5 ps-9 pe-3 text-sm text-ui-text outline-none focus:border-brand-500"
                />
                </div>
                {isPlatformAdmin && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAdvancedDetails((value) => !value)}
                  >
                    {showAdvancedDetails
                      ? (isAr ? 'إخفاء التفاصيل التقنية' : 'Hide technical details')
                      : (isAr ? 'تفاصيل متقدمة' : 'Advanced details')}
                  </Button>
                )}
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                {visibleGroups.map((group) => {
                  const selectedCount = group.permissions.filter((permission) =>
                    currentPermissions.includes(permission),
                  ).length;
                  const groupAll =
                    group.permissions.length > 0
                    && selectedCount === group.permissions.length;

                  return (
                    <section
                      key={group.key}
                      className="rounded-xl border border-ui-border overflow-hidden bg-ui-surface"
                    >
                      <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-ui-page-alt/70 border-b border-ui-border">
                        <div>
                          <h3 className="font-semibold text-sm text-ui-text">
                            {group[lang]}
                          </h3>
                          <p className="text-[11px] text-ui-subtle">
                            {selectedCount}/{group.permissions.length}{' '}
                            {isAr ? 'مفعّلة' : 'enabled'}
                          </p>
                        </div>
                        {canEditCurrent && (
                          <button
                            type="button"
                            onClick={() =>
                              setGroup(currentRole, group.permissions, !groupAll)
                            }
                            className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                          >
                            {groupAll
                              ? (isAr ? 'إلغاء المجموعة' : 'Clear group')
                              : (isAr ? 'منح المتاح' : 'Grant available')}
                          </button>
                        )}
                      </div>

                      <div className="divide-y divide-ui-border">
                        {group.permissions.map((permission) => {
                          const contract = permissionContract(permission);
                          const checked = currentPermissions.includes(permission);
                          const disabled = !canEditCurrent;
                          const risk = riskLabel(contract.risk, isAr);

                          return (
                            <label
                              key={permission}
                              className={`block px-3 py-3 ${
                                disabled
                                  ? 'cursor-not-allowed opacity-70'
                                  : 'cursor-pointer hover:bg-ui-page-alt/50'
                              }`}
                              data-permission={permission}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-sm font-semibold text-ui-text">
                                      {PERMISSION_LABELS[permission]?.[lang] || permission}
                                    </span>
                                    {isPlatformAdmin && showAdvancedDetails && (
                                      <>
                                        <span
                                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${risk.className}`}
                                        >
                                          {risk.text}
                                        </span>
                                        <span className="rounded-full bg-ui-info-soft px-1.5 py-0.5 text-[10px] text-ui-info">
                                          {kindLabel(contract.kind, isAr)}
                                        </span>
                                      </>
                                    )}
                                  </div>

                                  <p className="mt-1 text-xs leading-5 text-ui-muted">
                                    {isAr ? contract.effectAr : contract.effectEn}
                                  </p>

                                  {(contract.notesAr || contract.notesEn) && (
                                    <p className="mt-1 text-[11px] leading-4 text-ui-subtle">
                                      {isAr ? contract.notesAr : contract.notesEn}
                                    </p>
                                  )}

                                  {isPlatformAdmin && showAdvancedDetails && (
                                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                      <code className="rounded bg-ui-page-alt px-1.5 py-0.5 text-[10px] text-ui-subtle">
                                        {permission}
                                      </code>
                                      {contract.requires.map((required) => (
                                        <span
                                          key={required}
                                          className="rounded bg-ui-page-alt px-1.5 py-0.5 text-[10px] text-ui-subtle"
                                        >
                                          {isAr ? 'يتطلب' : 'requires'} {required}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={() => toggle(currentRole, permission)}
                                  className="mt-1 h-4 w-4 shrink-0 rounded border-ui-border text-brand-600 focus:ring-brand-500"
                                />
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>

              {visibleGroups.length === 0 && (
                <div className="py-10 text-center text-sm text-ui-subtle">
                  {isAr
                    ? 'لا توجد صلاحيات مطابقة للبحث.'
                    : 'No permissions match your search.'}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      <p className="px-1 text-xs text-ui-subtle">
        {isAr
          ? 'الحماية النهائية تبقى في قاعدة البيانات: حدود الفرع، الموافقات، وحظر تصعيد الصلاحيات لا تعتمد على إخفاء الأزرار فقط.'
          : 'The database remains authoritative: branch scope, approvals, and privilege-escalation guards do not rely on button visibility alone.'}
      </p>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={isAr ? 'دور جديد' : 'New role'}
      >
        <div className="space-y-4">
          <Input
            label={isAr ? 'الرمز (بالإنجليزية)' : 'Code (English)'}
            value={createForm.role}
            onChange={(event) =>
              setCreateForm({
                ...createForm,
                role: event.target.value.replace(/\s+/g, '_').toLowerCase(),
              })
            }
            placeholder="floor_supervisor"
            autoComplete="off"
          />
          <Input
            label={isAr ? 'الاسم (عربي)' : 'Name (Arabic)'}
            value={createForm.name_ar}
            onChange={(event) =>
              setCreateForm({ ...createForm, name_ar: event.target.value })
            }
          />
          <Input
            label={isAr ? 'الاسم (إنجليزي)' : 'Name (English)'}
            value={createForm.name_en}
            onChange={(event) =>
              setCreateForm({ ...createForm, name_en: event.target.value })
            }
          />

          {isPlatformAdmin ? (
            <Select
              label={isAr ? 'النطاق' : 'Scope'}
              value={createForm.scope}
              onChange={(event) =>
                setCreateForm({
                  ...createForm,
                  scope: event.target.value as RoleScope,
                })
              }
            >
              <option value="global">
                {isAr ? 'عام (كل الفروع الممنوحة)' : 'Global (all granted branches)'}
              </option>
              <option value="branch">
                {isAr ? 'فرع محدد' : 'Branch-specific'}
              </option>
            </Select>
          ) : (
            <div className="rounded-lg bg-ui-page-alt p-3 text-sm text-ui-subtle">
              {isAr
                ? 'يمكنك إنشاء دور مخصص داخل فرع مسموح لك به فقط.'
                : 'You can create a custom role only inside an accessible branch.'}
            </div>
          )}

          {(isPlatformAdmin ? createForm.scope === 'branch' : true) && (
            <Select
              label={t('branch')}
              value={createForm.branch_id}
              onChange={(event) =>
                setCreateForm({ ...createForm, branch_id: event.target.value })
              }
            >
              <option value="">--</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {isAr ? branch.name : (branch.name_en || branch.name)}
                </option>
              ))}
            </Select>
          )}

          <Input
            label={isAr ? 'الوصف (عربي)' : 'Description (Arabic)'}
            value={createForm.description_ar}
            onChange={(event) =>
              setCreateForm({ ...createForm, description_ar: event.target.value })
            }
          />
          <Input
            label={isAr ? 'الوصف (إنجليزي)' : 'Description (English)'}
            value={createForm.description_en}
            onChange={(event) =>
              setCreateForm({ ...createForm, description_en: event.target.value })
            }
          />

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={submitCreate}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={isAr ? 'حذف الدور' : 'Delete role'}
        message={
          isAr
            ? 'هل تريد حذف هذا الدور؟ لا يمكن حذف دور مستخدم من أحد الموظفين.'
            : 'Delete this role? A role assigned to users cannot be deleted.'
        }
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}
