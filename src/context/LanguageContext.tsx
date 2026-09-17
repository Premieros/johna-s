import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Language } from '../lib/types';
import { t as translate, type TranslationKey } from '../lib/i18n';

export const LANGUAGE_STORAGE_KEY = 'pos_lang';
export const LANGUAGE_PREFERENCE_LOCK_KEY = 'pos_lang_preference_locked';

export function hasLockedLanguagePreference(): boolean {
  return localStorage.getItem(LANGUAGE_PREFERENCE_LOCK_KEY) === '1';
}

interface LanguageContextValue {
  lang: Language;
  setLang: (l: Language) => void;
  applySystemLang: (l: Language) => void;
  t: (key: TranslationKey) => string;
  dir: 'rtl' | 'ltr';
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Language>(() => {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return (saved as Language) || 'ar';
  });

  const dir: 'rtl' | 'ltr' = lang === 'ar' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }, [lang, dir]);

  const setLang = useCallback((l: Language) => {
    localStorage.setItem(LANGUAGE_PREFERENCE_LOCK_KEY, '1');
    setLangState(l);
  }, []);

  const applySystemLang = useCallback((l: Language) => {
    setLangState(l);
  }, []);

  const t = useCallback((key: TranslationKey) => translate(lang, key), [lang]);

  const value = useMemo(
    () => ({ lang, setLang, applySystemLang, t, dir }),
    [lang, setLang, applySystemLang, t, dir]
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
