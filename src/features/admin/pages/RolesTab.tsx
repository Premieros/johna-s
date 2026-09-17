import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, ShieldCheck, Search, CheckCheck, Lock } from 'lucide-react';
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
import { ALL_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_LABELS, ROLE_META, useCan, type Permission } from '@/lib/permissions';
import type { Role } from '@/lib/types';

export function RolesTab() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { user } = useAuth();
  const can = useCan();
  const canManageRoles = can('roles.permissions.manage');
  const isPlatformAdmin = user?.role === 'super_admin';
  const { rolePermissionsMap, roleMeta, rolesList, loading, saveRole, createRole, deleteRole } = useRoles();
  const { branches } = useBranches();
  const isAr = lang === 'ar';
  const [drafts, setDrafts] = useState<Record<string, Permission[]>>({});
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ role: '', name_ar: '', name_en: '', scope: 'global' as RoleScope, branch_id: '', description_ar: '', description_en: '' });
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');

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

  const roles: string[] = rolesList.length > 0 ? rolesList.map((r) => r.role) : Object.keys(ROLE_META);

  useEffect(() => {
    if (roles.length === 0) return;
    if (!selectedRole || !roles.includes(selectedRole)) setSelectedRole(roles[0]);
  }, [roles, selectedRole]);

  const mayEditRole = (role: string) => {
    if (!canManageRoles || role === 'super_admin') return false;
    if (isPlatformAdmin) return true;
    const def = rolesList.find((r) => r.role === role);
    return def?.scope === 'branch';
  };

  const toggle = (role: string, perm: Permission) => {
    if (!mayEditRole(role)) return;
    setDrafts((prev) => {
      const list = prev[role] ?? rolePermissionsMap[role] ?? [];
      const has = list.includes(perm);
      return { ...prev, [role]: has ? list.filter((p) => p !== perm) : [...list, perm] };
    });
  };

  const setAll = (role: string, value: boolean) => {
    if (!mayEditRole(role)) return;
    setDrafts((prev) => ({ ...prev, [role]: value ? [...ALL_PERMISSIONS] : [] }));
  };

  const setGroup = (role: string, permissions: Permission[], value: boolean) => {
    if (!mayEditRole(role)) return;
    setDrafts((prev) => {
      const base = new Set(prev[role] ?? rolePermissionsMap[role] ?? []);
      permissions.forEach((p) => { if (value) base.add(p); else base.delete(p); });
      return { ...prev, [role]: [...base] };
    });
  };

  const save = async (role: string) => {
    if (!mayEditRole(role)) return;
    setSavingRole(role);
    const ok = await saveRole(role, drafts[role] ?? []);
    setSavingRole(null);
    if (ok) show(t('saveSuccess'), 'success');
    else show(isAr ? 'تعذر حفظ الصلاحيات' : 'Failed to save permissions', 'error');
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
    if (!createForm.role.trim() || !createForm.name_ar.trim()) { show(t('required'), 'error'); return; }
    const scope: RoleScope = isPlatformAdmin ? createForm.scope : 'branch';
    const branchId = scope === 'branch' ? (createForm.branch_id || null) : null;
    if (scope === 'branch' && !branchId) { show(t('required'), 'error'); return; }
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
      if (res.error === 'ROLE_EXISTS') show(isAr ? 'الدور موجود بالفعل' : 'Role already exists', 'error');
      else if (res.error === 'ROLE_CODE_REQUIRED') show(isAr ? 'أدخل رمزًا صالحًا للدور' : 'Enter a valid role code', 'error');
      else show(`${isAr ? 'تعذر إنشاء الدور: ' : 'Failed to create role: '}${res.error || 'unknown'}`, 'error');
      return;
    }
    await logAudit('create', 'roles', res.role, { role: createForm.role, scope, branch_id: branchId });
    show(t('saveSuccess'), 'success');
    setCreating(false);
    setSelectedRole(res.role || createForm.role);
  };

  const confirmDelete = async () => {
    if (!deleting || !mayEditRole(deleting)) return;
    const roleToDelete = deleting;
    const res = await deleteRole(roleToDelete);
    if (!res.success) {
      if (res.error === 'ROLE_IN_USE') show(isAr ? 'الدور مستخدم من قبل أحد الموظفين ولا يمكن حذفه' : 'Role is assigned to users and cannot be deleted', 'error');
      else if (res.error === 'SYSTEM_ROLE') show(isAr ? 'لا يمكن حذف الأدوار النظامية' : 'System roles cannot be deleted', 'error');
      else if (res.error === 'PERMISSION_DENIED') show(isAr ? 'ليس لديك صلاحية حذف هذا الدور' : 'You do not have permission to delete this role', 'error');
      else show(`${isAr ? 'تعذر حذف الدور: ' : 'Failed to delete role: '}${res.error || 'unknown'}`, 'error');
      return;
    }
    await logAudit('delete', 'roles', roleToDelete, { role: roleToDelete });
    show(t('deleteSuccess'), 'success');
    setDeleting(null);
    setSelectedRole('');
  };

  const currentRole = selectedRole || roles[0] || '';
  const currentDef = rolesList.find((r) => r.role === currentRole);
  const currentSystem = !!ROLE_META[currentRole as Role];
  const currentPlatformAdmin = currentRole === 'super_admin';
  const currentCustom = !!currentRole && !currentSystem;
  const currentPermissions = drafts[currentRole] ?? rolePermissionsMap[currentRole] ?? [];
  const canEditCurrent = mayEditRole(currentRole);

  const visibleGroups = useMemo(() => {
    const q = permissionSearch.trim().toLowerCase();
    if (!q) return PERMISSION_GROUPS;
    return PERMISSION_GROUPS.map((group) => ({
      ...group,
      permissions: group.permissions.filter((perm) => {
        const labels = PERMISSION_LABELS[perm];
        return perm.toLowerCase().includes(q)
          || (labels?.ar || '').toLowerCase().includes(q)
          || (labels?.en || '').toLowerCase().includes(q)
          || group.ar.toLowerCase().includes(q)
          || group.en.toLowerCase().includes(q);
      }),
    })).filter((group) => group.permissions.length > 0);
  }, [permissionSearch]);

  if (loading) {
    return (
      <Card className="p-10 text-center text-ui-subtle">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600 mx-auto mb-3" />
        <p className="text-sm">{isAr ? 'جارٍ تحميل الأدوار...' : 'Loading roles...'}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-ui-text flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-brand-600 dark:text-brand-400" /> {t('rolesTab')}
            </h3>
            <p className="mt-1 text-sm text-ui-subtle">
              {isAr ? 'اسم الدور للتنظيم فقط؛ الصلاحيات المحددة هنا هي التي تتحكم فعليًا في الوصول. سوبر أدمن فقط خارج هذه المصفوفة.' : 'Role names are organizational labels; the permissions selected here control real access. Only Super Admin is outside this matrix.'}
            </p>
          </div>
          {canManageRoles && <Button size="sm" onClick={openCreate}><Plus className="w-4 h-4" /> {isAr ? 'دور جديد' : 'New role'}</Button>}
        </div>
      </Card>

      <Card className="p-3 sm:p-4">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={isAr ? 'الأدوار' : 'Roles'}>
          {roles.map((role) => {
            const def = rolesList.find((r) => r.role === role);
            const count = (drafts[role] ?? rolePermissionsMap[role] ?? []).length;
            const active = role === currentRole;
            const platformAdmin = role === 'super_admin';
            return (
              <button
                key={role}
                type="button"
                onClick={() => { setSelectedRole(role); setPermissionSearch(''); }}
                className={`shrink-0 rounded-xl border px-3 py-2 text-start transition ${active ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-300' : 'border-ui-border bg-ui-surface text-ui-text hover:bg-ui-page-alt'}`}
              >
                <span className="block text-sm font-semibold">{roleMeta[role]?.[lang] || role}</span>
                <span className="block text-[11px] text-ui-subtle mt-0.5">
                  {platformAdmin ? (isAr ? 'وصول منصة كامل' : 'Full platform access') : `${count}/${ALL_PERMISSIONS.length}`}
                  {def?.scope === 'branch' ? ` · ${isAr ? 'فرع' : 'Branch'}` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {currentRole && (
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-lg font-bold text-ui-text">{roleMeta[currentRole]?.[lang] || currentRole}</h4>
                <span className="px-2 py-0.5 rounded-full text-xs bg-ui-page-alt text-ui-muted">{currentSystem ? (isAr ? 'نظامي' : 'System') : (isAr ? 'مخصص' : 'Custom')}</span>
                {currentDef?.scope === 'branch' && (
                  <span className="px-2 py-0.5 rounded-full text-xs bg-ui-info-soft text-ui-info">
                    {isAr ? 'فرع' : 'Branch'}: {branches.find((b) => b.id === currentDef.branch_id)?.name || '-'}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-ui-subtle"><code>{currentRole}</code> · {currentPlatformAdmin ? ALL_PERMISSIONS.length : currentPermissions.length} / {ALL_PERMISSIONS.length} {isAr ? 'صلاحية' : 'permissions'}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {canEditCurrent && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setAll(currentRole, true)}><CheckCheck className="w-4 h-4" /> {t('all')}</Button>
                  <Button size="sm" variant="outline" onClick={() => setAll(currentRole, false)}>{t('none')}</Button>
                  <Button size="sm" onClick={() => save(currentRole)} disabled={savingRole === currentRole}>
                    <Save className="w-4 h-4" /> {savingRole === currentRole ? '...' : t('save')}
                  </Button>
                </>
              )}
              {currentCustom && canEditCurrent && <Button size="sm" variant="danger" onClick={() => setDeleting(currentRole)}><Trash2 className="w-4 h-4" /> {t('delete')}</Button>}
            </div>
          </div>

          {currentPlatformAdmin ? (
            <div className="rounded-xl border border-brand-200 bg-brand-50/70 p-4 text-sm text-brand-800 dark:border-brand-900 dark:bg-brand-950/20 dark:text-brand-300">
              {isAr ? 'سوبر أدمن هو دور المنصة الوحيد الذي يملك تجاوزًا كاملًا، ولا يتم تقييده من مصفوفة الصلاحيات.' : 'Super Admin is the only platform role with an implicit full-access bypass and is not restricted by the permission matrix.'}
            </div>
          ) : (
            <>
              {!canEditCurrent && (
                <div className="mb-4 flex items-start gap-2 rounded-xl border border-ui-border bg-ui-page-alt p-3 text-sm text-ui-subtle">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{isAr ? 'عرض فقط: تحتاج صلاحية إدارة الأدوار، كما أن الأدوار العامة لا يعدلها إلا Super Admin.' : 'Read only: role management permission is required, and only Super Admin may edit global roles.'}</span>
                </div>
              )}
              <div className="relative mb-4">
                <Search className="absolute top-1/2 -translate-y-1/2 start-3 w-4 h-4 text-ui-subtle" />
                <input
                  value={permissionSearch}
                  onChange={(e) => setPermissionSearch(e.target.value)}
                  placeholder={isAr ? 'ابحث عن صلاحية مثل البيع، المرتجعات، التقارير...' : 'Search permissions: sales, refunds, reports...'}
                  className="w-full rounded-xl border border-ui-border bg-ui-surface py-2.5 ps-9 pe-3 text-sm text-ui-text outline-none focus:border-brand-500"
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                {visibleGroups.map((group) => {
                  const selectedCount = group.permissions.filter((p) => currentPermissions.includes(p)).length;
                  const groupAll = group.permissions.length > 0 && selectedCount === group.permissions.length;
                  return (
                    <section key={group.key} className="rounded-xl border border-ui-border overflow-hidden bg-ui-surface">
                      <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-ui-page-alt/70 border-b border-ui-border">
                        <div>
                          <h5 className="font-semibold text-sm text-ui-text">{group[lang]}</h5>
                          <p className="text-[11px] text-ui-subtle">{selectedCount}/{group.permissions.length} {isAr ? 'مفعّلة' : 'enabled'}</p>
                        </div>
                        {canEditCurrent && (
                          <button
                            type="button"
                            onClick={() => setGroup(currentRole, group.permissions, !groupAll)}
                            className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline"
                          >
                            {groupAll ? (isAr ? 'إلغاء الكل' : 'Clear all') : (isAr ? 'تحديد الكل' : 'Select all')}
                          </button>
                        )}
                      </div>
                      <div className="divide-y divide-ui-border">
                        {group.permissions.map((perm) => (
                          <label key={perm} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${canEditCurrent ? 'cursor-pointer hover:bg-ui-page-alt/50' : 'cursor-default'}`}>
                            <span className="text-sm text-ui-muted">{PERMISSION_LABELS[perm]?.[lang] || perm}</span>
                            <input
                              type="checkbox"
                              checked={currentPermissions.includes(perm)}
                              disabled={!canEditCurrent}
                              onChange={() => toggle(currentRole, perm)}
                              className="w-4 h-4 rounded border-ui-border text-brand-600 focus:ring-brand-500"
                            />
                          </label>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>

              {visibleGroups.length === 0 && (
                <div className="py-10 text-center text-sm text-ui-subtle">{isAr ? 'لا توجد صلاحيات مطابقة للبحث.' : 'No permissions match your search.'}</div>
              )}
            </>
          )}
        </Card>
      )}

      <p className="text-xs text-ui-subtle px-1">{isAr ? 'أي تغيير مصرح به يتم حفظه في قاعدة البيانات ويُطبّق فورًا بدون إعادة تسجيل الدخول.' : 'Authorized permission changes are saved to the database and apply immediately without requiring a new login.'}</p>

      <Modal open={creating} onClose={() => setCreating(false)} title={isAr ? 'دور جديد' : 'New role'}>
        <div className="space-y-4">
          <Input label={isAr ? 'الرمز (بالإنجليزية)' : 'Code (English)'} value={createForm.role} onChange={(e) => setCreateForm({ ...createForm, role: e.target.value.replace(/\s+/g, '_').toLowerCase() })} placeholder="floor_supervisor" autoComplete="off" />
          <Input label={isAr ? 'الاسم (عربي)' : 'Name (Arabic)'} value={createForm.name_ar} onChange={(e) => setCreateForm({ ...createForm, name_ar: e.target.value })} />
          <Input label={isAr ? 'الاسم (إنجليزي)' : 'Name (English)'} value={createForm.name_en} onChange={(e) => setCreateForm({ ...createForm, name_en: e.target.value })} />
          {isPlatformAdmin ? (
            <Select label={isAr ? 'النطاق' : 'Scope'} value={createForm.scope} onChange={(e) => setCreateForm({ ...createForm, scope: e.target.value as RoleScope })}>
              <option value="global">{isAr ? 'عام (كل الفروع الممنوحة)' : 'Global (all granted branches)'}</option>
              <option value="branch">{isAr ? 'فرع محدد' : 'Branch-specific'}</option>
            </Select>
          ) : (
            <div className="rounded-lg bg-ui-page-alt p-3 text-sm text-ui-subtle">{isAr ? 'يمكنك إنشاء دور مخصص لفرع فقط.' : 'You can create branch-scoped roles only.'}</div>
          )}
          {(isPlatformAdmin ? createForm.scope === 'branch' : true) && (
            <Select label={t('branch')} value={createForm.branch_id} onChange={(e) => setCreateForm({ ...createForm, branch_id: e.target.value })}>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{isAr ? b.name : (b.name_en || b.name)}</option>)}
            </Select>
          )}
          <Input label={isAr ? 'الوصف (عربي)' : 'Description (Arabic)'} value={createForm.description_ar} onChange={(e) => setCreateForm({ ...createForm, description_ar: e.target.value })} />
          <Input label={isAr ? 'الوصف (إنجليزي)' : 'Description (English)'} value={createForm.description_en} onChange={(e) => setCreateForm({ ...createForm, description_en: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCreating(false)}>{t('cancel')}</Button>
            <Button onClick={submitCreate}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title={isAr ? 'حذف الدور' : 'Delete role'}
        message={isAr ? 'هل تريد حذف هذا الدور؟ لا يمكن حذف دور مستخدم من أحد الموظفين.' : 'Delete this role? A role assigned to users cannot be deleted.'}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
      />
    </div>
  );
}