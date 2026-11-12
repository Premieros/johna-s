import { describe, expect, it, vi } from 'vitest';
vi.mock('@/api/domains/printRecovery', () => ({ printRecovery: {} }));
import { manualTicketText, manualPrintError, prepareManualPrintWindow } from '@/features/pos/services/manualPrintRecovery';
describe('manual browser ticket output', () => {
  it('preserves the exact queued plain text without inserting markup', () => {
    const payload = { text: 'طاولة 3\nمياه × 1\n<script>evil()</script>' };
    const doc = document.implementation.createHTMLDocument();
    const print = vi.fn();
    prepareManualPrintWindow({ document: doc, focus: vi.fn(), print } as unknown as Window,
      { id: 'job', kind: 'kitchen', station_code: 'بار', created_at: '', payload }, true);
    expect(doc.querySelector('pre')?.textContent).toBe(payload.text);
    expect(doc.querySelector('script')).toBeNull();
    expect(print).not.toHaveBeenCalled(); // Never auto-print merely by reserving/opening.
    doc.querySelector('button')?.click();
    expect(print).toHaveBeenCalledOnce();
    doc.querySelector('button')?.click();
    expect(print).toHaveBeenCalledOnce();
  });
  it('removes active legacy HTML but preserves row boundaries and totals', () => {
    expect(manualTicketText({ html: '<script>evil()</script><table><tr><td>مياه</td><td>1</td></tr><tr><td>الإجمالي</td><td>25</td></tr></table>' }))
      .toBe('مياه\t1\t\nالإجمالي\t25\t\n');
  });
  it('does not fabricate output for a missing document', () => {
    expect(() => manualTicketText({})).toThrow('PRINT_CONTENT_MISSING');
  });
  it('does not expose transport SQL or recommend blind retry', () => {
    const message = manualPrintError(new Error('SELECT secret FROM internal'), true);
    expect(message).not.toContain('SELECT');
    expect(message).toContain('حالة التذكرة');
  });
});
