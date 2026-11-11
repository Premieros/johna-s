export function organizationSignupMessage(error: unknown, ar: boolean): string {
 const value=error as {code?:string;message?:string}|null;
 const code=[value?.code,value?.message].filter(Boolean).join(' ');
 const messages: Array<[RegExp,string,string]>=[
  [/EMAIL_CONFIRMATION_REQUIRED|email_not_confirmed/,'أكد بريدك الإلكتروني أولًا ثم سجّل دخولك.','Confirm your email first, then sign in.'],
  [/PUBLIC_REGISTRATION_DISABLED|signup_disabled/,'إنشاء المؤسسات الجديدة متوقف حاليًا.','New organization registration is currently paused.'],
  [/PROFILE_ALREADY_EXISTS|user_already_exists/,'يوجد حساب لهذا البريد؛ استخدم تسجيل الدخول.','An account already exists; please sign in.'],
  [/INVALID_REGISTRATION_DETAILS/,'أكمل اسم المؤسسة واسم المالك بصورة صحيحة.','Enter a valid organization and owner name.'],
  [/weak_password/,'استخدم كلمة مرور أقوى من ثمانية أحرف على الأقل.','Use a stronger password of at least eight characters.'],
  [/over_.*rate_limit|rate.limit|429/i,'طلبات كثيرة؛ انتظر قليلًا ثم أعد المحاولة.','Too many requests; wait a little and try again.'],
  [/email_address_invalid/,'أدخل بريدًا إلكترونيًا صحيحًا.','Enter a valid email address.'],
  [/email_address_not_authorized/,'تعذر إرسال رسالة التأكيد لهذا البريد. يرجى التواصل مع الدعم.','Could not send confirmation to this address. Please contact support.'],
  [/USER_INACTIVE/,'الحساب غير نشط؛ تواصل مع الإدارة.','The account is inactive; contact the administrator.'],
 ];
 return messages.find(([pattern])=>pattern.test(code))?.[ar?1:2] ?? (ar?'تعذر إكمال التسجيل الآن. حاول مرة أخرى، وإذا استمرت المشكلة تواصل مع الدعم.':'Could not complete registration. Try again; contact support if the issue continues.');
}
