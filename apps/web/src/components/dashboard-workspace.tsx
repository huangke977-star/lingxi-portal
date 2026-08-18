"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bell, FilePenLine, MessageCircleMore, MessagesSquare, ShieldAlert, UsersRound } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { SuggestionsPanel } from "@/components/suggestions-panel";
import { UserIdentityBadges } from "@/components/user-identity-badges";
import { getCommentReportSummary, getMyArticleSummary, type ArticleMineSummary } from "@/lib/article-api";
import { AuthUser, getMe, isAuthExpiredError, resolveApiUrl } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getSocialSummary, listChatGroupReports, listChatGroups } from "@/lib/social-api";
import { openChatDock } from "@/lib/social-events";
import { getUserDisplayName } from "@/lib/user-display";
import { getManagementIdentity, isSiteManager } from "@/lib/user-permissions";

interface DashboardData {
  article: ArticleMineSummary;
  groupCount: number;
  groupPending: number;
  groupReports: number;
  social: { unreadMessages: number; pendingFriendRequests: number; unreadNotifications: number };
  commentReports: number;
}

const emptyDashboard: DashboardData = { article: { total: 0, draft: 0, published: 0, unpublished: 0, blocked: 0, deleted: 0 }, groupCount: 0, groupPending: 0, groupReports: 0, social: { unreadMessages: 0, pendingFriendRequests: 0, unreadNotifications: 0 }, commentReports: 0 };

export function DashboardWorkspace() {
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
        const [article, social, groups, commentReports, groupReports] = await Promise.all([
          getMyArticleSummary(token),
          getSocialSummary(token),
          listChatGroups(token),
          canManage ? getCommentReportSummary(token).then((result) => result.pending) : Promise.resolve(0),
          canManage ? listChatGroupReports(token, undefined, "pending").then((result) => result.items.length) : Promise.resolve(0),
        ]);
        if (!active) return;
        setUser(currentUser);
        setData({ article, social, groupCount: groups.items.length, groupPending: groups.items.reduce((total, group) => total + group.pendingJoinRequestCount, 0), commentReports, groupReports });
        setError("");
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) { clearAuthTokens(); window.location.replace("/login?from=%2Fdashboard"); return; }
        if (active) setError(loadError instanceof Error ? loadError.message : "无法读取工作台数据。");
      } finally { if (active) setIsLoading(false); }
    }

    void load(accessToken);
    return () => { active = false; };
  }, []);

  const canManage = isSiteManager(user);
  const managementIdentity = user ? getManagementIdentity(user) : null;
  const notificationCount = data.social.unreadMessages + data.social.pendingFriendRequests + data.social.unreadNotifications;
  const moderationCount = data.commentReports + data.groupReports;

  return <section className="p8-page p8-dashboard-page">
    <header className="p8-page-heading"><div><span className="section-label">WORKSPACE</span><h1>工作台</h1></div><Link className="p8-primary-link" href="/articles/write"><FilePenLine aria-hidden="true" size={16} />写文章</Link></header>
    {isLoading ? <div className="status-row compact-status-row"><span className="status">正在读取工作台</span></div> : user ? <>
      <section className="p8-surface p8-dashboard-identity">
        <div><span className="p8-avatar identity-avatar-host"><span className="identity-avatar-visual">{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : getUserDisplayName(user).slice(0, 2)}</span><UserIdentityBadges user={user} /></span><span><strong>{getUserDisplayName(user)}</strong><small>@{user.username} · {user.role.name}{managementIdentity ? ` · ${managementIdentity.label}` : ""}</small></span></div>
        <div className="p8-identity-stats"><span><b>{data.article.published}</b>已发布</span><span><b>{data.article.draft}</b>草稿</span><span><b>{data.groupCount}</b>群聊</span></div>
      </section>
      <div className="p8-dashboard-grid">
        <section className="p8-surface p8-dashboard-card"><div className="p8-dashboard-card-heading"><FilePenLine aria-hidden="true" size={18} /><span><h2>我的创作</h2><small>文章状态与写作入口</small></span><b>{data.article.total}</b></div><div className="p8-dashboard-links"><Link href="/articles/mine">草稿 {data.article.draft}</Link><Link href="/articles/mine">已发布 {data.article.published}</Link><Link href="/articles/mine">已下架 {data.article.unpublished}</Link></div><Link className="p8-card-footer-link" href="/articles/mine">进入我的创作</Link></section>
        <section className="p8-surface p8-dashboard-card"><div className="p8-dashboard-card-heading"><MessageCircleMore aria-hidden="true" size={18} /><span><h2>消息待办</h2><small>私信、好友申请和站内通知</small></span><b>{notificationCount}</b></div><div className="p8-dashboard-links"><button onClick={() => openChatDock({ tab: "chats" })} type="button">未读消息 {data.social.unreadMessages}</button><button onClick={() => openChatDock({ tab: "friends" })} type="button">好友申请 {data.social.pendingFriendRequests}</button><button onClick={() => openChatDock({ tab: "chats" })} type="button">通知 {data.social.unreadNotifications}</button></div><button className="p8-card-footer-link" onClick={() => openChatDock({ tab: "chats" })} type="button">打开聊天</button></section>
        <section className="p8-surface p8-dashboard-card"><div className="p8-dashboard-card-heading"><UsersRound aria-hidden="true" size={18} /><span><h2>我的群聊</h2><small>加入的群聊与待审批事项</small></span><b>{data.groupCount}</b></div><div className="p8-dashboard-links"><button onClick={() => openChatDock({ tab: "chats" })} type="button">待审批 {data.groupPending}</button><button onClick={() => openChatDock({ tab: "chats" })} type="button">聊天列表 {data.groupCount}</button></div><button className="p8-card-footer-link" onClick={() => openChatDock({ tab: "chats" })} type="button">进入群聊</button></section>
        {canManage ? <section className="p8-surface p8-dashboard-card management"><div className="p8-dashboard-card-heading"><ShieldAlert aria-hidden="true" size={18} /><span><h2>管理待办</h2><small>举报与匿名话题管理</small></span><b>{moderationCount}</b></div><div className="p8-dashboard-links"><Link href="/admin/articles?tab=comments">评论举报 {data.commentReports}</Link><Link href="/admin/groups?tab=reports">群聊举报 {data.groupReports}</Link><Link href="/admin/voices"><MessagesSquare aria-hidden="true" size={13} />匿名话题</Link></div><Link className="p8-card-footer-link" href="/admin/voices">管理匿名话题</Link></section> : <SuggestionsPanel className="p8-dashboard-suggestion-card" mode="mine" pageSize={8} title="我的建议" />}
      </div>
      {canManage ? <div className="p8-dashboard-suggestion-row"><SuggestionsPanel mode={user.isSuperAdmin ? "inbox" : "mine"} pageSize={8} title={user.isSuperAdmin ? "收到的建议" : "我的建议"} /></div> : null}
      <section className="p8-surface p8-dashboard-note"><Bell aria-hidden="true" size={16} /><span>工作台只汇总需要处理的内容；所有明细仍保留在文章、聊天和管理页面。</span></section>
    </> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}
