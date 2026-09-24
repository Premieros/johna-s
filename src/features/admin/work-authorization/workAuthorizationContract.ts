export type WorkAuthorizationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'revoked'
  | 'expired';

export type WorkAuthorizationHistoryKind =
  | 'requested'
  | 'approved'
  | 'rejected'
  | 'revoked'
  | 'expired';

export interface WorkAuthorizationPerson {
  userId: string;
  fullName: string;
  roleLabel: string;
}

export interface WorkAuthorizationRecord {
  id: string;
  branchId: string;
  branchName: string;
  person: WorkAuthorizationPerson;
  status: WorkAuthorizationStatus;
  requestedAt: string;
  decidedAt?: string | null;
  approverName?: string | null;
  decisionReason?: string | null;
  shiftLabel?: string | null;
  startedAt?: string | null;
}

export interface WorkAuthorizationHistoryEntry {
  id: string;
  branchId: string;
  branchName: string;
  person: WorkAuthorizationPerson;
  kind: WorkAuthorizationHistoryKind;
  occurredAt: string;
  actorName?: string | null;
  note?: string | null;
}

export interface WorkAuthorizationPolicyRow {
  id: string;
  branchId: string;
  branchName: string;
  userId: string;
  userName: string;
  roleLabel: string;
  requiresAuthorization: boolean;
}

export interface WorkAuthorizationSnapshot {
  pending: WorkAuthorizationRecord[];
  active: WorkAuthorizationRecord[];
  history: WorkAuthorizationHistoryEntry[];
  policies: WorkAuthorizationPolicyRow[];
}

export interface WorkAuthorizationQuery {
  branchId?: string | null;
}

export interface WorkAuthorizationClient {
  getSnapshot(query?: WorkAuthorizationQuery): Promise<WorkAuthorizationSnapshot>;
  approve(requestId: string): Promise<void>;
  reject(requestId: string, reason: string): Promise<void>;
  revoke(authorizationId: string, reason: string): Promise<void>;
  setRequirement(policyId: string, required: boolean): Promise<void>;
}

/**
 * UI-first contract only.
 *
 * Production will satisfy this interface with protected RPCs.
 * Components must not read/write work-authorization tables directly.
 * Authorization decisions are permission-first; role labels are display-only.
 */
