import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {RolesProvider,useRoles} from '@/context/RolesContext';
const m=vi.hoisted(()=>({pending:true,select:vi.fn(),session:{user:{id:'verified-owner'},access_token:'one'}}));
vi.mock('@/context/AuthContext',()=>({useAuth:()=>({session:m.session,needsOrganizationSetup:m.pending})}));
vi.mock('@/lib/supabase',()=>({supabase:{from:()=>({select:m.select})}}));
vi.mock('@/lib/reportRequestCache',()=>({invalidateReportPermissions:vi.fn()}));
function Probe(){const {loading,rolePermissionsMap}=useRoles();return <span>{loading?'loading':rolePermissionsMap.owner?.includes('products.view')?'ready':'no-permissions'}</span>;}
beforeEach(()=>{vi.clearAllMocks();m.pending=true;m.session={user:{id:'verified-owner'},access_token:'one'};m.select.mockResolvedValue({data:[{role:'owner',permissions:['products.view'],scope:'global',is_active:true}],error:null});});afterEach(cleanup);
it('loads owner permissions after setup without requiring a different Auth identity or polling',async()=>{
 const view=render(<RolesProvider><Probe/></RolesProvider>);await screen.findByText('no-permissions');expect(m.select).not.toHaveBeenCalled();
 m.pending=false;view.rerender(<RolesProvider><Probe/></RolesProvider>);await screen.findByText('ready');expect(m.select).toHaveBeenCalledOnce();
 m.session={...m.session,access_token:'refreshed'};view.rerender(<RolesProvider><Probe/></RolesProvider>);await waitFor(()=>expect(screen.getByText('ready')).toBeInTheDocument());expect(m.select).toHaveBeenCalledOnce();
 m.pending=true;view.rerender(<RolesProvider><Probe/></RolesProvider>);await screen.findByText('no-permissions');
});
