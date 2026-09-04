"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, FilePenLine, MessageCircleMore, MessagesSquare, ShieldAlert, UsersRound } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { SuggestionsPanel } from "@/components/suggestions-panel";
import { AvatarManagementBadge } from "@/components/user-identity-badges";
import { getMyArticleSummary, type ArticleMineSummary } from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError, resolveApiUrl } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getModerationReportSummary } from "@/lib/moderation-api";
import { getSocialSummary, listChatGroups } from "@/lib/social-api";
import { openChatDock } from "@/lib/social-events";
import { getAvatarFallbackText, getUserDisplayName } from "@/lib/user-display";
import { getManagementIdentity, isSiteManager } from "@/lib/user-permissions";
import { localizedPath } from "@/lib/i18n";
import { growthLevelLabel } from "@/lib/system-labels";

interface DashboardData {
  article: ArticleMineSummary;
  groupCount: number;
  groupPending: number;
  groupReports: number;
  articleReports: number;
  social: { unreadMessages: number; pendingFriendRequests: number; pendingStrangerRequests: number; unreadNotifications: number };
  commentReports: number;
}

const emptyDashboard: DashboardData = { article: { total: 0, draft: 0, published: 0, unpublished: 0, blocked: 0, deleted: 0 }, groupCount: 0, groupPending: 0, groupReports: 0, articleReports: 0, social: { unreadMessages: 0, pendingFriendRequests: 0, pendingStrangerRequests: 0, unreadNotifications: 0 }, commentReports: 0 };

export function DashboardWorkspace() {
  const { locale, t } = useLanguage();
  const [data, setData] = useState<DashboardData>(emptyDashboard);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let active = true;
    const accessToken = readAccessToken();
    if (!accessToken) { window.location.replace("/login?from=%2Fdashboard"); return; }

    async function load(token: string) {
      setIsLoading(true);
      try {
        const currentUser = await getMe(token);
        const canManage = isSiteManager(currentUser);
        const [article, social, groups, moderationSummary] = await Promise.all([
          getMyArticleSummary(token),
          getSocialSummary(token),
          listChatGroups(token),
          canManage ? getModerationReportSummary(token) : Promise.resolve({ total: 0, pending: 0, bySource: { article: 0, comment: 0, group_message: 0 } }),
        ]);
        if (!active) return;
        setUser(currentUser);
        setData({ article, social, groupCount: groups.items.length, groupPending: groups.items.reduce((total, group) => total + group.pendingJoinRequestCount, 0), commentReports: moderationSummary.bySource.comment, groupReports: moderationSummary.bySource.group_message, articleReports: moderationSummary.bySource.article });
        setError("");
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) { clearAuthTokens(); window.location.replace("/login?from=%2Fdashboard"); return; }
        if (active) setError(loadError instanceof Error ? loadError.message : t("dashboard.loading"));
      } finally { if (active) setIsLoading(false); }
    }

    void load(accessToken);
    return () => { active = false; };
  }, [t]);

  const canManage = isSiteManager(user);
  const managementIdentity = user ? getManagementIdentity(user) : null;
  const notificationCount = data.social.unreadMessages + data.social.pendingFriendRequests + data.social.pendingStrangerRequests + data.social.unreadNotifications;
  const moderationCount = data.commentReports + data.groupReports + data.articleReports;

  return <section className="p8-page p8-dashboard-page">
    <header className="p8-page-heading"><div>{locale === "zh-CN" ? <span className="section-label">{t("dashboard.section")}</span> : null}<h1>{t("dashboard.title")}</h1></div><Link className="p8-primary-link" href={localizedPath("/articles/write", locale)}><FilePenLine aria-hidden="true" size={16} />{t("dashboard.writeArticle")}</Link></header>
    {isLoading ? <div className="status-row compact-status-row"><span className="status">{t("dashboard.loading")}</span></div> : user ? <>
      <section className="p8-surface p8-dashboard-identity">
        <div><span className="p8-avatar identity-avatar-host"><span className="identity-avatar-visual">{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : getAvatarFallbackText(user)}</span><AvatarManagementBadge user={user} /></span><span><strong>{getUserDisplayName(user)}</strong><small>@{user.username} · {growthLevelLabel(user.role.code, locale, user.role.name)}{managementIdentity ? ` · ${managementIdentity.label}` : ""}</small></span></div>
        <div className="p8-identity-stats"><span><b>{data.article.published}</b>{t("dashboard.published")}</span><span><b>{data.article.draft}</b>{t("dashboard.drafts")}</span><span><b>{data.groupCount}</b>{t("home.groupCount")}</span></div>
      </section>
      <div className="p8-dashboard-grid">
        <section className="p8-surface p8-dashboard-card"><div className="p8-dashboard-card-heading"><FilePenLine aria-hidden="true" size={18} /><span><h2>{t("dashboard.myCreation")}</h2><small>{t("dashboard.articleStatus")}</small></span><b>{data.article.total}</b></div><div className="p8-dashboard-links"><Link href={localizedPath("/articles/mine", locale)}>{t("dashboard.drafts")} {data.article.draft}</Link><Link href={localizedPath("/articles/mine", locale)}>{t("dashboard.published")} {data.article.published}</Link><Link href={localizedPath("/articles/mine", locale)}>{t("dashboard.unpublished")} {data.article.unpublished}</Link></div><Link className="p8-card-footer-link" href={localizedPath("/articles/mine", locale)}>{t("dashboard.enterCreation")}</Link></section>
        <section className="p8-surface p8-dashboard-card"><div className="p8-dashboard-card-heading"><MessageCircleMore aria-hidden="true" size={18} /><span><h2>{t("dashboard.messageTodo")}</h2><small>{t("dashboard.messageNote")}</small></span><b>{notificationCount}</b></div><div className="p8-dashboard-links"><button onClick={() => openChatDock({ tab: "chats" })} type="button">{t("dashboard.unreadMessages")} {data.social.unreadMessages}</button><button onClick={() => openChatDock({ tab: "friends" })} type="button">{t("dashboard.friendRequests")} {data.social.pendingFriendRequests}</button><button onClick={() => openChatDock({ tab: "chats" })} type="button">{t("dashboard.messageRequests")} {data.social.pendingStrangerRequests}</button><button onClick={() => openChatDock({ tab: "chats" })} type="button">{t("dashboard.notifications")} {data.social.unreadNotifications}</button></div><button className="p8-card-footer-link" onClick={() => openChatDock({ tab: "chats" })} type="button">{t("dashboard.openChat")}</button></section>
        <section className="p8-surface p8-dashboard-card"><div className="p8-dashboard-card-heading"><UsersRound aria-hidden="true" size={18} /><span><h2>{t("dashboard.myGroups")}</h2><small>{t("dashboard.groupNote")}</small></span><b>{data.groupCount}</b></div><div className="p8-dashboard-links"><button onClick={() => openChatDock({ tab: "chats" })} type="button">{t("dashboard.pendingApproval")} {data.groupPending}</button><button onClick={() => openChatDock({ tab: "chats" })} type="button">{t("dashboard.chatList")} {data.groupCount}</button></div><button className="p8-card-footer-link" onClick={() => openChatDock({ tab: "chats" })} type="button">{t("dashboard.enterGroups")}</button></section>
        {canManage ? <section className="p8-surface p8-dashboard-card management"><div className="p8-dashboard-card-heading"><ShieldAlert aria-hidden="true" size={18} /><span><h2>{t("dashboard.managementTodo")}</h2><small>{t("dashboard.managementNote")}</small></span><b>{moderationCount}</b></div><div className="p8-dashboard-links"><Link href={localizedPath("/admin/reports", locale)}>{t("dashboard.reportCenter")} {moderationCount}</Link><Link href={localizedPath("/admin/voices", locale)}><MessagesSquare aria-hidden="true" size={13} />{t("dashboard.anonymousTopics")}</Link></div><Link className="p8-card-footer-link" href={localizedPath("/admin/reports", locale)}>{t("dashboard.enterReportCenter")}</Link></section> : <SuggestionsPanel className="p8-dashboard-suggestion-card" mode="mine" pageSize={8} title={t("dashboard.mySuggestions")} />}
      </div>
      {canManage ? <div className="p8-dashboard-suggestion-row"><SuggestionsPanel mode={user.isSuperAdmin ? "inbox" : "mine"} pageSize={8} title={user.isSuperAdmin ? t("dashboard.receivedSuggestions") : t("dashboard.mySuggestions")} /></div> : null}
      <section className="p8-surface p8-dashboard-note"><Bell aria-hidden="true" size={16} /><span>{t("dashboard.workspaceNote")}</span></section>
    </> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}
