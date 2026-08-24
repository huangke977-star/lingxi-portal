import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n";

const EN_PREFIX = "/en";

function isEnglishPath(pathname: string): boolean {
  return pathname === EN_PREFIX || pathname.startsWith(`${EN_PREFIX}/`);
}

function localPath(pathname: string): string {
  if (pathname === EN_PREFIX) return "/";
  return pathname.slice(EN_PREFIX.length) || "/";
}

function isApiOrInternal(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/") || pathname === "/_next" || pathname.startsWith("/_next/");
}

function isStaticAsset(pathname: string): boolean {
  return /\.[^/]+$/.test(pathname);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value as Locale | undefined;

  if (isEnglishPath(pathname)) {
    const targetPath = localPath(pathname);
    if (isApiOrInternal(targetPath)) return NextResponse.next();
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-lingxi-locale", "en-US");
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = targetPath;
    const response = NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });
    response.cookies.set(LOCALE_COOKIE, "en-US", { httpOnly: false, maxAge: 31536000, path: "/", sameSite: "lax" });
    return response;
  }

  if (cookieLocale === "en-US" && !isApiOrInternal(pathname) && !isStaticAsset(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = pathname === "/" ? EN_PREFIX : `${EN_PREFIX}${pathname}`;
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
