import { fireEvent,render,screen,within } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({grants:[] as string[],detail:vi.fn(),create:vi.fn(),add:vi.fn(),match:vi.fn(),complete:vi.fn()}));
vi.mock('@/api',()=>({accounting:{getBankReconciliation:state.detail,createBankReconciliation:state.create,addStatementLine:state.add,matchBankLine:state.match,completeBankReconciliation:state.complete}}));
vi.mock('@/context/LanguageContext',()=>({useLanguage:()=>({lang:'en',t:(key:string)=>key})}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({user:{id:'u',role:'accountant'}})}));
vi.mock('@/components/Toast',()=>({useToast:()=>({show:vi.fn()})}));
vi.mock('@/lib/useBranchFilter',()=>({useBranchFilter:()=> 'A'}));
vi.mock('@/lib/useHistoryAccess',()=>({useHistoryAccess:()=>({minIso:null})}));
vi.mock('@/lib/permissions',()=>({useCan:()=> (permission:string)=>state.grants.includes(permission),isAdminRole:()=>false}));
vi.mock('@/context/SettingsContext',()=>({useSettings:()=>({effectiveSettings:()=>({currency:'EGP'})})}));
vi.mock('@/hooks/useBranches',()=>({useBranches:()=>({branches:[]})}));
vi.mock('@/features/accounting/services/reconciliationAccounts',()=>({fetchActiveTreasuryAccounts:async()=>[]}));
vi.mock('@/lib/audit',()=>({logAudit:vi.fn()}));
vi.mock('@/hooks/usePaginatedRows',()=>({usePaginatedRows:()=>({rows:[{id:'r',treasury_account:{account_name:'Bank'},statement_date:'2026-10-01',statement_balance:5,book_balance:5,difference:0,status:'open'}],loading:false,error:null,total:1,hasMore:false,loadMore:vi.fn(),refresh:vi.fn()})}));
import { ReconciliationPage } from '@/features/accounting/pages/ReconciliationPage';
beforeEach(()=>{
 state.grants=['accounts.view'];state.create.mockReset();state.add.mockReset();state.match.mockReset();state.complete.mockReset();
 state.detail.mockReset().mockResolvedValue({data:{success:true,header:{id:'r',status:'open',account_name:'Bank',statement_balance:5,book_balance:5,difference:0},statement_lines:[],book_candidates:[]},error:null});
});
describe('existing bank reconciliation action permission',()=>{
 it('allows viewing open reconciliations without offering write actions, even with account management',async()=>{
  state.grants.push('accounts.manage');render(<ReconciliationPage/>);
  expect(screen.queryByRole('button',{name:'reconciliation'})).toBeNull();
  fireEvent.click(screen.getAllByRole('button',{name:'view'})[0]);
  const dialog=within(await screen.findByRole('dialog'));
  expect(dialog.queryByRole('button',{name:'addStatementLine'})).toBeNull();expect(dialog.queryByRole('button',{name:'complete'})).toBeNull();
  expect(state.create).not.toHaveBeenCalled();expect(state.add).not.toHaveBeenCalled();expect(state.complete).not.toHaveBeenCalled();
 });
 it('uses reconciliation permission independently and removes write controls after revocation',async()=>{
  state.grants.push('accounting.reconciliation.manage');const view=render(<ReconciliationPage/>);
  expect(screen.getByRole('button',{name:'reconciliation'})).toBeVisible();
  fireEvent.click(screen.getAllByRole('button',{name:'view'})[0]);
  const dialog=within(await screen.findByRole('dialog'));
  expect(dialog.getByRole('button',{name:'addStatementLine'})).toBeVisible();expect(dialog.getByRole('button',{name:'complete'})).toBeVisible();
  state.grants=['accounts.view'];view.rerender(<ReconciliationPage/>);
  expect(screen.queryByRole('button',{name:'complete'})).toBeNull();expect(screen.queryByRole('button',{name:'addStatementLine'})).toBeNull();
  expect(state.complete).not.toHaveBeenCalled();
 });
});
