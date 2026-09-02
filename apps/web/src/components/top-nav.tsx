"use client";

/* eslint-disable @next/next/no-img-element */

import {
  Bell,
  Check,
  ListTodo,
  MessageCircleMore,
  ShieldCheck,
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
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import { PwaInstallButton } from "@/components/pwa-install-button";
import { GlobalSearch } from "@/components/global-search";
import { RoleSymbol } from "@/components/role-symbol";
import { AvatarManagementBadge } from "@/components/user-identity-badges";
import { getModerationReportSummary, listModerationReports, type ModerationReport } from "@/lib/moderation-api";
import { type AuthUser, getMe, logout, resolveApiUrl } from "@/lib/auth-api";
import {
  AUTH_STATE_CHANGE_EVENT,
  clearAuthTokens,
  readAccessToken,
  readRefreshToken,
} from "@/lib/auth-storage";
import { isSiteManager } from "@/lib/user-permissions";
import {
  type Conversation,
  type NotificationChannelState,
  type SocialNotification,
  deleteNotification,
  getSocialSummary,
  handleChatGroupReport,
  listConversations,
  listNotifications,
  markNotificationRead,
  respondChatGroupInvitationByGroup,
  respondChatGroupJoinRequest,
  respondFriendRequest,
  respondStrangerMessageRequest,
} from "@/lib/social-api";
import {
  SOCIAL_STATE_CHANGE_EVENT,
  notifySocialStateChange,
  openChatDock,
} from "@/lib/social-events";
import { getPublicSiteSettings } from "@/lib/site-settings-api";
import { localizedPath, stripLocalePath } from "@/lib/i18n";
import { growthLevelLabel, notificationBody, notificationTitle } from "@/lib/system-labels";
import { getAvatarFallbackText, getUserDisplayName } from "@/lib/user-display";

const navItems = [
  { href: "/", key: "nav.home" },
  { href: "/tools", key: "nav.tools" },
  { href: "/articles", key: "nav.discover" },
  { href: "/dashboard", key: "nav.workspace" },
] as const;

const emptySummary = {
  unreadMessages: 0,
  pendingFriendRequests: 0,
  pendingStrangerRequests: 0,
  unreadNotifications: 0,
};

const HEADER_MESSAGE_PREVIEW_LIMIT = 8;

function HeaderNotificationCopy({ locale, notification, siteAnnouncementLabel }: { locale: "zh-CN" | "en-US"; notification: SocialNotification; siteAnnouncementLabel: string }) {
  const localizedBody = notificationBody(notification.body, notification.bodyEn, locale);
  const announcement = notification.context?.kind === "announcement" ? notification.context.announcement : null;
  if (announcement) {
    return <span className="header-announcement-notification">
      <small className="header-announcement-notification-type">{siteAnnouncementLabel}</small>
      <strong className="header-announcement-notification-title">{announcement.title}</strong>
      <small className="header-announcement-notification-summary">{announcement.summary || localizedBody}</small>
    </span>;
  }

  return <span><strong>{notificationTitle(notification.type, notification.context?.kind, locale, notification.title)}</strong><small>{notification.context?.requestBody ?? notification.context?.commentBody ?? localizedBody}</small></span>;
}

function pendingReportActionUrl(report: ModerationReport): string {
  if (report.source === "article") return `/admin/articles?tab=articles&report=${report.id}&reportSource=article`;
  if (report.source === "comment") return `/admin/articles?tab=comments&report=${report.id}&reportSource=comment`;
  return report.group
    ? `/messages?groupApproval=${report.group.id}&report=${report.id}`
    : "/messages";
}

export function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { locale, phrase, setLocale, t } = useLanguage();
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
  const [notifications, setNotifications] = useState<SocialNotification[]>([]);
  const [notificationChannelStates, setNotificationChannelStates] = useState<NotificationChannelState[]>([]);
  const [pendingReports, setPendingReports] = useState<ModerationReport[]>([]);
  const [pendingReportCount, setPendingReportCount] = useState(0);
  const [siteBrand, setSiteBrand] = useState({ logoPath: "/favicon.svg", siteName: "HLOVET" });
  const [headerError, setHeaderError] = useState("");

  const refreshHeaderData = useCallback(async () => {
    const accessToken = readAccessToken();
    if (!accessToken) {
      setUser(null);
      setSocialSummary(emptySummary);
      setConversations([]);
      setNotifications([]);
      setNotificationChannelStates([]);
      setPendingReports([]);
      setPendingReportCount(0);
      setIsLoading(false);
      return;
    }

    try {
      const currentUser = await getMe(accessToken);
      if (locale !== "en-US" && currentUser.locale === "en-US" && !pathname.startsWith("/en")) {
        setLocale("en-US");
        router.replace(`${localizedPath(pathname, "en-US")}${window.location.search}${window.location.hash}`);
      }
      const canModerate = isSiteManager(currentUser);
      const [summary, conversationResult, notificationResult, reportSummary, reportResult] = await Promise.all([
        getSocialSummary(accessToken).catch(() => emptySummary),
        listConversations(accessToken).catch(() => ({ items: [] })),
        listNotifications(accessToken).catch(() => ({ items: [], hasMore: false, hiddenChannels: [], channelStates: [] })),
        canModerate ? getModerationReportSummary(accessToken).catch(() => ({ pending: 0, total: 0, bySource: { article: 0, comment: 0, group_message: 0 } })) : Promise.resolve({ pending: 0, total: 0, bySource: { article: 0, comment: 0, group_message: 0 } }),
        canModerate ? listModerationReports(accessToken, { status: "pending", type: "all", page: 1, pageSize: 8 }).catch(() => ({ items: [], total: 0, page: 1, pageSize: 8, totalPages: 1 })) : Promise.resolve({ items: [] }),
      ]);
      setUser(currentUser);
      setSocialSummary(summary);
      setConversations(conversationResult.items);
      setNotifications(notificationResult.items);
      setNotificationChannelStates(notificationResult.channelStates ?? []);
      setPendingReportCount(reportSummary.pending);
      setPendingReports(reportResult.items);
    } catch {
      clearAuthTokens();
    } finally {
      setIsLoading(false);
    }
  }, [locale, pathname, router, setLocale]);

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
    let isMounted = true;
    getPublicSiteSettings()
      .then((settings) => {
        if (isMounted) {
          setSiteBrand({
            logoPath: settings.logoPath || "/favicon.svg",
            siteName: settings.siteName || "HLOVET",
          });
        }
      })
      .catch(() => undefined);
    return () => {
      isMounted = false;
    };
  }, []);

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
    code: user.role.code,
    tooltip: phrase(`成长等级：${growthLevelLabel(user.role.code, locale, user.role.name)}`, `Account level: ${growthLevelLabel(user.role.code, locale, user.role.name)}`),
  } : null, [locale, phrase, user]);
  const avatarUrl = user?.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
  const siteLogoUrl = useMemo(() => resolveConfiguredAssetUrl(siteBrand.logoPath), [siteBrand.logoPath]);
  const pushDisabledChannels = useMemo(
    () => new Set(notificationChannelStates.filter((state) => !state.pushEnabled).map((state) => state.channel)),
    [notificationChannelStates],
  );
  const loadedUnreadMessages = conversations.reduce((total, conversation) => total + (conversation.muted ? 0 : conversation.unreadCount), 0);
  const loadedUnreadNotifications = notifications.filter((notification) => !notification.readAt && !pushDisabledChannels.has(notification.channel)).length;
  const socialCount =
    Math.max(socialSummary.unreadMessages, loadedUnreadMessages) +
    Math.max(socialSummary.unreadNotifications, loadedUnreadNotifications);
  const conversationPreviewLimit = HEADER_MESSAGE_PREVIEW_LIMIT;
  const unreadConversations = conversations.filter((conversation) => !conversation.muted && conversation.unreadCount > 0).slice(0, conversationPreviewLimit);
  const notificationPreviewLimit = Math.max(0, conversationPreviewLimit - unreadConversations.length);
  const messageNotifications = notifications.filter((notification) =>
    !pushDisabledChannels.has(notification.channel) && (!notification.readAt || notification.context?.actionable),
  ).slice(0, notificationPreviewLimit);
  const unreadNotifications = messageNotifications.filter((notification) => !notification.readAt);
  const previewedUnreadCount = unreadConversations.reduce((total, conversation) => total + conversation.unreadCount, 0)
    + unreadNotifications.length;
  const hiddenUnreadCount = Math.max(0, socialCount - previewedUnreadCount);

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
      router.push(localizedPath("/login", locale));
    }
  }

  async function handleNotification(notification: SocialNotification) {
    const token = readAccessToken();
    setIsMessagePopoverOpen(false);
    if (token && !notification.openedAt) {
      await markNotificationRead(token, notification.id).then((updatedNotification) => {
        setNotifications((current) => current.map((item) => item.id === notification.id ? updatedNotification : item));
      }).catch((actionError) => {
        setHeaderError(actionError instanceof Error ? actionError.message : phrase("通知状态更新失败。", "Could not update notification status."));
      });
      notifySocialStateChange();
    }
    if (notification.context?.kind === "announcement" && notification.actionUrl) {
      router.push(notification.actionUrl);
    } else if (notification.context?.kind === "message_mention" && notification.context.conversationId) {
      openChatDock({ conversationId: notification.context.conversationId, ...(notification.messageId ? { messageId: notification.messageId } : {}) });
    } else if (notification.context?.kind === "article_comment" && notification.context.article?.slug) {
      router.push(localizedPath(`/articles/${notification.context.article.slug}${notification.context.commentId ? `?commentId=${notification.context.commentId}` : ""}`, locale));
    } else if (notification.type === "friend_request_received") {
      openChatDock({ systemNotificationId: notification.id, notificationChannel: "system" });
    } else if (notification.type === "friend_request_accepted" && notification.actor) {
      openChatDock({ userId: notification.actor.id });
    } else {
      openChatDock({ systemNotificationId: notification.id, notificationChannel: notification.channel });
    }
  }

  async function handleNotificationAction(notification: SocialNotification, action: "accept" | "reject" | "resolve-report" | "reject-report") {
    const token = readAccessToken();
    const context = notification.context;
    if (!token || !context) return;
    try {
      if (context.kind === "friend_request" && notification.friendshipId) {
        await respondFriendRequest(token, notification.friendshipId, action === "accept" ? "accepted" : "declined");
      } else if (context.kind === "stranger_message_request" && context.requestId) {
        await respondStrangerMessageRequest(token, context.requestId, action === "accept" ? "accepted" : "declined");
      } else if (context.kind === "group_invitation" && context.groupId) {
        await respondChatGroupInvitationByGroup(token, context.groupId, action === "accept" ? "accepted" : "declined");
      } else if (context.kind === "group_join_request" && context.groupId && context.joinRequestId) {
        await respondChatGroupJoinRequest(token, context.groupId, context.joinRequestId, action === "accept" ? "approved" : "rejected");
      } else if (context.kind === "group_report" && context.reportId) {
        await handleChatGroupReport(token, context.reportId, action === "resolve-report"
          ? { status: "resolved", deleteMessage: true, resolution: phrase("管理员已删除被举报消息", "An administrator deleted the reported message") }
          : { status: "rejected", resolution: phrase("未发现违规", "No violation found") });
      } else {
        await handleNotification(notification);
        return;
      }
      await deleteNotification(token, notification.id).catch(() => undefined);
      setNotifications((current) => current.filter((item) => item.id !== notification.id));
      await refreshHeaderData();
      notifySocialStateChange();
    } catch (actionError) {
      setHeaderError(actionError instanceof Error ? actionError.message : phrase("消息处理失败。", "Could not process the message."));
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
    const localPathname = stripLocalePath(pathname);
    return href === "/" ? localPathname === href : localPathname === href || localPathname.startsWith(`${href}/`);
  }

  return (
    <>
    <header className="topbar">
      <nav aria-label={t("nav.main")} className="topbar-inner" ref={navRef}>
        <button aria-expanded={isMenuOpen} aria-label={isMenuOpen ? t("nav.closeMenu") : t("nav.openMenu")} className="menu-toggle" onClick={() => setIsMenuOpen((current) => !current)} type="button"><span /><span /><span /></button>
        <Link className="brand" href={localizedPath("/", locale)}><span className="brand-mark brand-logo-mark"><img alt="" src={siteLogoUrl} /></span><span className="brand-copy"><strong>{siteBrand.siteName}</strong><span>{phrase("个人门户", "Personal Portal")}</span></span></Link>
        <div className="top-links desktop-links">{navItems.map((item) => <Link className={isActiveRoute(item.href) ? "active" : undefined} href={localizedPath(item.href, locale)} key={item.href}>{t(item.key)}</Link>)}</div>
        <div className="account-zone">
          <PwaInstallButton />
          <GlobalSearch />
          <LanguageSwitcher />
          {isLoading ? <span className="login-chip">{t("nav.loading")}</span> : null}
          {!isLoading && !user ? <Link className="login-chip login-chip-action" href={`${localizedPath("/login", locale)}?from=${encodeURIComponent(pathname)}`}>{t("nav.login")}</Link> : null}
          {user ? <>
            {isSiteManager(user) ? <div className="header-action-wrap" ref={taskPopoverRef} onPointerEnter={(event) => handleHoverOpen(event, taskCloseTimerRef, () => setIsTaskPopoverOpen(true))} onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose(taskCloseTimerRef, () => setIsTaskPopoverOpen(false)); }}>
              <button aria-expanded={isTaskPopoverOpen} aria-label={t("nav.pendingReports")} className={`header-action-button${isTaskPopoverOpen ? " active" : ""}`} onClick={() => setIsTaskPopoverOpen((current) => !current)} title={t("nav.pendingReports")} type="button"><ListTodo aria-hidden="true" size={19} />{pendingReportCount ? <b>{pendingReportCount > 99 ? "99+" : pendingReportCount}</b> : null}</button>
              <div className={`header-popover task-popover${isTaskPopoverOpen ? " open" : ""}`} onPointerEnter={() => cancelClose(taskCloseTimerRef)}>
                <div className="header-popover-heading"><strong>{t("nav.pendingReports")}</strong><button onClick={() => { setIsTaskPopoverOpen(false); router.push(localizedPath("/admin/reports", locale)); }} type="button">{t("nav.enterManagement")}</button></div>
                <div className="header-popover-list">{pendingReports.length ? pendingReports.slice(0, 6).map((report) => <button key={report.key} onClick={() => { setIsTaskPopoverOpen(false); router.push(localizedPath(pendingReportActionUrl(report), locale)); }} type="button"><span className="header-popover-icon"><ListTodo aria-hidden="true" size={16} /></span><span><strong>{report.sourceLabel} · {report.article?.title || report.group?.name || report.comment?.body || report.message?.body || phrase("待处理内容", "Pending content")}</strong><small>{report.reporter.nickname} · {formatHeaderTime(report.createdAt, locale)}</small></span></button>) : <span className="header-popover-empty">{t("nav.noPendingReports")}</span>}</div>
              </div>
            </div> : null}
            <div className="header-action-wrap" ref={messagePopoverRef} onPointerEnter={(event) => handleHoverOpen(event, messageCloseTimerRef, () => setIsMessagePopoverOpen(true))} onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose(messageCloseTimerRef, () => setIsMessagePopoverOpen(false)); }}>
              <button aria-expanded={isMessagePopoverOpen} aria-label={t("nav.messageNotification")} className={`header-action-button${isMessagePopoverOpen ? " active" : ""}`} onClick={() => setIsMessagePopoverOpen((current) => !current)} title={t("nav.messageNotification")} type="button"><MessageCircleMore aria-hidden="true" size={20} />{socialCount ? <b>{socialCount > 99 ? "99+" : socialCount}</b> : null}</button>
              <div className={`header-popover message-popover${isMessagePopoverOpen ? " open" : ""}`} onPointerEnter={() => cancelClose(messageCloseTimerRef)}>
                <div className="header-popover-heading"><strong>{t("nav.messages")}</strong><button onClick={() => { setIsMessagePopoverOpen(false); openChatDock({ tab: "chats" }); }} type="button">{t("nav.openChat")}</button></div>
                <div className="header-popover-list">
                  {unreadConversations.map((conversation) => <button key={`conversation-${conversation.id}`} onClick={() => { setIsMessagePopoverOpen(false); openChatDock({ conversationId: conversation.id }); }} type="button"><span className="header-popover-icon"><MessageCircleMore aria-hidden="true" size={16} /></span><span><strong>{conversation.user.nickname}</strong><small>{conversation.lastMessage?.body || phrase("发来附件", "Sent an attachment")}</small></span><b>{conversation.unreadCount > 99 ? "99+" : conversation.unreadCount}</b></button>)}
                  {messageNotifications.map((notification) => notification.context?.actionable ? <div className="header-popover-actionable" key={`notification-${notification.id}`}><button onClick={() => void handleNotification(notification)} type="button"><span className="header-popover-icon"><Bell aria-hidden="true" size={16} /></span><HeaderNotificationCopy locale={locale} notification={notification} siteAnnouncementLabel={t("home.siteAnnouncements")} /></button><span className="header-popover-inline-actions"><button aria-label={phrase("同意或处理", "Accept or handle")} onClick={() => void handleNotificationAction(notification, notification.context?.kind === "group_report" ? "resolve-report" : "accept")} title={notification.context?.kind === "group_report" ? phrase("处理", "Handle") : phrase("同意", "Accept")} type="button"><Check aria-hidden="true" size={12} />{notification.context?.kind === "group_report" ? phrase("处理", "Handle") : phrase("同意", "Accept")}</button><button aria-label={phrase("拒绝或驳回", "Decline or reject")} onClick={() => void handleNotificationAction(notification, notification.context?.kind === "group_report" ? "reject-report" : "reject")} title={notification.context?.kind === "group_report" ? phrase("驳回", "Reject") : phrase("拒绝", "Decline")} type="button"><X aria-hidden="true" size={12} />{notification.context?.kind === "group_report" ? phrase("驳回", "Reject") : phrase("拒绝", "Decline")}</button></span></div> : <button key={`notification-${notification.id}`} onClick={() => void handleNotification(notification)} type="button"><span className="header-popover-icon"><Bell aria-hidden="true" size={16} /></span><HeaderNotificationCopy locale={locale} notification={notification} siteAnnouncementLabel={t("home.siteAnnouncements")} /></button>)}
                  {hiddenUnreadCount ? <button className="header-popover-more" onClick={() => { setIsMessagePopoverOpen(false); openChatDock({ tab: "chats" }); }} type="button">{t("nav.moreUnread", { count: hiddenUnreadCount })}</button> : null}
                  {!unreadConversations.length && !messageNotifications.length ? <span className="header-popover-empty">{t("nav.noNewMessages")}</span> : null}
                </div>
              </div>
            </div>
            {roleBadge ? <button aria-label={roleBadge.tooltip} className="level-badge" data-role={roleBadge.code} data-tooltip={roleBadge.tooltip} title={roleBadge.tooltip} type="button"><RoleSymbol className="role-badge-icon" code={roleBadge.code} /></button> : null}
            <div className="account-menu-wrap" ref={accountMenuRef} onPointerEnter={(event) => handleHoverOpen(event, accountMenuCloseTimerRef, () => setIsAccountMenuOpen(true))} onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose(accountMenuCloseTimerRef, () => setIsAccountMenuOpen(false)); }}>
              <span className="top-nav-avatar-identity">
                <button aria-expanded={isAccountMenuOpen} aria-haspopup="menu" aria-label={t("nav.accountMenu", { name: getUserDisplayName(user) })} className="avatar-button" onClick={(event) => { event.stopPropagation(); setIsAccountMenuOpen(true); }} onFocus={() => setIsAccountMenuOpen(true)} type="button">{avatarUrl ? <img alt="" src={avatarUrl} /> : avatarText}</button>
                <AvatarManagementBadge user={user} />
              </span>
              <div className={`account-menu ${isAccountMenuOpen ? "open" : ""}`} onFocus={() => cancelClose(accountMenuCloseTimerRef)} role="menu">
                <div className="account-menu-head"><strong>{getUserDisplayName(user)}</strong><span>@{user.username}</span></div>
                <Link href={localizedPath(`/users/${encodeURIComponent(user.username)}`, locale)} onClick={() => setIsAccountMenuOpen(false)}>{t("nav.myHomepage")}</Link>
                <Link href={localizedPath("/profile", locale)} onClick={() => setIsAccountMenuOpen(false)}>{t("nav.profile")}</Link>
                <Link href={localizedPath("/profile/reports", locale)} onClick={() => setIsAccountMenuOpen(false)}>{t("nav.myReports")}</Link>
                <Link href={localizedPath("/profile/privacy", locale)} onClick={() => setIsAccountMenuOpen(false)}>{t("nav.privacyData")}</Link>
                <Link href={localizedPath("/feedback", locale)} onClick={() => setIsAccountMenuOpen(false)}>{t("nav.feedback")}</Link>
                {isSiteManager(user) ? <Link href={localizedPath("/admin", locale)} onClick={() => setIsAccountMenuOpen(false)}><ShieldCheck aria-hidden="true" size={15} />{t("nav.adminManagement")}</Link> : null}
                <button disabled={isLoggingOut} onClick={() => void handleLogout()} type="button">{isLoggingOut ? t("nav.loggingOut") : t("nav.logout")}</button>
              </div>
            </div>
          </> : null}
        </div>
        <div className={`mobile-menu ${isMenuOpen ? "open" : ""}`}>{navItems.map((item) => <Link className={isActiveRoute(item.href) ? "active" : undefined} href={localizedPath(item.href, locale)} key={item.href} onClick={() => setIsMenuOpen(false)}>{t(item.key)}</Link>)}</div>
      </nav>
    </header>
    <AppToast duration={4200} message={headerError} onDismiss={() => setHeaderError("")} tone="error" />
    </>
  );
}

function formatHeaderTime(value: string, locale: "zh-CN" | "en-US"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

function resolveConfiguredAssetUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  if (path.startsWith("/api/")) {
    return resolveApiUrl(path.slice(4));
  }
  return path || "/favicon.svg";
}
