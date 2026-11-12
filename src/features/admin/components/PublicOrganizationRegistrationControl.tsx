import { useEffect, useState } from 'react';
import { admin } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Card } from '@/components/PageHeader';
import { organizationSignupMessage } from '@/features/auth/organizationSignupMessages';

export function PublicOrganizationRegistrationControl() {
 const {lang}=useLanguage();const ar=lang==='ar';
 const [enabled,setEnabled]=useState<boolean>();const [busy,setBusy]=useState(false);const [error,setError]=useState<string>();
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>admin.getPublicTenantRegistrationStatus()).then(result=>{
  if(result.error || typeof result.data?.enabled!=='boolean')throw result.error??new Error('INVALID_STATUS');
  if(active)setEnabled(result.data.enabled);
 }).catch(error=>{if(active)setError(organizationSignupMessage(error,ar));});return()=>{active=false;};},[ar]);
 async function toggle(){if(enabled===undefined || busy)return;setBusy(true);setError(undefined);try{
  const result=await admin.setPublicTenantRegistrationEnabled({p_enabled:!enabled});
  if(result.error || !result.data?.success)throw result.error??new Error('INVALID_STATUS');setEnabled(result.data.enabled);
 }catch(error){setError(organizationSignupMessage(error,ar));}finally{setBusy(false);}}
 return <Card className="space-y-3 p-6"><h3 className="text-lg font-bold">{ar?'تسجيل المؤسسات من صفحة الدخول':'Organization signup from login'}</h3><p className="text-sm text-ui-subtle">{ar?'كل تسجيل ينشئ مؤسسة مستقلة وفرعًا أول وحساب مالك بعد تأكيد البريد.':'Each registration creates an independent organization, first branch and owner account after email confirmation.'}</p><div className="flex items-center gap-3"><span>{enabled===undefined?'…':enabled?(ar?'مفعّل':'Enabled'):(ar?'متوقف':'Paused')}</span><Button type="button" variant={enabled?'danger':'primary'} disabled={enabled===undefined || busy} onClick={()=>void toggle()}>{enabled?(ar?'إيقاف تسجيل المؤسسات':'Pause organization signup'):(ar?'تفعيل تسجيل المؤسسات':'Enable organization signup')}</Button></div>{error&&<p role="alert" className="text-sm text-ui-danger">{error}</p>}</Card>;
}
