"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { RoleSymbol } from "@/components/role-symbol";
import { AuthUser, getMe, logout, resolveApiUrl } from "@/lib/auth-api";
import {
  AUTH_STATE_CHANGE_EVENT,
  clearAuthTokens,
  readAccessToken,
  readRefreshToken,
} from "@/lib/auth-storage";
import { getAvatarFallbackText, getUserDisplayName } from "@/lib/user-display";

const navItems = [
  { href: "/", label: "首页" },
  { href: "/nav", label: "导航" },
  { href: "/tools", label: "工具" },
  { href: "/dashboard", label: "工作台" },
];

export function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountMenuCloseTimerRef = useRef<number | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadCurrentUser() {
      const accessToken = readAccessToken();

      if (!accessToken) {
        setUser(null);
        if (isMounted) {
          setIsLoading(false);
        }
        return;
      }

      try {
        const currentUser = await getMe(accessToken);
        if (isMounted) {
          setUser(currentUser);
        }
      } catch {
        clearAuthTokens();
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadCurrentUser();
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, loadCurrentUser);

    return () => {
      isMounted = false;
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, loadCurrentUser);
    };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!navRef.current?.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsAccountMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountMenuOpen]);

  useEffect(
    () => () => {
      if (accountMenuCloseTimerRef.current !== null) {
        window.clearTimeout(accountMenuCloseTimerRef.current);
      }
    },
    [],
  );

  const avatarText = useMemo(() => {
    if (!user) {
      return "H";
    }

    return getAvatarFallbackText(user);
  }, [user]);

  const roleBadge = useMemo(() => {
    if (!user) {
      return null;
    }

    return {
      code: user.role.code,
      tooltip: user.isSuperAdmin ? "超级管理员" : user.role.name,
    };
  }, [user]);

  const avatarUrl = user?.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    setIsMenuOpen(false);
    setIsAccountMenuOpen(false);
    const refreshToken = readRefreshToken();

    try {
      if (refreshToken) {
        await logout(refreshToken);
      }
    } finally {
      clearAuthTokens();
      setUser(null);
      setIsLoggingOut(false);
      router.push("/login");
    }
  }

  function closeMobileMenu() {
    setIsMenuOpen(false);
  }

  function closeAccountMenu() {
    cancelAccountMenuClose();
    setIsAccountMenuOpen(false);
  }

  function cancelAccountMenuClose() {
    if (accountMenuCloseTimerRef.current !== null) {
      window.clearTimeout(accountMenuCloseTimerRef.current);
      accountMenuCloseTimerRef.current = null;
    }
  }

  function openAccountMenu() {
    cancelAccountMenuClose();
    setIsAccountMenuOpen(true);
  }

  function scheduleAccountMenuClose() {
    cancelAccountMenuClose();
    accountMenuCloseTimerRef.current = window.setTimeout(() => {
      setIsAccountMenuOpen(false);
      accountMenuCloseTimerRef.current = null;
    }, 260);
  }

  function isActiveRoute(href: string) {
    if (href === "/") {
      return pathname === href;
    }

    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="topbar">
      <nav aria-label="主导航" className="topbar-inner" ref={navRef}>
        <button
          aria-expanded={isMenuOpen}
          aria-label={isMenuOpen ? "关闭菜单" : "打开菜单"}
          className="menu-toggle"
          onClick={() => setIsMenuOpen((current) => !current)}
          type="button"
        >
          <span />
          <span />
          <span />
        </button>
        <Link className="brand" href="/">
          <span className="brand-mark brand-logo-mark">
            <img alt="" src="/favicon.svg" />
          </span>
          <span className="brand-copy">
            <strong>HLOVET</strong>
            <span>Personal Portal</span>
          </span>
        </Link>
        <div className="top-links desktop-links">
          {navItems.map((item) => (
            <Link
              className={isActiveRoute(item.href) ? "active" : undefined}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="account-zone">
          {isLoading ? <span className="login-chip">读取中</span> : null}
          {!isLoading && !user ? (
            <Link
              className="login-chip login-chip-action"
              href={`/login?from=${encodeURIComponent(pathname)}`}
            >
              登录
            </Link>
          ) : null}
          {user && roleBadge ? (
            <>
              <button
                aria-label={roleBadge.tooltip}
                className="level-badge"
                data-role={user.role.code}
                data-tooltip={roleBadge.tooltip}
                title={roleBadge.tooltip}
                type="button"
              >
                <RoleSymbol className="role-badge-icon" code={roleBadge.code} />
              </button>
              <div className="account-menu-wrap" ref={accountMenuRef}>
                <button
                  aria-expanded={isAccountMenuOpen}
                  aria-haspopup="menu"
                  aria-label={`${getUserDisplayName(user)} 的账户菜单`}
                  className="avatar-button"
                  onClick={openAccountMenu}
                  onFocus={openAccountMenu}
                  onPointerEnter={openAccountMenu}
                  onPointerLeave={scheduleAccountMenuClose}
                  type="button"
                >
                  {avatarUrl ? <img alt="" src={avatarUrl} /> : avatarText}
                </button>
                <div
                  className={`account-menu ${isAccountMenuOpen ? "open" : ""}`}
                  onFocus={cancelAccountMenuClose}
                  onPointerEnter={cancelAccountMenuClose}
                  onPointerLeave={scheduleAccountMenuClose}
                  role="menu"
                >
                  <div className="account-menu-head">
                    <strong>{getUserDisplayName(user)}</strong>
                    <span>@{user.username}</span>
                  </div>
                  <Link href="/profile" onClick={closeAccountMenu}>
                    个人中心
                  </Link>
                  {user.isSuperAdmin || user.role.level >= 90 ? (
                    <Link href="/admin" onClick={closeAccountMenu}>
                      用户管理
                    </Link>
                  ) : null}
                  {user.isSuperAdmin ? (
                    <>
                      <Link
                        href="/admin/backgrounds"
                        onClick={closeAccountMenu}
                      >
                        背景管理
                      </Link>
                      <Link href="/admin/cache" onClick={closeAccountMenu}>
                        缓存管理
                      </Link>
                    </>
                  ) : null}
                  <button
                    disabled={isLoggingOut}
                    onClick={() => void handleLogout()}
                    type="button"
                  >
                    {isLoggingOut ? "退出中" : "退出登录"}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>
        <div className={`mobile-menu ${isMenuOpen ? "open" : ""}`}>
          {navItems.map((item) => (
            <Link
              className={isActiveRoute(item.href) ? "active" : undefined}
              href={item.href}
              key={item.href}
              onClick={closeMobileMenu}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
