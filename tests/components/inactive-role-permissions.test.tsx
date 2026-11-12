// UI/backend parity regression; no production permission mutation.
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {RolesProvider,useRoles} from '@/context/RolesContext';
import {useCan} from '@/lib/permissions';
const m=vi.hoisted(()=>({active:true}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({session:{user:{id:'operator'}},user:{id:'operator',role:'custom_operator'},needsOrganizationSetup:false})}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>({select:()=>Promise.resolve({data:[{role:'custom_operator',permissions:['pos.payment.take'],is_active:m.active,scope:'global'}],error:null})})}}));
vi.mock('@/lib/reportRequestCache',()=>({invalidateReportPermissions:vi.fn()}));
function Probe(){const can=useCan();const {loading}=useRoles();return <span data-testid="permission-state">{loading?'loading':can('pos.payment.take')?'payment-allowed':'payment-denied'}</span>;}
afterEach(cleanup);
it('honors active role permissions',async()=>{m.active=true;render(<RolesProvider><Probe/></RolesProvider>);expect(await screen.findByText('payment-allowed')).toBeInTheDocument();});
it('denies a disabled role like backend can_permission does',async()=>{m.active=false;render(<RolesProvider><Probe/></RolesProvider>);await waitFor(()=>expect(screen.getByTestId('permission-state')).not.toHaveTextContent('loading'));expect(screen.getByTestId('permission-state')).toHaveTextContent('payment-denied');});
