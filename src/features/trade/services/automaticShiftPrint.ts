import type { Language } from '@/lib/types';
import { enqueueCloudReportPrint } from '@/features/pos/services/cloudPrint';
import { buildThermalZReportText } from './shiftClosingReport';
import { fetchShiftClosingReportServer } from './shiftClosingFinancials';

export async function enqueueAutomaticShiftZReport(params: {
  shiftId: string;
  branchId: string;
  currency: string;
  lang: Language;
}): Promise<{ accepted: boolean; jobId?: string; stationCode?: string; error?: string }> {
  try {
    const summary = await fetchShiftClosingReportServer(params.shiftId);
    return await enqueueCloudReportPrint({
      branchId: params.branchId,
      payload: {
        text: buildThermalZReportText(summary, params.currency, params.lang),
        paperWidthMm: 80,
        copies: 1,
      },
      // One automatic close print per shift. Retrying the same close-side effect
      // resolves to the same queue job instead of generating duplicate paper.
      idempotencyKey: `zreport:auto:${params.shiftId}`,
    });
  } catch (error) {
    return {
      accepted: false,
      error: error instanceof Error ? error.message : 'Z_REPORT_QUEUE_FAILED',
    };
  }
}
