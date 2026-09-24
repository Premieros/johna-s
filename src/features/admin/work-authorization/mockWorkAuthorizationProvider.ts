import type {
  WorkAuthorizationClient,
  WorkAuthorizationHistoryEntry,
  WorkAuthorizationPolicyRow,
  WorkAuthorizationRecord,
  WorkAuthorizationSnapshot,
} from './workAuthorizationContract';

type BranchSeed = { id: string; name: string };
type MockState = WorkAuthorizationSnapshot;

function minutesAgo(value: number) {
  return new Date(Date.now() - value * 60_000).toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function seedState(branches: BranchSeed[]): MockState {
  const safeBranches = branches.length > 0 ? branches : [{ id: 'preview-branch', name: 'الفرع الحالي' }];
  const first = safeBranches[0];
  const second = safeBranches[1] ?? first;

  const pending: WorkAuthorizationRecord[] = [
    {
      id: 'wa-pending-1',
      branchId: first.id,
      branchName: first.name,
      person: { userId: 'preview-user-1', fullName: 'أحمد محمد', positionLabel: 'كابتن أوردر' },
      status: 'pending',
      requestedAt: minutesAgo(4),
      shiftLabel: 'الشفت الحالي',
    },
    {
      id: 'wa-pending-2',
      branchId: first.id,
      branchName: first.name,
      person: { userId: 'preview-user-2', fullName: 'محمود حسن', positionLabel: 'كاشير' },
      status: 'pending',
      requestedAt: minutesAgo(9),
      shiftLabel: 'الشفت الحالي',
    },
  ];

  const active: WorkAuthorizationRecord[] = [
    {
      id: 'wa-active-1',
      branchId: first.id,
      branchName: first.name,
      person: { userId: 'preview-user-3', fullName: 'منى علي', positionLabel: 'كابتن أوردر' },
      status: 'approved',
      requestedAt: minutesAgo(42),
      decidedAt: minutesAgo(40),
      startedAt: minutesAgo(39),
      approverName: 'مدير الفرع',
      shiftLabel: 'الشفت الحالي',
    },
    {
      id: 'wa-active-2',
      branchId: second.id,
      branchName: second.name,
      person: { userId: 'preview-user-4', fullName: 'يوسف سامي', positionLabel: 'كاشير' },
      status: 'approved',
      requestedAt: minutesAgo(31),
      decidedAt: minutesAgo(30),
      startedAt: minutesAgo(29),
      approverName: 'مدير الفرع',
      shiftLabel: 'الشفت الحالي',
    },
  ];

  const history: WorkAuthorizationHistoryEntry[] = [
    {
      id: 'wa-history-1',
      branchId: first.id,
      branchName: first.name,
      person: { userId: 'preview-user-5', fullName: 'سارة خالد', positionLabel: 'كابتن أوردر' },
      kind: 'rejected',
      occurredAt: minutesAgo(78),
      actorName: 'مدير الفرع',
      note: 'تم رفض بدء العمل لهذا الشفت.',
    },
    {
      id: 'wa-history-2',
      branchId: first.id,
      branchName: first.name,
      person: { userId: 'preview-user-3', fullName: 'منى علي', positionLabel: 'كابتن أوردر' },
      kind: 'approved',
      occurredAt: minutesAgo(40),
      actorName: 'مدير الفرع',
    },
  ];

  const policies: WorkAuthorizationPolicyRow[] = [
    {
      id: 'wa-policy-1',
      branchId: first.id,
      branchName: first.name,
      userId: 'preview-user-1',
      userName: 'أحمد محمد',
      positionLabel: 'كابتن أوردر',
      requiresAuthorization: true,
    },
    {
      id: 'wa-policy-2',
      branchId: first.id,
      branchName: first.name,
      userId: 'preview-user-2',
      userName: 'محمود حسن',
      positionLabel: 'كاشير',
      requiresAuthorization: true,
    },
    {
      id: 'wa-policy-3',
      branchId: second.id,
      branchName: second.name,
      userId: 'preview-user-4',
      userName: 'يوسف سامي',
      positionLabel: 'كاشير',
      requiresAuthorization: false,
    },
  ];

  return { pending, active, history, policies };
}

export function createMockWorkAuthorizationClient(branches: BranchSeed[]): WorkAuthorizationClient {
  let state = seedState(branches);

  const getSnapshot: WorkAuthorizationClient['getSnapshot'] = async (query) => {
    const branchId = query?.branchId;
    if (!branchId) return clone(state);

    return clone({
      pending: state.pending.filter((row) => row.branchId === branchId),
      active: state.active.filter((row) => row.branchId === branchId),
      history: state.history.filter((row) => row.branchId === branchId),
      policies: state.policies.filter((row) => row.branchId === branchId),
    });
  };

  const getMyState: WorkAuthorizationClient['getMyState'] = async (branchId) => {
    const pending = state.pending.find((row) => row.branchId === branchId && row.person.userId === 'preview-self');
    if (pending) {
      return {
        branchId,
        branchName: pending.branchName,
        requiresAuthorization: true,
        canWork: false,
        status: 'pending',
        requestId: pending.id,
        requestedAt: pending.requestedAt,
      };
    }

    const active = state.active.find((row) => row.branchId === branchId && row.person.userId === 'preview-self');
    if (active) {
      return {
        branchId,
        branchName: active.branchName,
        requiresAuthorization: true,
        canWork: true,
        status: 'approved',
        authorizationId: active.id,
        requestedAt: active.requestedAt,
        decidedAt: active.decidedAt ?? null,
      };
    }

    const policy = state.policies.find((row) => row.branchId === branchId && row.userId === 'preview-self');
    if (policy && !policy.requiresAuthorization) {
      return {
        branchId,
        branchName: policy.branchName,
        requiresAuthorization: false,
        canWork: true,
        status: 'not_required',
      };
    }

    return {
      branchId,
      branchName: state.policies.find((row) => row.branchId === branchId)?.branchName ?? null,
      requiresAuthorization: true,
      canWork: false,
      status: 'not_requested',
    };
  };

  const requestAuthorization: WorkAuthorizationClient['requestAuthorization'] = async (branchId) => {
    const current = await getMyState(branchId);
    if (current.status !== 'not_requested') return current;

    const policy = state.policies.find((row) => row.branchId === branchId);
    const now = new Date().toISOString();
    const request: WorkAuthorizationRecord = {
      id: 'wa-pending-self',
      branchId,
      branchName: policy?.branchName ?? 'الفرع الحالي',
      person: {
        userId: 'preview-self',
        fullName: 'المستخدم الحالي',
        positionLabel: 'موظف',
      },
      status: 'pending',
      requestedAt: now,
      shiftLabel: 'الشفت الحالي',
    };

    state = { ...state, pending: [request, ...state.pending] };
    return getMyState(branchId);
  };

  const approve: WorkAuthorizationClient['approve'] = async (requestId) => {
    const record = state.pending.find((row) => row.id === requestId);
    if (!record) return;
    const now = new Date().toISOString();

    state = {
      ...state,
      pending: state.pending.filter((row) => row.id !== requestId),
      active: [
        {
          ...record,
          id: `wa-active-${record.person.userId}`,
          status: 'approved',
          decidedAt: now,
          startedAt: now,
          approverName: 'أنت — معاينة',
        },
        ...state.active,
      ],
      history: [
        {
          id: `wa-history-approved-${record.id}`,
          branchId: record.branchId,
          branchName: record.branchName,
          person: record.person,
          kind: 'approved',
          occurredAt: now,
          actorName: 'أنت — معاينة',
        },
        ...state.history,
      ],
    };
  };

  const reject: WorkAuthorizationClient['reject'] = async (requestId, reason) => {
    const record = state.pending.find((row) => row.id === requestId);
    if (!record) return;
    const now = new Date().toISOString();

    state = {
      ...state,
      pending: state.pending.filter((row) => row.id !== requestId),
      history: [
        {
          id: `wa-history-rejected-${record.id}`,
          branchId: record.branchId,
          branchName: record.branchName,
          person: record.person,
          kind: 'rejected',
          occurredAt: now,
          actorName: 'أنت — معاينة',
          note: reason,
        },
        ...state.history,
      ],
    };
  };

  const revoke: WorkAuthorizationClient['revoke'] = async (authorizationId, reason) => {
    const record = state.active.find((row) => row.id === authorizationId);
    if (!record) return;
    const now = new Date().toISOString();

    state = {
      ...state,
      active: state.active.filter((row) => row.id !== authorizationId),
      history: [
        {
          id: `wa-history-revoked-${record.id}`,
          branchId: record.branchId,
          branchName: record.branchName,
          person: record.person,
          kind: 'revoked',
          occurredAt: now,
          actorName: 'أنت — معاينة',
          note: reason,
        },
        ...state.history,
      ],
    };
  };

  const setRequirement: WorkAuthorizationClient['setRequirement'] = async (policyId, required) => {
    state = {
      ...state,
      policies: state.policies.map((row) =>
        row.id === policyId ? { ...row, requiresAuthorization: required } : row
      ),
    };
  };

  return {
    getSnapshot,
    getMyState,
    requestAuthorization,
    approve,
    reject,
    revoke,
    setRequirement,
  };
}
