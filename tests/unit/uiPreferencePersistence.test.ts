import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('UI preference persistence contract', () => {
  it('locks only explicit language selection and keeps system defaults separate', () => {
    const source = read('src/context/LanguageContext.tsx');

    expect(source).toContain("LANGUAGE_PREFERENCE_LOCK_KEY = 'pos_lang_preference_locked'");
    expect(source).toContain("localStorage.setItem(LANGUAGE_PREFERENCE_LOCK_KEY, '1')");
    expect(source).toContain('const applySystemLang = useCallback((l: Language) => {');
    expect(source).toContain('setLangState(l);');
  });

  it('locks explicit theme selection/toggle and keeps system defaults separate', () => {
    const source = read('src/context/ThemeContext.tsx');

    expect(source).toContain("THEME_PREFERENCE_LOCK_KEY = 'pos_theme_preference_locked'");
    expect(source).toContain("localStorage.setItem(THEME_PREFERENCE_LOCK_KEY, '1')");
    expect(source).toContain('const applySystemTheme = useCallback((t: Theme) => {');
    expect(source).toContain('lockThemePreference();');
  });

  it('does not overwrite locked preferences during settings refresh', () => {
    const source = read('src/context/SettingsContext.tsx');

    expect(source).toContain("if (data.theme && !hasLockedThemePreference()) applySystemTheme(data.theme as 'light' | 'dark');");
    expect(source).toContain("if (data.language && !hasLockedLanguagePreference()) applySystemLang(data.language as 'ar' | 'en');");
    expect(source).not.toContain('if (data.theme) setTheme(');
    expect(source).not.toContain('if (data.language) setLang(');
  });
});
