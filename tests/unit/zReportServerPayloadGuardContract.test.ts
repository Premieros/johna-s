import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const agent = fs.readFileSync('src/features/pos/components/settings/CloudPrintAgent.tsx', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260918220500_zreport_server_payload_guard.sql', 'utf8');

describe('Z-report server payload guard', () => {
  it('never forwards report HTML to the thermal transport', () => {
    expect(agent).toContain("job.kind === 'report' && !job.payload?.text && job.payload?.html");
    expect(agent).toContain('legacyReportHtmlToText(job.payload.html)');
    expect(agent).toContain("html: job.kind === 'report' ? undefined : job.payload?.html");
  });

  it('normalizes cached legacy HTML reports before queue insertion', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public._normalize_cloud_report_payload');
    expect(migration).toContain("RETURN (p_payload - 'html') || jsonb_build_object('text', v_text)");
    expect(migration).toContain('v_payload := public._normalize_cloud_report_payload(p_payload)');
    expect(migration).toContain("IF NOT public.can_permission('shifts.report.shift')");
    expect(migration).not.toContain('public.is_pos_admin()');
  });

  it('repairs only unprinted queued legacy report jobs', () => {
    expect(migration).toContain("AND status IN ('pending','failed')");
    expect(migration).toContain("AND COALESCE(btrim(payload->>'html'),'')<>''");
  });
});
