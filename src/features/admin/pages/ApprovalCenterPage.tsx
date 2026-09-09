import { useCallback, useEffect, useState } from 'react';
import { Check, Clock3, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import { supabase } from '@/api';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DesignPanel } from '@/components/design/DesignPanel';
import { useToast } from '@/components/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { useBranches } from '@/hooks/useBranches';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { ALL_PERMISSIONS, useCan } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';
import { useV2Can } from '@/v2/core/useV2Can';

type QueueItem = {
  source_type: 'manager_approval' | 'waste' | 'stock_count' | 'warehouse_transfer';
  source_id: string;
  branch_id: string;
  title: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  required_permission: string;
  payload: Record<string, unknown>;
};

const sourceLabels: Record<string, { ar: string; en: string }> = {
  manager_approval: { ar: 'طلب موافقة مدير', en: 'Manager approval' },
  waste: { ar: 'هالك', en: 'Waste' },
  stock_count: { ar: 'جرد مخزون', en: 'Stock count' },
  warehouse_transfer: { ar: 'تحويل مخزني', en: 'Warehouse transfer' },
};

export function ApprovalCenterPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { user } = useAuth();
  const v2Can = useV2Can();
  const can = useCan();
  const { branches } = useBranches();
  const activeBranch = useBranchFilter();
  const { show } = useToast();
  const canReviewApprovals = can('approvals.review');
  const canManagePolicies = can('approvals.policy.manage');
  const [branchId, setBranchId] = useState(activeBranch || user?.branch_id || '');
  const [rows, setRows] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_operational_approval_queue', {
      p_branch_id: branchId || null,
    });
    if (error) show(error.message, 'error');
    setRows((data || []) as QueueItem[]);
    setLoading(false);
  }, [branchId, show]);

  useEffect(() => { void load(); }, [load]);

  // The server supplies the exact permission required for each queue item.
  // Super Admin bypass, when applicable, is handled only by canonical useCan().
  const mayDecide = (row: QueueItem) => canReviewApprovals && v2Can(row.required_permission);

  const decide = async (row: QueueItem, approve: boolean) => {
    let reason: string | null = null;
    if (!approve) {
      reason = window.prompt(ar ? 'سبب الرفض:' : 'Rejection reason:');
      if (reason === null) return;
    }
    setDeciding(row.source_id);
    const { data, error } = await supabase.rpc('decide_operational_approval', {
      p_source_type: row.source_type,
      p_source_id: row.source_id,
      p_approve: approve,
      p_reason: reason,
    });
    const result = data as { success?: boolean; error?: string; detail?: string } | null;
    if (error || !result?.success) show(error?.message || result?.detail || result?.error || 'Approval failed', 'error');
    else show(approve ? (ar ? 'تمت الموافقة' : 'Approved') : (ar ? 'تم الرفض' : 'Rejected'), 'success');
    setDeciding(null);
    await load();
  };

  return (
    <DesignSurface testId="approval-center-page">
      <DesignPageHeader
        title={ar ? 'مركز الموافقات والاعتمادات' : 'Approvals & Authorizations Center'}
        subtitle={ar ? 'كل ما هو معلق أو يحتاج اعتماد في مكان واحد، مع تطبيق صلاحية الاعتماد حسب نوع العملية.' : 'All pending approvals in one place, with server-enforced permissions per operation.'}
        actions={<Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className="w-4 h-4" />{ar ? 'تحديث' : 'Refresh'}</Button>}
      />
      <div className="space-y-4">
        <DesignPanel testId="approval-center-filter-panel">
          <div className="flex flex-wrap items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-ui-primary" />
            <span className="font-semibold">{ar ? 'الفرع' : 'Branch'}</span>
            <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="max-w-xs">
              {canReviewApprovals && <option value="">{ar ? 'كل الفروع المصرح بها' : 'All accessible branches'}</option>}
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <span className="ms-auto text-sm text-ui-muted">{ar ? `معلق: ${rows.length}` : `Pending: ${rows.length}`}</span>
          </div>
        </DesignPanel>

        <DesignPanel testId="approval-center-queue-panel" title={ar ? 'قائمة الاعتماد' : 'Approval Queue'}>
          {loading ? <div className="p-8 text-center text-ui-muted">{ar ? 'جاري التحميل...' : 'Loading...'}</div> : rows.length === 0 ? (
            <div className="p-8 text-center text-ui-muted">{ar ? 'لا توجد عمليات معلقة تحتاج اعتمادًا' : 'No pending approvals'}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-ui-border text-ui-muted">
                  <th className="p-3 text-start">{ar ? 'النوع' : 'Type'}</th>
                  <th className="p-3 text-start">{ar ? 'الطلب' : 'Request'}</th>
                  <th className="p-3 text-start">{ar ? 'الوقت' : 'Time'}</th>
                  <th className="p-3 text-start">{ar ? 'التفاصيل' : 'Details'}</th>
                  <th className="p-3 text-end">{ar ? 'الإجراء' : 'Action'}</th>
                </tr></thead>
                <tbody>{rows.map((row) => {
                  const permitted = mayDecide(row);
                  return (
                    <tr key={`${row.source_type}-${row.source_id}`} className="border-b border-ui-border/60">
                      <td className="p-3 font-semibold">{sourceLabels[row.source_type]?.[ar ? 'ar' : 'en'] || row.source_type}</td>
                      <td className="p-3">{row.title}</td>
                      <td className="p-3 whitespace-nowrap"><Clock3 className="inline w-4 h-4 me-1" />{new Date(row.requested_at).toLocaleString(ar ? 'ar-EG' : 'en')}</td>
                      <td className="p-3 max-w-md"><pre className="whitespace-pre-wrap text-xs text-ui-muted">{JSON.stringify(row.payload, null, 1)}</pre></td>
                      <td className="p-3"><div className="flex justify-end gap-2">
                        <Button size="sm" disabled={!permitted || deciding === row.source_id} onClick={() => void decide(row, true)}><Check className="w-4 h-4" />{ar ? 'موافقة' : 'Approve'}</Button>
                        <Button size="sm" variant="secondary" disabled={!permitted || deciding === row.source_id} onClick={() => void decide(row, false)}><X className="w-4 h-4" />{ar ? 'رفض' : 'Reject'}</Button>
                      </div></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </DesignPanel>
        {canManagePolicies && user && <ApprovalPoliciesPanel ar={ar} branches={branches} userId={user.id} allowGlobal />}
      </div>
    </DesignSurface>
  );
}

type ApprovalPolicy = {
  id: string;
  scope: string;
  branch_id: string | null;
  min_amount: number | null;
  max_amount: number | null;
  approver_mode: 'permission' | 'user' | 'both';
  approver_permission: string | null;
  approver_user_id: string | null;
  priority: number;
  is_active: boolean;
};

const POLICY_SCOPES = [
  'manager:discount', 'manager:reprint', 'manager:void_order', 'manager:cancel_sent_item',
  'manager:refund', 'manager:open_drawer', 'manager:change_payment_method',
  'manager:force_close_shift', 'manager:split_order', 'manager:merge_order',
  'manager:transfer_order', 'waste', 'stock_count', 'warehouse_transfer',
];

function ApprovalPoliciesPanel({ ar, branches, userId, allowGlobal }: { ar: boolean; branches: Array<{ id: string; name: string }>; userId: string; allowGlobal: boolean }) {
  const { show } = useToast();
  const [rows, setRows] = useState<ApprovalPolicy[]>([]);
  const [users, setUsers] = useState<Array<{ id: string; full_name: string }>>([]);
  const [scope, setScope] = useState('manager:discount');
  const [branchId, setBranchId] = useState(branches[0]?.id || '');
  const [mode, setMode] = useState<ApprovalPolicy['approver_mode']>('permission');
  const [permission, setPermission] = useState('approvals.review');
  const [approverUserId, setApproverUserId] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');

  const load = useCallback(async () => {
    const [policyRes, userRes] = await Promise.all([
      supabase.from('approval_policies').select('*').order('priority').order('created_at'),
      supabase.from('users').select('id,full_name').eq('is_active', true).order('full_name'),
    ]);
    if (policyRes.error) show(policyRes.error.message, 'error');
    else setRows((policyRes.data || []) as ApprovalPolicy[]);
    if (!userRes.error) setUsers((userRes.data || []) as Array<{ id: string; full_name: string }>);
  }, [show]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!branchId && branches[0]) setBranchId(branches[0].id); }, [branchId, branches]);

  const create = async () => {
    if (!scope || (!allowGlobal && !branchId) || (mode !== 'permission' && !approverUserId)) return;
    const { error } = await supabase.from('approval_policies').insert({
      scope,
      branch_id: branchId || null,
      min_amount: minAmount === '' ? null : Number(minAmount),
      max_amount: maxAmount === '' ? null : Number(maxAmount),
      approver_mode: mode,
      approver_permission: mode === 'user' ? null : permission,
      approver_user_id: mode === 'permission' ? null : approverUserId,
      created_by: userId,
    });
    if (error) show(error.message, 'error');
    else { show(ar ? 'تمت إضافة سياسة الموافقة' : 'Approval policy added', 'success'); await load(); }
  };

  const updateActive = async (row: ApprovalPolicy) => {
    const { error } = await supabase.from('approval_policies').update({ is_active: !row.is_active }).eq('id', row.id);
    if (error) show(error.message, 'error'); else await load();
  };
  const remove = async (id: string) => {
    if (!window.confirm(ar ? 'حذف سياسة الموافقة؟' : 'Delete approval policy?')) return;
    const { error } = await supabase.from('approval_policies').delete().eq('id', id);
    if (error) show(error.message, 'error'); else await load();
  };

  return (
    <DesignPanel testId="approval-policy-panel" title={ar ? 'سياسات الموافقات' : 'Approval Policies'}>
      <p className="mb-3 text-sm text-ui-muted">{ar ? 'حدد من يعتمد كل عملية حسب الفرع وحدود المبلغ. عند عدم وجود سياسة يستمر نظام الصلاحيات الحالي.' : 'Choose who approves each operation by branch and amount. Without a policy, current permissions remain in effect.'}</p>
      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Select value={scope} onChange={(e) => setScope(e.target.value)}>{POLICY_SCOPES.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
        <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {allowGlobal && <option value="">{ar ? 'كل الفروع' : 'All branches'}</option>}
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </Select>
        <Select value={mode} onChange={(e) => setMode(e.target.value as ApprovalPolicy['approver_mode'])}>
          <option value="permission">{ar ? 'حسب الصلاحية' : 'By permission'}</option>
          <option value="user">{ar ? 'موظف محدد' : 'Specific user'}</option>
          <option value="both">{ar ? 'الموظف والصلاحية معًا' : 'User and permission'}</option>
        </Select>
        {mode !== 'user' && <Select value={permission} onChange={(e) => setPermission(e.target.value)}>{ALL_PERMISSIONS.map((value) => <option key={value} value={value}>{value}</option>)}</Select>}
        {mode !== 'permission' && <Select value={approverUserId} onChange={(e) => setApproverUserId(e.target.value)}><option value="">{ar ? 'اختر الموظف' : 'Select user'}</option>{users.map((item) => <option key={item.id} value={item.id}>{item.full_name}</option>)}</Select>}
        <Input type="number" min="0" placeholder={ar ? 'من مبلغ' : 'Min amount'} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
        <Input type="number" min="0" placeholder={ar ? 'إلى مبلغ' : 'Max amount'} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
        <Button onClick={() => void create()}><Plus className="h-4 w-4" />{ar ? 'إضافة' : 'Add'}</Button>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm"><thead><tr className="border-b border-ui-border text-ui-muted"><th className="p-2 text-start">{ar ? 'العملية' : 'Scope'}</th><th className="p-2 text-start">{ar ? 'الفرع' : 'Branch'}</th><th className="p-2 text-start">{ar ? 'المعتمد' : 'Approver'}</th><th className="p-2 text-start">{ar ? 'الحد' : 'Amount'}</th><th /></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className={`border-b border-ui-border/60 ${row.is_active ? '' : 'opacity-50'}`}><td className="p-2">{row.scope}</td><td className="p-2">{branches.find((b) => b.id === row.branch_id)?.name || (ar ? 'كل الفروع' : 'All')}</td><td className="p-2">{row.approver_mode === 'permission' ? row.approver_permission : users.find((u) => u.id === row.approver_user_id)?.full_name || row.approver_user_id}{row.approver_mode === 'both' ? ` + ${row.approver_permission}` : ''}</td><td className="p-2">{row.min_amount ?? 0} – {row.max_amount ?? '∞'}</td><td className="p-2"><div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => void updateActive(row)}>{row.is_active ? (ar ? 'تعطيل' : 'Disable') : (ar ? 'تفعيل' : 'Enable')}</Button><button type="button" className="text-ui-danger" onClick={() => void remove(row.id)}><Trash2 className="h-4 w-4" /></button></div></td></tr>)}</tbody>
        </table>
      </div>
    </DesignPanel>
  );
}
