import { useState } from 'react';
import { admin, supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { organizationSignupMessage } from '../organizationSignupMessages';

export function OrganizationSignupForm({onCancel}:{onCancel:()=>void}) {
 const {session,needsOrganizationSetup,refreshUser,signOut}=useAuth();
 const {lang}=useLanguage();const ar=lang==='ar';
 const metadata=session?.user.user_metadata;
 const [organization,setOrganization]=useState(()=>typeof metadata?.organization_name==='string'?metadata.organization_name:'');
 const [owner,setOwner]=useState(()=>typeof metadata?.owner_name==='string'?metadata.owner_name:'');
 const [phone,setPhone]=useState(()=>typeof metadata?.organization_phone==='string'?metadata.organization_phone:'');
 const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [confirm,setConfirm]=useState('');
 const [busy,setBusy]=useState(false);const [sent,setSent]=useState(false);const [error,setError]=useState<string>();
 async function submit(event:React.FormEvent) {
  event.preventDefault();if(busy)return;setError(undefined);
  if(!needsOrganizationSetup && password!==confirm){setError(ar?'كلمتا المرور غير متطابقتين.':'Passwords do not match.');return;}
  setBusy(true);
  try {
   if(needsOrganizationSetup) {
    const result=await admin.completeOwnOrganizationSignup({p_organization_name:organization.trim(),p_owner_name:owner.trim(),p_phone:phone.trim()||null});
    if(result.error || !result.data?.success)throw result.error??new Error('REGISTRATION_FAILED');
    await refreshUser();
   } else {
    const result=await supabase.auth.signUp({email:email.trim().toLowerCase(),password,options:{
     emailRedirectTo:new URL(import.meta.env.BASE_URL,window.location.origin).href,
     data:{organization_signup:true,organization_name:organization.trim(),owner_name:owner.trim(),organization_phone:phone.trim()},
    }});
    if(result.error)throw result.error;
    setPassword('');setConfirm('');setSent(true);
   }
  } catch(error){setError(organizationSignupMessage(error,ar));}
  finally{setBusy(false);}
 }
 async function back(){if(needsOrganizationSetup)await signOut({scope:'local'});onCancel();}
 if(sent && !needsOrganizationSetup)return <div className="space-y-4"><h3 className="font-bold">{ar?'تحقق من بريدك الإلكتروني':'Check your email'}</h3><p role="status" className="text-sm">{ar?'افتح رسالة التأكيد المرسلة إلى بريدك، ثم عد وسجّل الدخول لإكمال إنشاء مؤسستك.':'Open the confirmation email, then return and sign in to finish creating your organization.'}</p><Button type="button" className="w-full" onClick={()=>void back()}>{ar?'العودة لتسجيل الدخول':'Back to sign in'}</Button></div>;
 return <form onSubmit={event=>void submit(event)} className="space-y-4" data-testid="organization-signup-form">
  <h3 className="font-bold">{needsOrganizationSetup?(ar?'إكمال إنشاء مؤسستك':'Finish setting up your organization'):(ar?'إنشاء مؤسسة جديدة':'Create an organization')}</h3>
  <p className="text-sm text-ui-subtle">{ar?'مؤسسة مستقلة بحساب مالك وفرع أول.':'An independent organization with an owner account and first branch.'}</p>
  <Input id="signup-organization" label={ar?'اسم المؤسسة':'Organization name'} value={organization} onChange={e=>setOrganization(e.target.value)} minLength={2} maxLength={120} required autoComplete="organization" disabled={busy}/>
  <Input id="signup-owner" label={ar?'اسم المالك':'Owner name'} value={owner} onChange={e=>setOwner(e.target.value)} minLength={2} maxLength={120} required autoComplete="name" disabled={busy}/>
  <Input id="signup-phone" label={ar?'الهاتف (اختياري)':'Phone (optional)'} value={phone} onChange={e=>setPhone(e.target.value)} maxLength={32} autoComplete="tel" disabled={busy}/>
  {needsOrganizationSetup?<p className="text-sm">{session?.user.email}</p>:<>
   <Input id="signup-email" label={ar?'البريد الإلكتروني':'Email'} type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required disabled={busy}/>
   <Input id="signup-password" label={ar?'كلمة المرور':'Password'} type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required disabled={busy}/>
   <Input id="signup-confirm" label={ar?'تأكيد كلمة المرور':'Confirm password'} type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required disabled={busy}/>
  </>}
  {error&&<p role="alert" className="text-sm text-ui-danger">{error}</p>}
  <Button type="submit" className="w-full" disabled={busy}>{busy?(ar?'جارٍ الإكمال…':'Working…'):needsOrganizationSetup?(ar?'إنشاء المؤسسة والفرع':'Create organization and branch'):(ar?'إنشاء الحساب وتأكيد البريد':'Create account and confirm email')}</Button>
  <button type="button" className="w-full text-sm underline" disabled={busy} onClick={()=>void back()}>{needsOrganizationSetup?(ar?'استخدام حساب آخر':'Use another account'):(ar?'العودة لتسجيل الدخول':'Back to sign in')}</button>
 </form>;
}
