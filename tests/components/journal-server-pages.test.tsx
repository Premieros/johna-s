import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { JournalPage } from '@/features/accounting/pages/JournalPage';
import type { JournalDto, JournalPageDto } from '@/lib/types';

const mocks = vi.hoisted(() => ({ read: vi.fn(), userId: 'u', branch: 'a' }));
vi.mock('@/api', () => ({ accounting: { postManualJournal: vi.fn() } }));
vi.mock('@/api/domains/accounting', () => ({ accounting: { getJournalsPage: mocks.read } }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: mocks.userId, branch_id: mocks.branch } }) }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => mocks.branch }));
vi.mock('@/lib/permissions', () => ({ useCan: () => () => false }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ minDate: undefined, clampRange: (from: string, to: string) => ({ from, to }) }) }));
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }) }));
vi.mock('@/hooks/useBranches', () => ({ useBranches: () => ({ branches: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }) }));
vi.mock('@/features/accounting/services/journalAccounts', () => ({ fetchActiveJournalAccounts: async () => [] }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

const row: JournalDto = { id: 'j', entry_number: 'JE-FIRST', entry_date: '2026-10-05', reference_type: 'manual', reference_id: null, reference_number: null, description: 'entry', created_at: '2026-10-05', debit_total: 10, credit_total: 10, lines: [] };
const snapshot = (more: boolean, name = 'JE-FIRST'): JournalPageDto => ({ rows: [{ ...row, entry_number: name }], summary: { total_count: 205, debit_total: 2529.7, credit_total: 2529.7, balance: 0 }, page_size: 100, has_more: more, next_cursor: more ? { entry_date: row.entry_date, entry_number: name, id: row.id } : null });
beforeEach(() => { mocks.read.mockReset(); mocks.userId = 'u'; mocks.branch = 'a'; });

describe('journal server paging screen', () => {
  it('keeps period totals when moving pages and preserves entry detail viewing', async () => {
    mocks.read.mockResolvedValueOnce({ data: snapshot(true), error: null }).mockResolvedValueOnce({ data: snapshot(false, 'JE-NEXT'), error: null });
    render(<MemoryRouter><JournalPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    const cards = screen.getByTestId('journal-page');
    expect(within(cards).getByText('205')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled());
    await waitFor(() => expect(screen.getByText('Page 2')).toBeInTheDocument());
    expect(screen.getByText('205')).toBeInTheDocument();
    expect(screen.getAllByText(/2,529\.7/).length).toBeGreaterThanOrEqual(2);
    const view = screen.getAllByRole('button', { name: 'view' })[0];
    fireEvent.click(view);
    expect(screen.getByTestId('modal-body')).toBeInTheDocument();
  });

  it('clears open detail and complete totals before painting a different user scope', async () => {
    mocks.read.mockResolvedValue({ data: snapshot(false), error: null });
    const { rerender } = render(<MemoryRouter><JournalPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('205')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'view' })[0]);
    mocks.read.mockReturnValue(new Promise(() => {}));
    mocks.userId = 'other';
    rerender(<MemoryRouter><JournalPage /></MemoryRouter>);
    expect(screen.queryByTestId('modal-body')).not.toBeInTheDocument();
    expect(screen.queryByText('205')).not.toBeInTheDocument();
  });
});
