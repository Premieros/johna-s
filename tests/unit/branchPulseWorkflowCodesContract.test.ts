import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync('src/features/admin/components/BranchPulsePanel.tsx', 'utf8');

describe('Branch Pulse workflow-code presentation', () => {
  it('presents branch state as workflow activity instead of a problem verdict', () => {
    expect(panel).toContain("active: { ar: 'نشط', en: 'Active'");
    expect(panel).toContain("quiet: { ar: 'هادئ', en: 'Quiet'");
    expect(panel).not.toContain('Needs review');
    expect(panel).not.toContain('يحتاج مراجعة');
  });

  it('renders only opaque BP follow-up codes for branch anomalies', () => {
    expect(panel).toContain("PRINT_FAILURES: 'BP-01'");
    expect(panel).toContain("STALE_OPEN_ORDERS: 'BP-02'");
    expect(panel).toContain("SALES_WITHOUT_SHIFT_COVERAGE: 'BP-03'");
    expect(panel).toContain("SALES_WITHOUT_PRINT_SUBMISSION: 'BP-04'");
    expect(panel).toContain("{FOLLOWUP_CODES[code] || 'BP-00'}");
    expect(panel).not.toContain('فشل طباعة');
    expect(panel).not.toContain('طلبات مفتوحة عالقة');
    expect(panel).not.toContain('مبيعات بدون تغطية شفت مطابقة');
    expect(panel).not.toContain('مبيعات بدون إرسال طباعة');
  });

  it('renders user events as opaque UX codes without exposing readable error details', () => {
    expect(panel).toContain("return 'UX-' +");
    expect(panel).toContain("{opaqueIssueCode(issue)}");
    expect(panel).toContain("رموز الأحداث");
    expect(panel).not.toContain('مشاكل المستخدمين');
    expect(panel).not.toContain("{issue.user_message");
    expect(panel).not.toContain("{issue.error_code || 'CLIENT_ERROR'}");
    expect(panel).not.toContain("issue.issue_kind === 'technical'");
    expect(panel).not.toContain("{issue.screen || '/unknown'}");
  });

  it('keeps the selected-period workflow framing explicit', () => {
    expect(panel).toContain('سير العمل لكل فرع خلال الفترة المحددة');
    expect(panel).toContain('Workflow by branch for the selected period');
    expect(panel).toContain('عرض الفروع ذات الرموز');
    expect(panel).toContain('Branches with codes');
  });
});
