"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useLanguage } from "@/components/language-provider";
import { localizedPath, stripLocalePath } from "@/lib/i18n";

const menuPaths = new Set(["/", "/nav", "/tools", "/articles", "/dashboard"]);

export function RouteBackButton() {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, t } = useLanguage();
  const pagePath = stripLocalePath(pathname);

  if (menuPaths.has(pagePath) || pagePath === "/login") return null;

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(localizedPath(fallbackPath(pagePath), locale));
  }

  return (
    <div className="route-back-row">
      <button aria-label={t("auth.back")} className="route-back-button" onClick={handleBack} title={t("auth.back")} type="button">
        <ArrowLeft aria-hidden="true" size={19} />
      </button>
    </div>
  );
}

function fallbackPath(pathname: string): string {
  if (pathname === "/register") return "/login";
  if (pathname.startsWith("/articles")) return "/articles";
  if (pathname.startsWith("/admin")) return "/dashboard";
  if (pathname.startsWith("/profile") || pathname.startsWith("/messages")) return "/dashboard";
  if (pathname.startsWith("/users")) return "/articles";
  return "/";
}
