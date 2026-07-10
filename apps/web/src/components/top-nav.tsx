"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuthUser, getMe, logout } from "@/lib/auth-api";
import {
  AUTH_STATE_CHANGE_EVENT,
  clearAuthTokens,
  readAccessToken,
  readRefreshToken,
} from "@/lib/auth-storage";

const navItems = [
  { href: "/", label: "首页" },
  { href: "/nav", label: "导航" },
  { href: "/tools", label: "工具" },
  { href: "/dashboard", label: "工作台" },
];

const roleBadgeIcons: Record<string, string> = {
  qi_refining: "气",
  foundation_building: "基",
  golden_core: "丹",
  nascent_soul: "婴",
  spirit_transformation: "神",
  void_refining: "虚",
  body_integration: "合",
  mahayana: "乘",
  administrator: "令",
};

export function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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

  const avatarText = useMemo(() => {
    if (!user?.username) {
      return "H";
    }

    return user.username.trim().slice(0, 1).toUpperCase();
  }, [user]);

  const roleBadge = useMemo(() => {
    if (!user) {
      return null;
    }

    return {
      icon: roleBadgeIcons[user.role.code] ?? "阶",
      tooltip: `${user.role.name}${user.isSuperAdmin ? " · 超级管理员" : ""} · 等级 ${user.role.level}`,
    };
  }, [user]);

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    setIsMenuOpen(false);
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
          <span className="brand-mark">H</span>
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
            <Link className="login-chip login-chip-action" href="/login">
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
                <span aria-hidden="true" className="role-badge-icon">
                  {roleBadge.icon}
                </span>
              </button>
              <div className="account-menu-wrap">
                <button
                  aria-label={`${user.username} 的账户菜单`}
                  className="avatar-button"
                  type="button"
                >
                  {avatarText}
                </button>
                <div className="account-menu">
                  <div className="account-menu-head">
                    <strong>{user.username}</strong>
                    <span>{user.email}</span>
                  </div>
                  <Link href="/profile">个人中心</Link>
                  <Link href="/dashboard">工作台</Link>
                  <Link href="/nav">导航</Link>
                  <Link href="/tools">工具箱</Link>
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
