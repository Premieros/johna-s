import { useState } from 'react';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { supabase, branches as branchesApi } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignPagination } from '@/components/design/DesignPagination';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { notifyBranchesChanged } from '@/hooks/useBranches';
import { getActiveBranchId, setActiveBranchId } from '@/lib/activeBranch';
import type { Branch } from '@/lib/types';

export function BranchesPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { user } = useAuth();
  const isAr = lang === 'ar';
  const { rows: items, loading, total, hasMore, loadMore, loadingMore, refresh: reloadBranches } = usePaginatedRows<Branch>({
    table: 'branches',
    select: '*',
    order: { column: 'created_at', ascending: false },
    pageSize: 100,
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', name_en: '', address: '', phone: '', is_active: true });

  const openAdd = () => { setEditing(null); setForm({ name: '', name_en: '', address: '', phone: '', is_active: true }); setModalOpen(true); };
  const openEdit = (b: Branch) => { setEditing(b); setForm({ name: b.name, name_en: b.name_en || '', address: b.address || '', phone: b.phone || '', is_active: b.is_active }); setModalOpen(true); };

  const resolveOrgId = async (): Promise<string | null> => {
    if (!user?.branch_id) return null;
    const { data } = await supabase.from('branches').select('organization_id').eq('id', user.branch_id).maybeSingle();
    return (data as { organization_id: string | null } | null)?.organization_id ?? null;
  };

  const save = async () => {
    if (!form.name) { show(t('required'), 'error'); return; }
    setSaving(true);
    try {
      if (editing) {
        const { data, error } = await branchesApi.update({
          p_branch_id: editing.id,
          p_name: form.name,
          p_name_en: form.name_en || null,
          p_address: form.address || null,
          p_phone: form.phone || null,
          p_is_active: form.is_active,
        });
        if (error || !data?.success) { show(error?.message || data?.error || 'Error', 'error'); return; }
        await logAudit('update', 'branches', editing.id);
      } else {
        const orgId = await resolveOrgId();
        if (!orgId) { show(t('required'), 'error'); return; }
        const { data, error } = await branchesApi.create({
          p_organization_id: orgId,
          p_name: form.name,
          p_name_en: form.name_en || null,
          p_address: form.address || null,
          p_phone: form.phone || null,
        });
        if (error || !data?.success) { show(error?.message || data?.error || 'Error', 'error'); return; }
        await logAudit('create', 'branches');
      }
      notifyBranchesChanged();
      show(t('saveSuccess'), 'success');
      setModalOpen(false);
      reloadBranches();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    const removedId = deleteId;
    const { data, error } = await branchesApi.remove({ p_branch_id: deleteId });
    if (error || !data?.success) {
      const code = data?.error;
      if (code === 'CANNOT_DELETE_CURRENT_BRANCH') show(isAr ? 'لا يمكن حذف الفرع المرتبط بحسابك الحالي. انقل حساب المالك إلى فرع آخر أولًا.' : 'You cannot delete your current branch. Move the owner account to another branch first.', 'error');
      else if (code === 'PERMISSION_DENIED') show(isAr ? 'الحذف النهائي متاح للمالك أو مدير النظام فقط.' : 'Permanent deletion is limited to Owner or Super Admin.', 'error');
      else show(error?.message || code || 'Error', 'error');
    } else {
      if (getActiveBranchId() === removedId) setActiveBranchId(null);
      notifyBranchesChanged();
      show(t('deleteSuccess'), 'success');
    }
    setDeleteId(null);
    reloadBranches();
  };

  const columns: Column<Branch>[] = [
    { key: 'name', header: t('name'), render: (b) => <span className="font-medium text-ui-text">{b.name}</span> },
    { key: 'name_en', header: t('nameEn'), render: (b) => b.name_en || '-' },
    { key: 'address', header: t('address'), render: (b) => b.address || '-' },
    { key: 'phone', header: t('phone'), render: (b) => b.phone || '-' },
    { key: 'is_active', header: t('status'), render: (b) => (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${b.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle dark:text-ui-subtle'}`}>
        {b.is_active ? t('active') : t('inactive')}
      </span>
    )},
    { key: 'actions', header: t('actions'), render: (b) => (
      <div className="flex gap-1">
        <button onClick={() => openEdit(b)} className="ui-icon-action ui-icon-action-info"><Edit2 className="w-4 h-4" /></button>
        <button onClick={() => setDeleteId(b.id)} className="ui-icon-action ui-icon-action-danger"><Trash2 className="w-4 h-4" /></button>
      </div>
    )},
  ];

  return (
    <DesignSurface testId="branches-page">
      <DesignPageHeader title={t('branches')} actions={<Button size="sm" onClick={openAdd} data-testid="branches-add"><Plus className="w-4 h-4" /> {t('add')}</Button>} />
      <DesignPanel testId="branches-table-panel">
        <DataTable columns={columns} data={items} loading={loading} emptyMessage={t('noData')} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('edit') : t('add')}>
        <div className="space-y-4">
          <Input label={t('name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
          <Input label={t('address')} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Input label={t('phone')} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Select label={t('status')} value={form.is_active ? '1' : '0'} onChange={(e) => setForm({ ...form, is_active: e.target.value === '1' })}>
            <option value="1">{t('active')}</option>
            <option value="0">{t('inactive')}</option>
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={save} disabled={saving}>{t('save')}</Button>
          </div>
        </div>
      </Modal>
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={remove}
        title={isAr ? 'حذف الفرع نهائيًا' : 'Permanently delete branch'}
        message={isAr ? 'سيتم حذف الفرع وكل البيانات المرتبطة به نهائيًا ولن يظهر مرة أخرى. لا يمكن التراجع عن هذه العملية.' : 'The branch and all data linked to it will be permanently deleted and cannot be restored.'}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
      />
    </DesignSurface>
  );
}