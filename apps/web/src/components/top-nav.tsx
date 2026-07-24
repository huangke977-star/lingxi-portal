"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Bell,
  Check,
  ListTodo,
  MessageCircleMore,
  UserPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppToast } from "@/components/app-toast";
import { RoleSymbol } from "@/components/role-symbol";
import {
  type ArticleCommentReport,
  getCommentReportSummary,
  listCommentReports,
} from "@/lib/article-api";
import { type AuthUser, getMe, logout, resolveApiUrl } from "@/lib/auth-api";
import {
  AUTH_STATE_CHANGE_EVENT,
  clearAuthTokens,
  readAccessToken,
  readRefreshToken,
} from "@/lib/auth-storage";
import {
  type Conversation,
  type Friendship,
  type SocialNotification,
  getSocialSummary,
  listConversations,
  listFriendships,
  listNotifications,
  markNotificationRead,
  respondFriendRequest,
} from "@/lib/social-api";
import {
  SOCIAL_STATE_CHANGE_EVENT,
  notifySocialStateChange,
  openChatDock,
} from "@/lib/social-events";
import { getAvatarFallbackText, getUserDisplayName } from "@/lib/user-display";

const navItems = [
  { href: "/", label: "首页" },
  { href: "/nav", label: "导航" },
  { href: "/tools", label: "工具" },
  { href: "/articles", label: "发现" },
  { href: "/dashboard", label: "工作台" },
];

const emptySummary = {
  unreadMessages: 0,
  pendingFriendRequests: 0,
  unreadNotifications: 0,
};

export function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const navRef = useRef<HTMLElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const messagePopoverRef = useRef<HTMLDivElement | null>(null);
  const taskPopoverRef = useRef<HTMLDivElement | null>(null);
  const accountMenuCloseTimerRef = useRef<number | null>(null);
  const messageCloseTimerRef = useRef<number | null>(null);
  const taskCloseTimerRef = useRef<number | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isMessagePopoverOpen, setIsMessagePopoverOpen] = useState(false);
  const [isTaskPopoverOpen, setIsTaskPopoverOpen] = useState(false);
  const [socialSummary, setSocialSummary] = useState(emptySummary);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [friendships, setFriendships] = useState<{ friends: Friendship[]; incoming: Friendship[]; outgoing: Friendship[] }>({ friends: [], incoming: [], outgoing: [] });
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [pendingReports, setPendingReports] = useState<ArticleCommentReport[]>([]);
  const [pendingReportCount, setPendingReportCount] = useState(0);
  const [headerError, setHeaderError] = useState("");

  const refreshHeaderData = useCallback(async () => {
    const accessToken = readAccessToken();
    if (!accessToken) {
      setUser(null);
      setSocialSummary(emptySummary);
      setConversations([]);
      setFriendships({ friends: [], incoming: [], outgoing: [] });
      setNotifications([]);
      setPendingReports([]);
      setPendingReportCount(0);
      setIsLoading(false);
      return;
    }

    try {
      const currentUser = await getMe(accessToken);
      const canModerate = currentUser.isSuperAdmin || currentUser.role.level >= 90;
      const [summary, conversationResult, friendshipResult, notificationResult, reportSummary, reportResult] = await Promise.all([
        getSocialSummary(accessToken).catch(() => emptySummary),
        listConversations(accessToken).catch(() => ({ items: [] })),
        listFriendships(accessToken).catch(() => ({ friends: [], incoming: [], outgoing: [] })),
        listNotifications(accessToken).catch(() => ({ items: [], hasMore: false })),
        canModerate ? getCommentReportSummary(accessToken).catch(() => ({ pending: 0 })) : Promise.resolve({ pending: 0 }),
        canModerate ? listCommentReports(accessToken, "pending").catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
      ]);
      setUser(currentUser);
      setSocialSummary(summary);
      setConversations(conversationResult.items);
      setFriendships(friendshipResult);
      setNotifications(notificationResult.items);
      setPendingReportCount(reportSummary.pending);
      setPendingReports(reportResult.items);
    } catch {
      clearAuthTokens();
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Header badges synchronize the current authenticated browser session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshHeaderData();
    const refresh = () => void refreshHeaderData();
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, refresh);
    window.addEventListener(SOCIAL_STATE_CHANGE_EVENT, refresh);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshHeaderData();
    }, 15000);
    return () => {
      window.removeEventListener(AUTH_STATE_CHANGE_EVENT, refresh);
      window.removeEventListener(SOCIAL_STATE_CHANGE_EVENT, refresh);
      window.clearInterval(timer);
    };
  }, [refreshHeaderData]);

  useEffect(() => {
    if (!isMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!navRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  useEffect(() => {
    if (!isAccountMenuOpen && !isMessagePopoverOpen && !isTaskPopoverOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const path = event.composedPath();
      if (isAccountMenuOpen && accountMenuRef.current && !path.includes(accountMenuRef.current)) setIsAccountMenuOpen(false);
      if (isMessagePopoverOpen && messagePopoverRef.current && !path.includes(messagePopoverRef.current)) setIsMessagePopoverOpen(false);
      if (isTaskPopoverOpen && taskPopoverRef.current && !path.includes(taskPopoverRef.current)) setIsTaskPopoverOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setIsAccountMenuOpen(false);
      setIsMessagePopoverOpen(false);
      setIsTaskPopoverOpen(false);
    }
    const frame = window.requestAnimationFrame(() => document.addEventListener("pointerdown", handlePointerDown));
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isAccountMenuOpen, isMessagePopoverOpen, isTaskPopoverOpen]);

  useEffect(() => () => {
    [accountMenuCloseTimerRef, messageCloseTimerRef, taskCloseTimerRef].forEach((timerRef) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    });
  }, []);

  const avatarText = useMemo(() => user ? getAvatarFallbackText(user) : "H", [user]);
  const roleBadge = useMemo(() => user ? {
    code: user.isSuperAdmin ? "super_administrator" : user.role.code,
    tooltip: user.isSuperAdmin ? "超级管理员" : user.role.name,
  } : null, [user]);
  const avatarUrl = user?.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
  const socialCount = socialSummary.unreadMessages + Math.max(socialSummary.pendingFriendRequests, socialSummary.unreadNotifications);
  const unreadConversations = conversations.filter((conversation) => conversation.unreadCount > 0).slice(0, 4);
  const unreadNotifications = notifications.filter((notification) => !notification.readAt && notification.type !== "friend_request_received").slice(0, 4);

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setIsMenuOpen(false);
    setIsAccountMenuOpen(false);
    const refreshToken = readRefreshToken();
    try {
      if (refreshToken) await logout(refreshToken);
    } finally {
      clearAuthTokens();
      setUser(null);
      setIsLoggingOut(false);
      router.push("/login");
    }
  }

  async function handleFriendRequest(friendship: Friendship, status: "accepted" | "declined") {
    const token = readAccessToken();
    if (!token) return;
    try {
      await respondFriendRequest(token, friendship.id, status);
      notifySocialStateChange();
      await refreshHeaderData();
      if (status === "accepted") {
        setIsMessagePopoverOpen(false);
        openChatDock({ userId: friendship.user.id });
      }
    } catch (actionError) {
      setHeaderError(actionError instanceof Error ? actionError.message : "好友申请处理失败。");
    }
  }

  async function handleNotification(notification: SocialNotification) {
    const token = readAccessToken();
    setIsMessagePopoverOpen(false);
    if (token && !notification.readAt) {
      await markNotificationRead(token, notification.id).catch((actionError) => {
        setHeaderError(actionError instanceof Error ? actionError.message : "通知状态更新失败。");
      });
      notifySocialStateChange();
    }
    if (notification.type === "friend_request_received") {
      openChatDock({ tab: "friends" });
    } else if (notification.type === "friend_request_accepted" && notification.actor) {
      openChatDock({ userId: notification.actor.id });
    } else {
      openChatDock({ systemNotificationId: notification.id });
    }
  }

  function cancelClose(timerRef: MutableRefObject<number | null>) {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function scheduleClose(timerRef: MutableRefObject<number | null>, close: () => void) {
    cancelClose(timerRef);
    timerRef.current = window.setTimeout(() => {
      close();
      timerRef.current = null;
    }, 280);
  }

  function handleHoverOpen(event: ReactPointerEvent<HTMLElement>, timerRef: MutableRefObject<number | null>, open: () => void) {
    if (event.pointerType !== "mouse") return;
    cancelClose(timerRef);
    open();
  }

  function isActiveRoute(href: string) {
    return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <>
    <header className="topbar">
      <nav aria-label="主导航" className="topbar-inner" ref={navRef}>
        <button aria-expanded={isMenuOpen} aria-label={isMenuOpen ? "关闭菜单" : "打开菜单"} className="menu-toggle" onClick={() => setIsMenuOpen((current) => !current)} type="button"><span /><span /><span /></button>
        <Link className="brand" href="/"><span className="brand-mark brand-logo-mark"><img alt="" src="/favicon.svg" /></span><span className="brand-copy"><strong>HLOVET</strong><span>Personal Portal</span></span></Link>
        <div className="top-links desktop-links">{navItems.map((item) => <Link className={isActiveRoute(item.href) ? "active" : undefined} href={item.href} key={item.href}>{item.label}</Link>)}</div>
        <div className="account-zone">
          {isLoading ? <span className="login-chip">读取中</span> : null}
          {!isLoading && !user ? <Link className="login-chip login-chip-action" href={`/login?from=${encodeURIComponent(pathname)}`}>登录</Link> : null}
          {user && roleBadge ? <>
            {user.isSuperAdmin || user.role.level >= 90 ? <div className="header-action-wrap" ref={taskPopoverRef} onPointerEnter={(event) => handleHoverOpen(event, taskCloseTimerRef, () => setIsTaskPopoverOpen(true))} onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose(taskCloseTimerRef, () => setIsTaskPopoverOpen(false)); }}>
              <button aria-expanded={isTaskPopoverOpen} aria-label="待处理举报" className={`header-action-button${isTaskPopoverOpen ? " active" : ""}`} onClick={() => setIsTaskPopoverOpen((current) => !current)} title="待处理举报" type="button"><ListTodo aria-hidden="true" size={19} />{pendingReportCount ? <b>{pendingReportCount > 99 ? "99+" : pendingReportCount}</b> : null}</button>
              <div className={`header-popover task-popover${isTaskPopoverOpen ? " open" : ""}`} onPointerEnter={() => cancelClose(taskCloseTimerRef)}>
                <div className="header-popover-heading"><strong>待处理举报</strong><button onClick={() => { setIsTaskPopoverOpen(false); router.push("/admin/articles?tab=comments"); }} type="button">进入管理</button></div>
                <div className="header-popover-list">{pendingReports.length ? pendingReports.slice(0, 6).map((report) => <button key={report.id} onClick={() => { setIsTaskPopoverOpen(false); router.push(`/admin/articles?tab=comments&report=${report.id}`); }} type="button"><span className="header-popover-icon"><ListTodo aria-hidden="true" size={16} /></span><span><strong>{report.commentBody || report.article.title}</strong><small>《{report.article.title}》 · {report.reporter.nickname} · {formatHeaderTime(report.createdAt)}</small></span></button>) : <span className="header-popover-empty">暂无待处理举报。</span>}</div>
              </div>
            </div> : null}
            <div className="header-action-wrap" ref={messagePopoverRef} onPointerEnter={(event) => handleHoverOpen(event, messageCloseTimerRef, () => setIsMessagePopoverOpen(true))} onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose(messageCloseTimerRef, () => setIsMessagePopoverOpen(false)); }}>
              <button aria-expanded={isMessagePopoverOpen} aria-label="消息通知" className={`header-action-button${isMessagePopoverOpen ? " active" : ""}`} onClick={() => setIsMessagePopoverOpen((current) => !current)} title="消息通知" type="button"><MessageCircleMore aria-hidden="true" size={20} />{socialCount ? <b>{socialCount > 99 ? "99+" : socialCount}</b> : null}</button>
              <div className={`header-popover message-popover${isMessagePopoverOpen ? " open" : ""}`} onPointerEnter={() => cancelClose(messageCloseTimerRef)}>
                <div className="header-popover-heading"><strong>消息</strong><button onClick={() => { setIsMessagePopoverOpen(false); openChatDock({ tab: "chats" }); }} type="button">打开聊天</button></div>
                <div className="header-popover-list">
                  {friendships.incoming.slice(0, 2).map((friendship) => <div className="header-friend-request" key={`friend-${friendship.id}`}><span className="header-popover-icon"><UserPlus aria-hidden="true" size={16} /></span><span><strong>{friendship.user.nickname} 请求加为好友</strong>{friendship.note ? <small>{friendship.note}</small> : null}</span><div><button aria-label="接受好友申请" onClick={() => void handleFriendRequest(friendship, "accepted")} title="接受" type="button"><Check aria-hidden="true" size={15} /></button><button aria-label="拒绝好友申请" onClick={() => void handleFriendRequest(friendship, "declined")} title="拒绝" type="button"><X aria-hidden="true" size={15} /></button></div></div>)}
                  {unreadConversations.map((conversation) => <button key={`conversation-${conversation.id}`} onClick={() => { setIsMessagePopoverOpen(false); openChatDock({ conversationId: conversation.id }); }} type="button"><span className="header-popover-icon"><MessageCircleMore aria-hidden="true" size={16} /></span><span><strong>{conversation.user.nickname}</strong><small>{conversation.lastMessage?.body || "发来附件"}</small></span><b>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</b></button>)}
                  {unreadNotifications.map((notification) => <button key={`notification-${notification.id}`} onClick={() => void handleNotification(notification)} type="button"><span className="header-popover-icon"><Bell aria-hidden="true" size={16} /></span><span><strong>{notification.title}</strong><small>{notification.context?.commentBody ?? notification.body}</small></span></button>)}
                  {!friendships.incoming.length && !unreadConversations.length && !unreadNotifications.length ? <span className="header-popover-empty">暂无新消息。</span> : null}
                </div>
              </div>
            </div>
            <button aria-label={roleBadge.tooltip} className="level-badge" data-role={roleBadge.code} data-tooltip={roleBadge.tooltip} title={roleBadge.tooltip} type="button"><RoleSymbol className="role-badge-icon" code={roleBadge.code} /></button>
            <div className="account-menu-wrap" ref={accountMenuRef} onPointerEnter={(event) => handleHoverOpen(event, accountMenuCloseTimerRef, () => setIsAccountMenuOpen(true))} onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose(accountMenuCloseTimerRef, () => setIsAccountMenuOpen(false)); }}>
              <button aria-expanded={isAccountMenuOpen} aria-haspopup="menu" aria-label={`${getUserDisplayName(user)} 的账户菜单`} className="avatar-button" onClick={(event) => { event.stopPropagation(); setIsAccountMenuOpen(true); }} onFocus={() => setIsAccountMenuOpen(true)} type="button">{avatarUrl ? <img alt="" src={avatarUrl} /> : avatarText}</button>
              <div className={`account-menu ${isAccountMenuOpen ? "open" : ""}`} onFocus={() => cancelClose(accountMenuCloseTimerRef)} role="menu">
                <div className="account-menu-head"><strong>{getUserDisplayName(user)}</strong><span>@{user.username}</span></div>
                <Link href="/profile" onClick={() => setIsAccountMenuOpen(false)}>个人中心</Link>
                {user.isSuperAdmin || user.role.level >= 90 ? <><Link href="/admin" onClick={() => setIsAccountMenuOpen(false)}>用户管理</Link><Link href="/admin/content" onClick={() => setIsAccountMenuOpen(false)}>内容管理</Link></> : null}
                {user.isSuperAdmin ? <><Link href="/admin/backgrounds" onClick={() => setIsAccountMenuOpen(false)}>背景管理</Link><Link href="/admin/cache" onClick={() => setIsAccountMenuOpen(false)}>缓存管理</Link></> : null}
                <button disabled={isLoggingOut} onClick={() => void handleLogout()} type="button">{isLoggingOut ? "退出中" : "退出登录"}</button>
              </div>
            </div>
          </> : null}
        </div>
        <div className={`mobile-menu ${isMenuOpen ? "open" : ""}`}>{navItems.map((item) => <Link className={isActiveRoute(item.href) ? "active" : undefined} href={item.href} key={item.href} onClick={() => setIsMenuOpen(false)}>{item.label}</Link>)}</div>
      </nav>
    </header>
    <AppToast duration={4200} message={headerError} onDismiss={() => setHeaderError("")} tone="error" />
    </>
  );
}

function formatHeaderTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
