"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { updateMyLocale } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { inlineTranslation, localeFromPath, LOCALE_COOKIE, LOCALE_STORAGE_KEY, type Locale, supportedLocales, translate, type TranslationKey } from "@/lib/i18n";

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
  phrase: (chinese: string, english: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const pathname = usePathname();
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const activeLocale = pathname ? localeFromPath(pathname) : locale;

  const changeLocale = useCallback((nextLocale: Locale) => {
    setLocale(nextLocale);
    const accessToken = readAccessToken();
    if (accessToken) void updateMyLocale(accessToken, nextLocale).catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.lang = activeLocale;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, activeLocale);
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(activeLocale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [activeLocale]);

  const value = useMemo<LanguageContextValue>(() => ({
    locale: activeLocale,
    setLocale: changeLocale,
    t: (key, values) => translate(activeLocale, key, values),
    phrase: (chinese, english) => inlineTranslation(activeLocale, chinese, english),
  }), [activeLocale, changeLocale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}

export { supportedLocales };
