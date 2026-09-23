import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RolesTab } from '@/features/admin/pages/RolesTab';

const state = vi.hoisted(() => ({
  grants: new Set<string>(),
  saveRole: vi.fn(),
  createRole: vi.fn(),
  deleteRole: vi.fn(),
  show: vi.fn(),
  logAudit: vi.fn(),
  userRole: 'manager_custom',
  rolePermissionsMap: {
    floor_supervisor: ['pos.view'],
  },
  roleMeta: {
    floor_supervisor: { ar: 'مشرف الصالة', en: 'Floor Supervisor' },
  },
  rolesList: [{
    role: 'floor_supervisor',
    name_ar: 'مشرف الصالة',
    name_en: 'Floor Supervisor',
    scope: 'branch',
    branch_id: 'branch-1',
    description_ar: '',
    description_en: '',
    permissions: ['pos.view'],
  }],
}));

vi.mock('@/context/LanguageContext', () => ({
  useLanguage: () => ({
    lang: 'ar',
    t: (key: string) => ({
      none: 'لا شيء',
      save: 'حفظ',
      delete: 'حذف',
      required: 'مطلوب',
      saveSuccess: 'تم الحفظ',
      deleteSuccess: 'تم الحذف',
      cancel: 'إلغاء',
      branch: 'الفرع',
    } as Record<string, string>)[key] || key,
  }),
}));

vi.mock('@/components/Toast', () => ({
  useToast: () => ({ show: state.show }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'manager-1', role: state.userRole } }),
}));

vi.mock('@/hooks/useBranches', () => ({
  useBranches: () => ({
    branches: [{ id: 'branch-1', name: 'كليوبترا', name_en: 'Cleopatra' }],
  }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: (...args: unknown[]) => state.logAudit(...args),
}));

vi.mock('@/lib/permissions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/permissions')>('@/lib/permissions');
  return {
    ...actual,
    useCan: () => (permission: string) => (
      state.userRole === 'super_admin' || state.grants.has(permission)
    ),
  };
});

vi.mock('@/context/RolesContext', () => ({
  useRoles: () => ({
    rolePermissionsMap: state.rolePermissionsMap,
    roleMeta: state.roleMeta,
    rolesList: state.rolesList,
    loading: false,
    saveRole: state.saveRole,
    createRole: state.createRole,
    deleteRole: state.deleteRole,
  }),
}));

function checkboxFor(permission: string): HTMLInputElement {
  const row = document.querySelector(`[data-permission="${permission}"]`);
  if (!(row instanceof HTMLLabelElement)) {
    throw new Error(`Permission row not found: ${permission}`);
  }
  const input = row.querySelector('input[type="checkbox"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Checkbox not found: ${permission}`);
  }
  return input;
}

describe('RolesTab permission controls', () => {
  beforeEach(() => {
    state.userRole = 'manager_custom';
    state.grants = new Set([
      'roles.permissions.manage',
      'pos.view',
      'pos.order.create',
      'pos.payment.take',
      // Intentionally incomplete capability: kds_update requires kds_view.
      'pos.kds_update',
    ]);
    state.saveRole.mockReset();
    state.saveRole.mockResolvedValue(true);
    state.createRole.mockReset();
    state.createRole.mockResolvedValue({ success: true, role: 'new_role' });
    state.deleteRole.mockReset();
    state.deleteRole.mockResolvedValue({ success: true });
    state.show.mockReset();
    state.logAudit.mockReset();
    state.logAudit.mockResolvedValue(undefined);
  });

  it('hides higher permissions and toggles, resets, groups, presets, and saves owned permissions', async () => {
    render(<RolesTab />);

    expect(screen.getAllByText('مشرف الصالة').length).toBeGreaterThan(0);
    expect(screen.queryByText('تغيير سعر البيع من نقطة البيع')).not.toBeInTheDocument();
    expect(screen.queryByText('تحديث حالة طلبات المطبخ')).not.toBeInTheDocument();

    const createOrder = checkboxFor('pos.order.create');
    expect(createOrder).not.toBeChecked();

    fireEvent.click(createOrder);
    expect(createOrder).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'تراجع' }));
    expect(checkboxFor('pos.order.create')).not.toBeChecked();

    const posSection = screen.getByText('نقطة البيع').closest('section');
    if (!posSection) throw new Error('POS section not found');
    fireEvent.click(within(posSection).getByRole('button', { name: 'منح المتاح' }));
    expect(checkboxFor('pos.order.create')).toBeChecked();
    expect(checkboxFor('pos.payment.take')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'عرض POS فقط' }));
    expect(checkboxFor('pos.order.create')).not.toBeChecked();
    expect(checkboxFor('pos.payment.take')).not.toBeChecked();
    expect(checkboxFor('pos.view')).toBeChecked();

    fireEvent.click(checkboxFor('pos.order.create'));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));

    await waitFor(() => {
      expect(state.saveRole).toHaveBeenCalledWith(
        'floor_supervisor',
        expect.arrayContaining(['pos.view', 'pos.order.create']),
      );
    });
  });

  it('wires create and delete buttons to the role actions', async () => {
    render(<RolesTab />);

    fireEvent.click(screen.getByRole('button', { name: 'دور جديد' }));
    expect(screen.getByRole('dialog', { name: 'دور جديد' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('الرمز (بالإنجليزية)'), {
      target: { value: 'new_role' },
    });
    fireEvent.change(screen.getByLabelText('الاسم (عربي)'), {
      target: { value: 'دور جديد' },
    });

    const dialog = screen.getByRole('dialog', { name: 'دور جديد' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }));

    await waitFor(() => {
      expect(state.createRole).toHaveBeenCalledWith(
        expect.objectContaining({
          role: 'new_role',
          name_ar: 'دور جديد',
          scope: 'branch',
          branch_id: 'branch-1',
          permissions: [],
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: 'حذف' }));
    const confirm = screen.getByRole('dialog', { name: 'حذف الدور' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'حذف' }));

    await waitFor(() => {
      expect(state.deleteRole).toHaveBeenCalledWith('floor_supervisor');
    });
  });

  it('shows technical details only to Super Admin', () => {
    state.userRole = 'super_admin';
    render(<RolesTab />);

    expect(screen.queryByRole('button', { name: 'تفاصيل متقدمة' })).toBeInTheDocument();
    expect(screen.queryByText('pos.view')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'تفاصيل متقدمة' }));
    expect(screen.getByText('pos.view')).toBeInTheDocument();
  });
});
