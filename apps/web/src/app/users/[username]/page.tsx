"use client";

/* eslint-disable @next/next/no-img-element */

import { Check, Clock3, Eye, FileText, Heart, MessageCircle, Rss, UserPlus, UsersRound, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticleCard } from "@/components/article-ui";
import { RoleSymbol } from "@/components/role-symbol";
import { ArticleList, listPublicArticles, listVisibleArticles } from "@/lib/article-api";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import {
  getOrCreateConversation,
  getProfileByUsername,
  PublicProfile,
  requestFriend,
  respondFriendRequest,
  subscribeToAuthor,
  unsubscribeFromAuthor,
} from "@/lib/social-api";
import { notifySocialStateChange, openChatDock } from "@/lib/social-events";
import { getAvatarFallbackText } from "@/lib/user-display";

const emptyArticles: ArticleList = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };

export default function UserProfilePage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const username = decodeURIComponent(params.username);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [articles, setArticles] = useState<ArticleList>(emptyArticles);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const token = readAccessToken();
      setIsLoading(true);
      try {
        const [nextProfile, nextArticles] = await Promise.all([
          getProfileByUsername(username, token),
          token
            ? listVisibleArticles(token, { page: 1, pageSize: 12, authorUsername: username })
            : listPublicArticles({ page: 1, pageSize: 12, authorUsername: username }),
        ]);
        if (!active) return;
        setProfile(nextProfile);
        setArticles(nextArticles);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "用户主页加载失败。");
      } finally {
        if (active) setIsLoading(false);
      }
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [username]);

  async function refreshProfile() {
    setProfile(await getProfileByUsername(username, readAccessToken()));
  }

  function requireLogin(): string | null {
    const token = readAccessToken();
    if (!token) router.push(`/login?from=${encodeURIComponent(`/users/${username}`)}`);
    return token;
  }

  async function toggleSubscription() {
    const token = requireLogin();
    if (!token || !profile) return;
    setIsActing(true);
    try {
      if (profile.subscribed) await unsubscribeFromAuthor(token, profile.id);
      else await subscribeToAuthor(token, profile.id);
      await refreshProfile();
      setNotice(profile.subscribed ? "已取消订阅。" : "已订阅该用户。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "订阅操作失败。");
    } finally {
      setIsActing(false);
    }
  }

  async function addFriend() {
    const token = requireLogin();
    if (!token || !profile) return;
    const note = window.prompt("填写好友申请备注，可留空。", "") ?? null;
    if (note === null) return;
    setIsActing(true);
    try {
      await requestFriend(token, profile.id, note.trim() || undefined);
      await refreshProfile();
      setNotice("好友申请已发送。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "好友申请发送失败。");
    } finally {
      setIsActing(false);
    }
  }

  async function respond(status: "accepted" | "declined") {
    const token = requireLogin();
    if (!token || !profile?.relationship) return;
    setIsActing(true);
    try {
      await respondFriendRequest(token, profile.relationship.id, status);
      await refreshProfile();
      setNotice(status === "accepted" ? "已接受好友申请。" : "已拒绝好友申请。");
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "好友申请处理失败。");
    } finally {
      setIsActing(false);
    }
  }

  async function startChat() {
    const token = requireLogin();
    if (!token || !profile) return;
    setIsActing(true);
    try {
      const conversation = await getOrCreateConversation(token, profile.id);
      openChatDock({ conversationId: conversation.id });
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "会话创建失败。");
    } finally {
      setIsActing(false);
    }
  }

  const loadMore = useCallback(() => {
    if (!profile || isLoadingMore || articles.page >= articles.totalPages) return;
    const token = readAccessToken();
    setIsLoadingMore(true);
    const request = token
      ? listVisibleArticles(token, { page: articles.page + 1, pageSize: 12, authorUsername: username })
      : listPublicArticles({ page: articles.page + 1, pageSize: 12, authorUsername: username });
    request.then((next) => setArticles((current) => ({ ...next, items: [...current.items, ...next.items] })))
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "文章加载失败。"))
      .finally(() => setIsLoadingMore(false));
  }, [articles.page, articles.totalPages, isLoadingMore, profile, username]);

  if (isLoading) return <section className="page-shell public-user-page"><div className="search-page-empty">正在读取用户主页。</div></section>;
  if (!profile) return <section className="page-shell public-user-page"><div className="search-page-empty"><strong>用户主页不可用</strong><span>{error || "该账号不存在或已停用。"}</span></div></section>;

  const avatarUrl = profile.avatarUrl ? resolveApiUrl(profile.avatarUrl) : null;
  const roleCode = profile.isSuperAdmin ? "super_administrator" : profile.role.code;
  const relationship = profile.relationship;

  return <section className="page-shell public-user-page">
    <section className="public-user-profile-card">
      <div className="public-user-avatar">{avatarUrl ? <img alt="" src={avatarUrl} /> : getAvatarFallbackText(profile)}</div>
      <div className="public-user-overview">
        <div className="public-user-copy">
          <div className="public-user-name"><span><h1>{profile.nickname}</h1><small>@{profile.username}</small></span><span className="public-user-role"><RoleSymbol code={roleCode} />{profile.isSuperAdmin ? "超级管理员" : profile.role.name}</span></div>
          <p className="public-user-bio" title={profile.profileBio}>{profile.profileBio}</p>
          <div className="public-user-facts"><span><Clock3 aria-hidden="true" size={15} />{formatJoinedAt(profile.createdAt)} 加入</span><span>{articles.total} 篇当前可见内容</span></div>
        </div>
        <div className="public-user-side">
          <div className="public-user-stats"><span><FileText aria-hidden="true" size={16} /><small>公开文章</small><strong>{profile.publicArticleCount}</strong></span><span><Heart aria-hidden="true" size={16} /><small>累计获赞</small><strong>{profile.receivedLikeCount}</strong></span><span><Eye aria-hidden="true" size={16} /><small>公开阅读</small><strong>{profile.publicViewCount}</strong></span><span><UsersRound aria-hidden="true" size={16} /><small>订阅者</small><strong>{profile.subscriberCount}</strong></span><span><Rss aria-hidden="true" size={16} /><small>已订阅</small><strong>{profile.followingCount}</strong></span></div>
          {!profile.isSelf ? <div className="public-user-actions">
            <button className={profile.subscribed ? "active" : ""} disabled={isActing} onClick={() => void toggleSubscription()} type="button"><Rss aria-hidden="true" size={16} />{profile.subscribed ? "已订阅" : "订阅"}</button>
            {!relationship ? <button disabled={isActing} onClick={() => void addFriend()} type="button"><UserPlus aria-hidden="true" size={16} />加好友</button> : null}
            {relationship?.direction === "outgoing" ? <span><Clock3 aria-hidden="true" size={15} />等待确认</span> : null}
            {relationship?.direction === "incoming" ? <><button disabled={isActing} onClick={() => void respond("accepted")} type="button"><Check aria-hidden="true" size={16} />接受</button><button disabled={isActing} onClick={() => void respond("declined")} type="button"><X aria-hidden="true" size={16} />拒绝</button></> : null}
            {relationship?.direction === "accepted" ? <button disabled={isActing} onClick={() => void startChat()} type="button"><MessageCircle aria-hidden="true" size={16} />发消息</button> : null}
          </div> : null}
        </div>
      </div>
    </section>

    <section className="public-user-articles">
      <header><strong>发布内容</strong><span>{articles.total}</span></header>
      {articles.items.length ? <div className="article-feed-list">{articles.items.map((article) => <ArticleCard article={article} key={article.id} taxonomyPlacement="after-stats" />)}</div> : <div className="search-page-empty"><span>暂时没有可见的发布内容。</span></div>}
      {articles.items.length ? <ArticleInfiniteFooter hasMore={articles.page < articles.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
    </section>
    <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function formatJoinedAt(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}
