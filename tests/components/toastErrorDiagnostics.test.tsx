import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('@/lib/userIssueTelemetry', () => ({ reportUserIssue: mocks.report }));
vi.mock('@/lib/userFacingError', () => ({ userFacingErrorMessage: (message: string) => message }));
import { ToastProvider, useToast } from '@/components/Toast';
const source = new TypeError('Original technical error');
function Example() {
  const { show } = useToast();
  return <button onClick={() => show('Friendly error', 'error', { source, action: 'pos_settlement_submit', entityId: 'order-id' })}>Fail</button>;
}
beforeEach(() => { mocks.report.mockReset().mockResolvedValue(undefined); });
describe('toast diagnostic source', () => {
  it('keeps the visible message while reporting original source and structured context', () => {
    render(<ToastProvider><Example /></ToastProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Fail' }));
    expect(screen.getByText('Friendly error')).toBeInTheDocument();
    expect(screen.queryByText('Original technical error')).not.toBeInTheDocument();
    expect(mocks.report).toHaveBeenCalledWith(source, { action: 'pos_settlement_submit', entityId: 'order-id' });
    expect(mocks.report.mock.calls[0][1]).not.toHaveProperty('source');
  });
});
