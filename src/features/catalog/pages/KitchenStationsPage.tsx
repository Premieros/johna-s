import { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit2, GripVertical, Plus, Tags, Trash2, UsersRound } from 'lucide-react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DataTable, type Column } from '@/components/DataTable';
import { DesignPageHeader, DesignSurface } from '@/components/design/DesignSurface';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { useBranches } from '@/hooks/useBranches';
import { catalog } from '@/api/domains/catalog';
import { useCan } from '@/lib/permissions';
import { useBranchFilter } from '@/lib/useBranchFilter';
import type { KitchenStation } from '@/lib/types';

interface StationForm {
  code: string;
  name_ar: string;
  name_en: string;
  sort_order: number;
}

interface AssignmentStation extends KitchenStation {
  user_ids: string[];
  category_ids: string[];
}

interface BranchUser {
  id: string;
  full_name: string | null;
  email: string;
  role: string;
}

interface BranchCategory {
  id: string;
  name: string;
  name_en: string | null;
  kitchen_station_id?: string | null;
}

interface EditorContext {
  success?: boolean;
  error?: string;
  branch?: { id: string; name: string };
  users?: BranchUser[];
  categories?: BranchCategory[];
}

const EMPTY_FORM: StationForm = { code: '', name_ar: '', name_en: '', sort_order: 0 };

export function KitchenStationsPage() {
  const { lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const { branches } = useBranches();
  const ar = lang === 'ar';

  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [assignments, setAssignments] = useState<Record<string, AssignmentStation>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<StationForm>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<KitchenStation | null>(null);
  const [assignmentTarget, setAssignmentTarget] = useState<KitchenStation | null>(null);
  const [branchUsers, setBranchUsers] = useState<BranchUser[]>([]);
  const [branchCategories, setBranchCategories] = useState<BranchCategory[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [loadingAssignmentContext, setLoadingAssignmentContext] = useState(false);

  useEffect(() => {
    if (branchFilter && branches.some((b) => b.id === branchFilter)) {
      setSelectedBranchId(branchFilter);
      return;
    }
    if (selectedBranchId && branches.some((b) => b.id === selectedBranchId)) return;
    if (branches.length === 1) setSelectedBranchId(branches[0].id);
    else setSelectedBranchId('');
  }, [branchFilter, branches, selectedBranchId]);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === selectedBranchId) ?? null,
    [branches, selectedBranchId],
  );

  const loadAssignments = useCallback(async () => {
    if (!selectedBranchId || !can('settings.manage')) {
      setAssignments({});
      return;
    }
    const { data, error } = await catalog.getKitchenStationAssignments(selectedBranchId);
    if (error) throw error;
    const res = data as { success?: boolean; error?: string; stations?: AssignmentStation[] } | null;
    if (!res?.success) throw new Error(res?.error || 'ASSIGNMENTS_LOAD_FAILED');
    setAssignments(Object.fromEntries((res.stations || []).map((s) => [s.id, s])));
  }, [selectedBranchId, can]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await catalog.listKitchenStations();
      setStations((data ?? []) as KitchenStation[]);
      await loadAssignments();
    } catch (err) {
      show(String((err as Error).message ?? err), 'error');
    } finally {
      setLoading(false);
    }
  }, [loadAssignments, show]);

  useEffect(() => { void load(); }, [load]);

  const handleSave = async () => {
    if (!form.code.trim() || !form.name_ar.trim()) {
      show(ar ? 'أكمل الحقول المطلوبة' : 'Fill required fields', 'error');
      return;
    }
    try {
      if (editingId) {
        await catalog.updateKitchenStation(editingId, {
          name_ar: form.name_ar,
          name_en: form.name_en,
          sort_order: form.sort_order,
        });
      } else {
        await catalog.createKitchenStation({
          code: form.code.trim().toLowerCase(),
          name_ar: form.name_ar,
          name_en: form.name_en,
          sort_order: form.sort_order,
        });
      }
      show(ar ? 'تم الحفظ' : 'Saved', 'success');
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      show(String((err as Error).message ?? err), 'error');
    }
  };

  const handleToggle = async (station: KitchenStation) => {
    try {
      await catalog.updateKitchenStation(station.id, { is_active: !station.is_active });
      await load();
    } catch (err) {
      show(String((err as Error).message ?? err), 'error');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await catalog.deleteKitchenStation(deleteTarget.id);
      show(ar ? 'تم الحذف' : 'Deleted', 'success');
      setDeleteTarget(null);
      await load();
    } catch (err) {
      show(String((err as Error).message ?? err), 'error');
    }
  };

  const openEdit = (station: KitchenStation) => {
    setEditingId(station.id);
    setForm({
      code: station.code,
      name_ar: station.name_ar,
      name_en: station.name_en ?? '',
      sort_order: station.sort_order,
    });
    setShowForm(true);
  };

  const openAssignments = async (station: KitchenStation) => {
    if (!selectedBranchId) {
      show(ar ? 'اختر الفرع من داخل الصفحة أولًا' : 'Select a branch on this page first', 'warning');
      return;
    }

    setLoadingAssignmentContext(true);
    try {
      const { data, error } = await catalog.getKitchenStationEditorContext(selectedBranchId);
      if (error) throw error;
      const context = data as EditorContext | null;
      if (!context?.success) throw new Error(context?.error || 'EDITOR_CONTEXT_LOAD_FAILED');

      setBranchUsers(context.users || []);
      setBranchCategories(context.categories || []);
      const current = assignments[station.id];
      setSelectedUsers(current?.user_ids || []);
      setSelectedCategories(current?.category_ids || []);
      setAssignmentTarget(station);
    } catch (err) {
      show(String((err as Error).message ?? err), 'error');
    } finally {
      setLoadingAssignmentContext(false);
    }
  };

  const saveAssignments = async () => {
    if (!selectedBranchId || !assignmentTarget) return;
    setSavingAssignment(true);
    try {
      const { data, error } = await catalog.saveKitchenStationAssignments({
        p_branch_id: selectedBranchId,
        p_station_id: assignmentTarget.id,
        p_user_ids: selectedUsers,
        p_category_ids: selectedCategories,
      });
      if (error) throw error;
      const res = data as { success?: boolean; error?: string } | null;
      if (!res?.success) throw new Error(res?.error || 'ASSIGNMENT_SAVE_FAILED');
      show(ar ? 'تم حفظ تعيينات المحطة للفرع المحدد' : 'Station assignments saved for the selected branch', 'success');
      setAssignmentTarget(null);
      await loadAssignments();
    } catch (err) {
      show(String((err as Error).message ?? err), 'error');
    } finally {
      setSavingAssignment(false);
    }
  };

  const toggleId = (id: string, selected: string[], setter: (value: string[]) => void) => {
    setter(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const columns: Column<KitchenStation>[] = [
    {
      key: 'sort_order',
      header: '#',
      render: (row) => <span className="text-ui-muted"><GripVertical className="inline h-4 w-4" /> {row.sort_order}</span>,
    },
    {
      key: 'code',
      header: ar ? 'الكود' : 'Code',
      render: (row) => <code className="rounded bg-ui-muted px-1.5 py-0.5 text-xs">{row.code}</code>,
    },
    {
      key: 'name_ar',
      header: ar ? 'المحطة' : 'Station',
      render: (row) => ar ? row.name_ar : (row.name_en || row.name_ar),
    },
    {
      key: 'assignments',
      header: ar ? 'تعيينات الفرع المحدد' : 'Selected Branch Assignments',
      render: (row) => (
        <div className="flex flex-wrap gap-1 text-[11px] text-ui-muted">
          <span className="inline-flex items-center gap-1 rounded-md bg-ui-page-alt px-1.5 py-1"><UsersRound className="h-3 w-3" /> {assignments[row.id]?.user_ids?.length || 0}</span>
          <span className="inline-flex items-center gap-1 rounded-md bg-ui-page-alt px-1.5 py-1"><Tags className="h-3 w-3" /> {assignments[row.id]?.category_ids?.length || 0}</span>
        </div>
      ),
    },
    {
      key: 'is_active',
      header: ar ? 'نشط' : 'Active',
      render: (row) => (
        <button
          type="button"
          onClick={() => void handleToggle(row)}
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${row.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle'}`}
        >
          {row.is_active ? (ar ? 'نعم' : 'Yes') : (ar ? 'لا' : 'No')}
        </button>
      ),
    },
  ];

  if (can('settings.manage')) {
    columns.push({
      key: 'actions',
      header: '',
      render: (row: KitchenStation) => (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!selectedBranchId || loadingAssignmentContext}
            onClick={() => void openAssignments(row)}
            className="text-ui-primary hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
            title={ar ? 'تعيين مستخدمين وفئات للفرع المحدد' : 'Assign users and categories for selected branch'}
          >
            <UsersRound className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => openEdit(row)} className="text-ui-info hover:opacity-80"><Edit2 className="h-4 w-4" /></button>
          <button type="button" onClick={() => setDeleteTarget(row)} className="text-ui-danger hover:opacity-80"><Trash2 className="h-4 w-4" /></button>
        </div>
      ),
    });
  }

  return (
    <DesignSurface testId="kitchen-stations">
      <DesignPageHeader
        title={ar ? 'محطات المطبخ' : 'Kitchen Stations'}
        subtitle={ar ? 'اختر الفرع ثم اربط فئات المنتجات والمستخدمين بكل محطة' : 'Choose a branch, then map product categories and users to each station'}
      />

      <div className="space-y-4">
        <div className="grid gap-3 rounded-2xl border border-ui-border bg-ui-surface p-4 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-end">
          <Select
            data-testid="kitchen-station-branch-select"
            label={ar ? 'الفرع الذي تريد إعداد محطاته' : 'Branch to configure'}
            value={selectedBranchId}
            onChange={(e) => setSelectedBranchId(e.target.value)}
            options={[
              { value: '', label: ar ? 'اختر الفرع' : 'Select branch' },
              ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
            ]}
          />
          <div className="rounded-xl bg-ui-page-alt px-3 py-2 text-xs leading-5 text-ui-muted">
            {selectedBranch
              ? (ar
                ? `التعيينات المعروضة الآن تخص فرع: ${selectedBranch.name}. تعريف المحطة نفسه مركزي، أما المستخدمون والفئات فتُحفظ لكل فرع بشكل مستقل.`
                : `Assignments shown now belong to ${selectedBranch.name}. Station definitions are shared, while users and categories are stored per branch.`)
              : (ar
                ? 'اختر فرعًا لعرض وتعديل المستخدمين وفئات المنتجات الخاصة به.'
                : 'Select a branch to view and edit its users and product categories.')}
          </div>
        </div>

        {can('settings.manage') && (
          <Button onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(true); }}>
            <Plus className="h-4 w-4" /> {ar ? 'إضافة محطة' : 'Add Station'}
          </Button>
        )}

        <DataTable columns={columns} data={stations} loading={loading} />
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingId ? (ar ? 'تعديل محطة' : 'Edit Station') : (ar ? 'محطة جديدة' : 'New Station')}
      >
        <div className="space-y-3">
          <Input label={ar ? 'الكود (إنجليزي)' : 'Code'} value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} disabled={!!editingId} placeholder="grill, salad, ..." />
          <Input label={ar ? 'الاسم عربي' : 'Name (AR)'} value={form.name_ar} onChange={(e) => setForm((f) => ({ ...f, name_ar: e.target.value }))} />
          <Input label={ar ? 'الاسم إنجليزي' : 'Name (EN)'} value={form.name_en} onChange={(e) => setForm((f) => ({ ...f, name_en: e.target.value }))} />
          <Input label={ar ? 'ترتيب العرض' : 'Sort Order'} type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={() => void handleSave()}>{ar ? 'حفظ' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!assignmentTarget}
        onClose={() => setAssignmentTarget(null)}
        title={`${ar ? 'تعيينات محطة' : 'Station Assignments'}: ${assignmentTarget ? (ar ? assignmentTarget.name_ar : (assignmentTarget.name_en || assignmentTarget.name_ar)) : ''}`}
      >
        <div className="mb-4 rounded-xl border border-ui-border bg-ui-page-alt px-3 py-2 text-xs font-bold text-ui-text">
          {ar ? 'الفرع:' : 'Branch:'} {selectedBranch?.name || '-'}
        </div>

        <div className="grid max-h-[65dvh] gap-4 overflow-y-auto sm:grid-cols-2">
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-black text-ui-text"><UsersRound className="h-4 w-4" /> {ar ? `المستخدمون (${branchUsers.length})` : `Users (${branchUsers.length})`}</h3>
              <button type="button" className="text-[11px] font-bold text-ui-primary" onClick={() => setSelectedUsers(selectedUsers.length === branchUsers.length ? [] : branchUsers.map((u) => u.id))}>
                {selectedUsers.length === branchUsers.length && branchUsers.length > 0 ? (ar ? 'إلغاء الكل' : 'Clear all') : (ar ? 'تحديد الكل' : 'Select all')}
              </button>
            </div>
            <div className="space-y-1.5">
              {branchUsers.map((user) => (
                <label key={user.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-ui-border p-2 text-xs">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={selectedUsers.includes(user.id)} onChange={() => toggleId(user.id, selectedUsers, setSelectedUsers)} />
                  <span className="min-w-0">
                    <span className="block font-bold text-ui-text">{user.full_name || user.email}</span>
                    <span className="text-ui-subtle">{user.role}</span>
                  </span>
                </label>
              ))}
              {branchUsers.length === 0 && <p className="text-xs text-ui-subtle">{ar ? 'لا يوجد مستخدمون نشطون في هذا الفرع.' : 'No active users in this branch.'}</p>}
            </div>
          </section>

          <section data-testid="kitchen-station-category-selector">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-black text-ui-text"><Tags className="h-4 w-4" /> {ar ? `فئات المنتجات (${branchCategories.length})` : `Product Categories (${branchCategories.length})`}</h3>
              <button type="button" className="text-[11px] font-bold text-ui-primary" onClick={() => setSelectedCategories(selectedCategories.length === branchCategories.length ? [] : branchCategories.map((c) => c.id))}>
                {selectedCategories.length === branchCategories.length && branchCategories.length > 0 ? (ar ? 'إلغاء الكل' : 'Clear all') : (ar ? 'تحديد الكل' : 'Select all')}
              </button>
            </div>
            <div className="space-y-1.5">
              {branchCategories.map((category) => (
                <label key={category.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-ui-border p-2 text-xs">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={selectedCategories.includes(category.id)} onChange={() => toggleId(category.id, selectedCategories, setSelectedCategories)} />
                  <span className="font-bold text-ui-text">{ar ? category.name : (category.name_en || category.name)}</span>
                </label>
              ))}
              {branchCategories.length === 0 && <p className="text-xs text-ui-subtle">{ar ? 'لا توجد فئات منتجات في هذا الفرع.' : 'No product categories in this branch.'}</p>}
            </div>
          </section>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-ui-border pt-3">
          <Button variant="outline" onClick={() => setAssignmentTarget(null)}>{ar ? 'إلغاء' : 'Cancel'}</Button>
          <Button onClick={() => void saveAssignments()} disabled={savingAssignment}>{ar ? 'حفظ التعيينات' : 'Save Assignments'}</Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        title={ar ? 'حذف المحطة' : 'Delete Station'}
        message={ar ? 'هل تريد حذف محطة المطبخ؟' : 'Delete this kitchen station?'}
      />
    </DesignSurface>
  );
}