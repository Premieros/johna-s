import { admin } from '@/api';
import { getActiveBranchId } from '@/lib/activeBranch';
import { userFacingErrorMessage } from '@/lib/userFacingError';

export type UserIssueKind = 'expected' | 'technical';

type ReportUserIssueOptions = {
  action?: string;
  issueKind?: UserIssueKind;
  branchId?: string | null;
  correlationId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

const EXPECTED_CODE_MARKERS = [
  'REQUIRED',
  'NOT_FOUND',
  'DENIED',
  'MISMATCH',
  'ALREADY',
  'INVALID',
  'EMPTY',
  'BUSY',
  'EXCEEDS',
  'CLOSED',
  'OUT_OF_SCOPE',
  'APPROVAL',
  'INSUFFICIENT',
  'NOT_ALLOWED',
];

const TECHNICAL_MARKERS = [
  'PGRST',
  'SQLSTATE',
  'POSTGRES',
  'POSTGREST',
  'FETCH',
  'NETWORK',
  'TIMEOUT',
  'CHUNK',
  'INTERNAL',
  'TECHNICAL',
];

function extractRawText(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  if (input instanceof Error) return input.message;
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    for (const key of ['code', 'error', 'message', 'detail']) {
      if (typeof obj[key] === 'string' && obj[key]) return String(obj[key]);
    }
  }
  return String(input);
}

export function deriveUserIssueCode(input: unknown): string {
  const raw = extractRawText(input).toUpperCase();
  const explicit = raw.match(/\b[A-Z][A-Z0-9_]{2,79}\b/);
  if (explicit && /[_]/.test(explicit[0])) return explicit[0];

  if (/FAILED TO FETCH|NETWORK|CONNECTION/.test(raw)) return 'NETWORK_ERROR';
  if (/TIMEOUT|TIMED OUT/.test(raw)) return 'TIMEOUT_ERROR';
  if (/CHUNKLOAD|DYNAMICALLY IMPORTED MODULE|MODULE SCRIPT FAILED/.test(raw)) return 'CHUNK_LOAD_ERROR';
  if (/PGRST|POSTGREST/.test(raw)) return 'DATA_API_ERROR';
  if (/SQLSTATE|POSTGRES|RELATION .* DOES NOT EXIST|COLUMN .* DOES NOT EXIST/.test(raw)) return 'DATABASE_ERROR';
  return 'CLIENT_ERROR';
}

export function classifyUserIssue(input: unknown): UserIssueKind {
  const code = deriveUserIssueCode(input);
  if (TECHNICAL_MARKERS.some((marker) => code.includes(marker))) return 'technical';
  if (EXPECTED_CODE_MARKERS.some((marker) => code.includes(marker))) return 'expected';

  const raw = extractRawText(input).toUpperCase();
  if (/FAILED TO FETCH|NETWORK|TIMEOUT|PGRST|POSTGREST|SQLSTATE|POSTGRES|CHUNKLOAD/.test(raw)) return 'technical';
  return 'expected';
}

export function redactTelemetryMessage(message: string): string {
  return String(message || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\d[ -]*?){12,19}\b/g, '[number]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:access[_ -]?token|refresh[_ -]?token|password|secret|cvv)\s*[:=]\s*\S+/gi, '[redacted]')
    .slice(0, 360);
}

function currentScreen(): string {
  if (typeof window === 'undefined') return '/unknown';
  const hashPath = window.location.hash.replace(/^#/, '').split('?')[0];
  const path = hashPath || window.location.pathname || '/unknown';
  return path.slice(0, 120);
}

export async function reportUserIssue(
  input: unknown,
  options: ReportUserIssueOptions = {},
): Promise<void> {
  try {
    const issueKind = options.issueKind ?? classifyUserIssue(input);
    const safeMessage = redactTelemetryMessage(userFacingErrorMessage(input));
    const code = deriveUserIssueCode(input).slice(0, 80);

    await admin.recordUserIssue({
      p_branch_id: options.branchId ?? getActiveBranchId(),
      p_screen: currentScreen(),
      p_action: (options.action || 'user_visible_error').slice(0, 120),
      p_error_code: code,
      p_user_message: safeMessage,
      p_issue_kind: issueKind,
      p_app_version: null,
      p_correlation_id: options.correlationId ?? null,
      p_entity_type: options.entityType ?? null,
      p_entity_id: options.entityId ?? null,
    });
  } catch {
    // Telemetry must never block the user's primary workflow.
  }
}
