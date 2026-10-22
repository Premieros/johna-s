import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ branch: 'A', income: vi.fn(), party: vi.fn(), excel: vi.fn(), options: vi.fn(), aging: vi.fn() }));
vi.mock('@/api', () => ({ reporting: { getAgingSummary: mocks.aging, getIncomeStatement: mocks.income, getPartyStatement:mocks.party } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'reader' } }) }));
vi.mock('@/context/LanguageContext', () => ({ useLanguage: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('@/context/SettingsContext', () => ({ useSettings: () => ({ effectiveSettings: () => ({ currency: 'EGP' }) }) }));
vi.mock('@/lib/useBranchFilter', () => ({ useBranchFilter: () => mocks.branch }));
vi.mock('@/lib/useHistoryAccess', () => ({ useHistoryAccess: () => ({ unlimited: true, clampRange: (from: string, to: string) => ({ from, to }) }) }));
vi.mock('@/lib/excel', () => ({ exportToExcelAdvanced: mocks.excel }));
vi.mock('@/features/accounting/services/financialReportSelectors',()=>({loadPartyStatementOptions:mocks.options}));
import { FinancialReportsPage } from '@/features/accounting/pages/FinancialReportsPage';
const data = { revenue: 123, discount: 0, net_revenue: 123, cogs: 0, gross_profit: 123, expenses: 0, net_income: 123 };
const page = () => <MemoryRouter initialEntries={['/?view=income&from=2026-10-01&to=2026-10-07']}><FinancialReportsPage /></MemoryRouter>;
beforeEach(() => { mocks.options.mockReset().mockResolvedValue([{id:'customer',name:'Customer'}]); mocks.branch = 'A'; mocks.income.mockReset();mocks.party.mockReset();mocks.excel.mockReset(); });
describe('financial canonical report reads', () => {
  it('allows a party statement period and aligns debit/credit with the closing balance in table and export',async()=>{
    mocks.party.mockResolvedValue({data:{opening:5,rows:[{line_id:'a',entry_date:'2026-10-01',entry_number:'1',description:'First',debit:10,credit:2,balance:13},{line_id:'b',entry_date:'2026-10-02',entry_number:'2',description:'Second',debit:3,credit:1,balance:15}]},error:null});
    render(<MemoryRouter initialEntries={['/?view=party_statement&from=2026-10-01&to=2026-10-07']}><FinancialReportsPage/></MemoryRouter>);
    expect(screen.getByLabelText('from')).toBeVisible();expect(screen.getByLabelText('to')).toBeVisible();
    await waitFor(()=>expect(screen.getByRole('option',{name:'Customer'})).toBeTruthy());
    fireEvent.change(screen.getByLabelText('from'),{target:{value:'2026-09-01'}});fireEvent.change(screen.getByLabelText('selectParty'),{target:{value:'customer'}});
    fireEvent.click(screen.getByTestId('financial-run-report'));await screen.findByText('Second');
    expect(mocks.party.mock.calls[0][0]).toMatchObject({p_from_date:'2026-09-01',p_to_date:'2026-10-07'});
    const cells=screen.getByRole('table').querySelector('tfoot')!.querySelectorAll('td');expect(cells).toHaveLength(6);expect(cells[3].textContent).toMatch(/13/);expect(cells[4].textContent).toMatch(/3/);expect(cells[5].textContent).toMatch(/15/);
    fireEvent.click(screen.getByRole('button',{name:'exportExcel'}));expect(mocks.excel.mock.calls[0][0].totalRow).toEqual({Debit:13,Credit:3,Balance:15});
  });
  it('makes option read failures visible and retries only after a click',async()=>{
    mocks.options.mockRejectedValueOnce(new Error('OPTION_READ_FAILED')).mockResolvedValueOnce([{id:'customer',name:'Customer'}]);
    render(<MemoryRouter initialEntries={['/?view=party_statement']}><FinancialReportsPage/></MemoryRouter>);
    await screen.findByRole('alert');expect(screen.getByTestId('financial-run-report')).toBeDisabled();expect(mocks.options).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Retry'}));
    await screen.findByRole('option',{name:'Customer'});expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByTestId('financial-run-report')).not.toBeDisabled();expect(mocks.options).toHaveBeenCalledTimes(2);
  });
  it('keeps receivables and payables separate and aligns each aging column',async()=>{
    const buckets={'0_30':10,'31_60':20,'61_90':30,'90_plus':40};
    mocks.aging.mockResolvedValue({data:{ar_open:100,ap_open:200,ar:buckets,ap:buckets,as_of:'2026-10-22'},error:null});
    render(<MemoryRouter initialEntries={['/?view=aging_summary']}><FinancialReportsPage/></MemoryRouter>);
    fireEvent.click(screen.getByTestId('financial-run-report'));await screen.findByText('Description');
    const table=screen.getByRole('table');expect(table.querySelectorAll('thead th')).toHaveLength(5);
    for(const row of table.querySelectorAll('tbody tr'))expect(row.querySelectorAll('td')).toHaveLength(5);
    expect(screen.queryByText('openBalance')).toBeNull();
  });
  it('shows additional income as a separate line and includes it in the export',async()=>{
    mocks.income.mockResolvedValue({data:{...data,other_income:25,net_income:148},error:null});render(page());
    fireEvent.click(screen.getByTestId('financial-run-report'));await screen.findByText('Other and additional income');
    fireEvent.click(screen.getByRole('button',{name:'exportExcel'}));expect(mocks.excel.mock.calls[0][0].data).toContainEqual({Item:'Other and additional income',Amount:25});
  });
  it('shows an API failure and blocks exporting old or empty results', async () => {
    mocks.income.mockResolvedValue({ data: null, error: { message: 'SOURCE_FAILED' } });
    render(page());
    expect(mocks.income).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('financial-run-report'));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'exportExcel' })).toBeDisabled();
    expect(screen.queryByText('123.00 EGP')).toBeNull();
  });
  it('aborts old scope, rejects its late result and exports only the active branch result', async () => {
    let resolve!: (value: { data: typeof data; error: null }) => void;
    mocks.income.mockImplementationOnce(() => new Promise(value => { resolve = value; }));
    const view = render(page());
    fireEvent.click(screen.getByTestId('financial-run-report'));
    await waitFor(() => expect(mocks.income).toHaveBeenCalled());
    const signal = mocks.income.mock.calls[0][1] as AbortSignal;
    mocks.branch = 'B';
    mocks.income.mockResolvedValue({ data: { ...data, revenue: 456, net_revenue: 456, gross_profit: 456, net_income: 456 }, error: null });
    view.rerender(page());
    expect(mocks.income).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'exportExcel' })).toBeDisabled();
    fireEvent.click(screen.getByTestId('financial-run-report'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'exportExcel' })).not.toBeDisabled());
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data, error: null }));
    expect(screen.queryByText(/123[.,]00/)).toBeNull();
    expect(mocks.income.mock.calls[mocks.income.mock.calls.length - 1][0].p_branch_id).toBe('B');
  });
});
