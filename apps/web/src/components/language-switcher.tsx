"use client";

import { Languages } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { LOCALE_COOKIE, localizedPath, type Locale } from "@/lib/i18n";

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, setLocale, t } = useLanguage();

  function changeLocale(nextLocale: Locale) {
    if (nextLocale === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(nextLocale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setLocale(nextLocale);
    router.push(`${localizedPath(pathname, nextLocale)}${window.location.search}${window.location.hash}`);
  }

  return <div aria-label={t("language.label")} className="language-switcher" role="group">
    <Languages aria-hidden="true" size={16} />
    <button aria-pressed={locale === "zh-CN"} onClick={() => changeLocale("zh-CN")} type="button">中文</button>
    <span aria-hidden="true">/</span>
    <button aria-pressed={locale === "en-US"} onClick={() => changeLocale("en-US")} type="button">EN</button>
  </div>;
}
