import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const dispatch = fs.readFileSync('src/features/pos/services/kitchenDispatch.ts', 'utf8');
const kitchen = fs.readFileSync('src/features/pos/services/kitchen.ts', 'utf8');
const header = fs.readFileSync('src/features/pos/components/order/PosOrderHeaderBar.tsx', 'utf8');
const stations = fs.readFileSync('src/features/catalog/pages/KitchenStationsPage.tsx', 'utf8');
const hook = fs.readFileSync('src/features/pos/hooks/usePosOrderBase.ts', 'utf8');

describe('kitchen stations and send-button restructure contract', () => {
  it('separates authoritative send from station dispatch orchestration', () => {
    expect(kitchen).toContain("dispatchKitchenStations");
    expect(kitchen).not.toContain("enqueueCloudKitchenPrintJobs");
    expect(kitchen).not.toContain("printKitchenStationsLocally");
    expect(dispatch).toContain("groupKitchenItemsByStation");
    expect(dispatch).toContain("failed_stations");
    expect(dispatch).toContain("missing_station_items");
  });

  it('reports every station as queued, local printed, or failed', () => {
    expect(dispatch).toContain("state: 'queued'");
    expect(dispatch).toContain("'local_printed'");
    expect(dispatch).toContain("'failed'");
    expect(dispatch).toContain("status = successfulStations > 0 ? 'partial' : 'failed'");
  });

  it('surfaces partial station dispatch instead of a generic success only', () => {
    expect(hook).toContain("kitchenDispatch");
    expect(hook).toContain("تم تسجيل إرسال المطبخ، لكن توجيه المحطات غير مكتمل");
    expect(header).toContain('pos-kitchen-dispatch-warning');
    expect(header).toContain("إرسال التعديلات");
    expect(header).toContain("تم الإرسال");
  });

  it('shows configuration health for each station and branch summary', () => {
    expect(stations).toContain('kitchen-station-health-summary');
    expect(stations).toContain('بدون فئات');
    expect(stations).toContain('جاهزة');
    expect(stations).toContain('withoutCategories');
  });
});
