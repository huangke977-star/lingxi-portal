"use client";

import { ArrowLeft } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

const menuPaths = new Set(["/", "/nav", "/tools", "/articles", "/dashboard"]);

export function RouteBackButton() {
  const pathname = usePathname();
  const router = useRouter();

  if (menuPaths.has(pathname) || pathname === "/login") return null;

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackPath(pathname));
  }

  return (
    <div className="route-back-row">
      <button aria-label="返回上一页" className="route-back-button" onClick={handleBack} title="返回上一页" type="button">
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
