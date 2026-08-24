"use client";

/* eslint-disable @next/next/no-img-element */

import { Ban, Check, Clock3, Eye, FileText, FolderOpen, Heart, MessageCircle, Rss, Send, UserPlus, UsersRound, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { ArticleCard } from "@/components/article-ui";
import { DiscoveryArticleRow } from "@/components/discovery-ui";
import { RequestComposerDialog } from "@/components/request-composer-dialog";
import { RoleSymbol } from "@/components/role-symbol";
import { AvatarManagementBadge, ManagementIdentitySymbol } from "@/components/user-identity-badges";
import { ArticleList, listPublicArticles, listVisibleArticles } from "@/lib/article-api";
import { resolveApiUrl } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import {
  getOrCreateConversation,
  getProfileByUsername,
  blockUser,
  createStrangerMessageRequest,
  PublicProfile,
  requestFriend,
  respondFriendRequest,
  subscribeToAuthor,
  unsubscribeFromAuthor,
} from "@/lib/social-api";
import { notifySocialStateChange, openChatDock } from "@/lib/social-events";
import { getManagementIdentity } from "@/lib/user-permissions";
import { getAvatarFallbackText } from "@/lib/user-display";
import { getProfileShowcase, type ProfileShowcase } from "@/lib/discovery-api";
import { localizedPath } from "@/lib/i18n";

const emptyArticles: ArticleList = { items: [], total: 0, page: 1, pageSize: 12, totalPages: 1 };

export default function UserProfilePage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const username = decodeURIComponent(params.username);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [articles, setArticles] = useState<ArticleList>(emptyArticles);
  const [showcase, setShowcase] = useState<ProfileShowcase | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isFriendRequestOpen, setIsFriendRequestOpen] = useState(false);
  const [isMessageRequestOpen, setIsMessageRequestOpen] = useState(false);
  const [isBlockConfirmOpen, setIsBlockConfirmOpen] = useState(false);
  const [friendRequestNote, setFriendRequestNote] = useState("");
  const [messageRequestBody, setMessageRequestBody] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      const token = readAccessToken();
      setIsLoading(true);
      try {
        const [nextProfile, nextArticles, nextShowcase] = await Promise.all([
          getProfileByUsername(username, token),
          token
            ? listVisibleArticles(token, { page: 1, pageSize: 12, authorUsername: username })
            : listPublicArticles({ page: 1, pageSize: 12, authorUsername: username }),
          getProfileShowcase(username, token),
        ]);
        if (!active) return;
        setProfile(nextProfile);
        setArticles(nextArticles);
        setShowcase(nextShowcase);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : phrase("用户主页加载失败。", "Could not load user profile."));
      } finally {
        if (active) setIsLoading(false);
      }
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [phrase, username]);

  async function refreshProfile() {
    setProfile(await getProfileByUsername(username, readAccessToken()));
  }

  function requireLogin(): string | null {
    const token = readAccessToken();
    if (!token) router.push(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath(`/users/${username}`, locale))}`);
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
      setNotice(profile.subscribed ? phrase("已取消订阅。", "Subscription canceled.") : phrase("已订阅该用户。", "Subscribed to this user."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("订阅操作失败。", "Could not update subscription."));
    } finally {
      setIsActing(false);
    }
  }

  async function sendFriendRequest() {
    const token = requireLogin();
    if (!token || !profile) return;
    setIsActing(true);
    try {
      await requestFriend(token, profile.id, friendRequestNote.trim() || undefined);
      await refreshProfile();
      setFriendRequestNote("");
      setIsFriendRequestOpen(false);
      setNotice(phrase("好友申请已发送。", "Friend request sent."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("好友申请发送失败。", "Could not send friend request."));
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
      setNotice(status === "accepted" ? phrase("已接受好友申请。", "Friend request accepted.") : phrase("已拒绝好友申请。", "Friend request declined."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("好友申请处理失败。", "Could not process friend request."));
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
      setError(actionError instanceof Error ? actionError.message : phrase("会话创建失败。", "Could not create conversation."));
    } finally {
      setIsActing(false);
    }
  }

  async function sendMessageRequest() {
    const token = requireLogin();
    const body = messageRequestBody.trim();
    if (!token || !profile || !body) return;
    setIsActing(true);
    try {
      await createStrangerMessageRequest(token, profile.id, body);
      setMessageRequestBody("");
      setIsMessageRequestOpen(false);
      setNotice(phrase("消息请求已发送，对方接受后会出现在聊天列表中。", "Message request sent. It will appear in chat after the recipient accepts."));
      notifySocialStateChange();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("消息请求发送失败。", "Could not send message request."));
    } finally {
      setIsActing(false);
    }
  }

  async function confirmBlock() {
    const token = requireLogin();
    if (!token || !profile) return;
    setIsActing(true);
    try {
      await blockUser(token, profile.id);
      setIsBlockConfirmOpen(false);
      setNotice(phrase("已加入黑名单，双方后续互动已停止。", "Added to block list. Future interactions are disabled."));
      notifySocialStateChange();
      router.push(localizedPath("/articles", locale));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("拉黑失败。", "Could not block this user."));
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
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : phrase("文章加载失败。", "Could not load articles.")))
      .finally(() => setIsLoadingMore(false));
  }, [articles.page, articles.totalPages, isLoadingMore, phrase, profile, username]);

  if (isLoading) return <section className="page-shell public-user-page"><div className="search-page-empty">{phrase("正在读取用户主页。", "Loading user profile.")}</div></section>;
  if (!profile) return <section className="page-shell public-user-page"><div className="search-page-empty"><strong>{phrase("用户主页不可用", "Profile unavailable")}</strong><span>{error || phrase("该账号不存在或已停用。", "This account does not exist or is disabled.")}</span></div></section>;

  const avatarUrl = profile.avatarUrl ? resolveApiUrl(profile.avatarUrl) : null;
  const management = getManagementIdentity(profile);
  const relationship = profile.relationship;

  return <section className="page-shell public-user-page">
    <section className="public-user-profile-card">
      <div className="public-user-avatar identity-avatar-host"><span className="identity-avatar-visual">{avatarUrl ? <img alt="" src={avatarUrl} /> : getAvatarFallbackText(profile)}</span><AvatarManagementBadge user={profile} /></div>
      <div className="public-user-overview">
        <div className="public-user-copy">
          <div className="public-user-name"><span><h1>{profile.nickname}</h1><small>@{profile.username}</small></span><span className="public-user-role"><RoleSymbol code={profile.role.code} />{profile.role.name}</span>{management ? <span className="public-user-role"><ManagementIdentitySymbol user={profile} />{management.label}</span> : null}</div>
          {profile.profileBio ? <p className="public-user-bio" title={profile.profileBio}>{profile.profileBio}</p> : null}
          <div className="public-user-facts">{profile.createdAt ? <span><Clock3 aria-hidden="true" size={15} />{phrase(`${formatJoinedAt(profile.createdAt, locale)} 加入`, `Joined ${formatJoinedAt(profile.createdAt, locale)}`)}</span> : null}<span>{phrase(`${articles.total} 篇当前可见内容`, `${articles.total} visible articles`)}</span></div>
        </div>
        <div className="public-user-side">
          {profile.visibleFields.stats || profile.visibleFields.followingCount ? <div className="public-user-stats">{profile.publicArticleCount !== null ? <span><FileText aria-hidden="true" size={16} /><small>{phrase("公开文章", "Public articles")}</small><strong>{profile.publicArticleCount}</strong></span> : null}{profile.receivedLikeCount !== null ? <span><Heart aria-hidden="true" size={16} /><small>{phrase("累计获赞", "Likes received")}</small><strong>{profile.receivedLikeCount}</strong></span> : null}{profile.publicViewCount !== null ? <span><Eye aria-hidden="true" size={16} /><small>{phrase("公开阅读", "Public views")}</small><strong>{profile.publicViewCount}</strong></span> : null}{profile.subscriberCount !== null ? <span><UsersRound aria-hidden="true" size={16} /><small>{phrase("订阅者", "Subscribers")}</small><strong>{profile.subscriberCount}</strong></span> : null}{profile.followingCount !== null ? <span><Rss aria-hidden="true" size={16} /><small>{phrase("已订阅", "Following")}</small><strong>{profile.followingCount}</strong></span> : null}{showcase?.visitCount !== null && showcase?.visitCount !== undefined ? <span><Eye aria-hidden="true" size={16} /><small>{phrase("主页访问", "Profile visits")}</small><strong>{showcase.visitCount}</strong></span> : null}</div> : null}
          {!profile.isSelf ? <div className="public-user-actions">
            <button className={profile.subscribed ? "active" : ""} disabled={isActing} onClick={() => void toggleSubscription()} type="button"><Rss aria-hidden="true" size={16} />{profile.subscribed ? phrase("已订阅", "Subscribed") : phrase("订阅", "Subscribe")}</button>
            {!relationship && profile.canRequestFriend ? <button disabled={isActing} onClick={() => setIsFriendRequestOpen(true)} type="button"><UserPlus aria-hidden="true" size={16} />{phrase("加好友", "Add friend")}</button> : null}
            {relationship?.direction === "outgoing" ? <span><Clock3 aria-hidden="true" size={15} />{phrase("等待确认", "Pending")}</span> : null}
            {relationship?.direction === "incoming" ? <><button disabled={isActing} onClick={() => void respond("accepted")} type="button"><Check aria-hidden="true" size={16} />{phrase("接受", "Accept")}</button><button disabled={isActing} onClick={() => void respond("declined")} type="button"><X aria-hidden="true" size={16} />{phrase("拒绝", "Decline")}</button></> : null}
            {profile.messageAccess === "conversation" ? <button disabled={isActing} onClick={() => void startChat()} type="button"><MessageCircle aria-hidden="true" size={16} />{phrase("发消息", "Message")}</button> : null}
            {profile.messageAccess === "request" ? <button disabled={isActing} onClick={() => setIsMessageRequestOpen(true)} type="button"><Send aria-hidden="true" size={16} />{phrase("消息请求", "Message request")}</button> : null}
            <button aria-label={phrase("加入黑名单", "Block user")} disabled={isActing} onClick={() => setIsBlockConfirmOpen(true)} title={phrase("加入黑名单", "Block user")} type="button"><Ban aria-hidden="true" size={16} /></button>
          </div> : null}
        </div>
      </div>
    </section>

    {showcase?.settings.showPinnedContent && (showcase.pinnedArticle || showcase.pinnedCollection) ? <section className="public-user-featured"><header><strong>{phrase("代表内容", "Featured content")}</strong></header>{showcase.pinnedArticle ? <DiscoveryArticleRow article={showcase.pinnedArticle} /> : null}{showcase.pinnedCollection ? <Link className="profile-featured-collection" href={localizedPath(`/collections/${showcase.pinnedCollection.id}`, locale)}><span>{phrase("代表合集", "Featured collection")}</span><strong>{showcase.pinnedCollection.name}</strong><small>{phrase(`${showcase.pinnedCollection.articleCount} 篇文章`, `${showcase.pinnedCollection.articleCount} articles`)}</small></Link> : null}</section> : null}

    <div className={`public-user-content-layout${showcase?.collections.length ? " has-collections" : ""}`}>
      <section className="public-user-articles">
        <header><strong>{phrase("发布内容", "Published content")}</strong><span>{articles.total}</span></header>
        {articles.items.length ? <div className="article-feed-list">{articles.items.map((article) => <ArticleCard article={article} key={article.id} taxonomyPlacement="after-stats" />)}</div> : <div className="search-page-empty"><span>{phrase("暂时没有可见的发布内容。", "There is no visible published content yet.")}</span></div>}
        {articles.items.length ? <ArticleInfiniteFooter hasMore={articles.page < articles.totalPages} isLoading={isLoadingMore} onLoadMore={loadMore} /> : null}
      </section>
      {showcase?.collections.length ? <aside className="public-user-collections"><header><FolderOpen aria-hidden="true" size={16} /><strong>{phrase("文章合集", "Collections")}</strong><span>{showcase.collections.length}</span></header><div className="public-user-collection-list">{showcase.collections.map((collection) => <Link href={localizedPath(`/collections/${collection.id}`, locale)} key={collection.id}><span className="public-user-collection-icon"><FolderOpen aria-hidden="true" size={17} /></span><span className="public-user-collection-copy"><strong>{collection.name}</strong><small>{phrase(`${collection.articleCount} 篇`, `${collection.articleCount} articles`)} · {collection.description || phrase("暂无说明", "No description")}</small></span></Link>)}</div></aside> : null}
    </div>
    {isFriendRequestOpen ? <RequestComposerDialog icon={<UserPlus aria-hidden="true" size={18} />} isSubmitting={isActing} label={phrase("申请备注", "Friend request note")} maxLength={120} onChange={setFriendRequestNote} onClose={() => { setIsFriendRequestOpen(false); setFriendRequestNote(""); }} onSubmit={() => void sendFriendRequest()} placeholder={phrase("简单介绍一下自己，可不填", "Introduce yourself briefly (optional)")} submitLabel={phrase("发送好友申请", "Send friend request")} title={phrase(`添加 ${profile.nickname} 为好友`, `Add ${profile.nickname} as a friend`)} value={friendRequestNote} /> : null}
    {isMessageRequestOpen ? <RequestComposerDialog icon={<Send aria-hidden="true" size={18} />} isSubmitting={isActing} label={phrase("首条消息", "First message")} maxLength={500} onChange={setMessageRequestBody} onClose={() => { setIsMessageRequestOpen(false); setMessageRequestBody(""); }} onSubmit={() => void sendMessageRequest()} placeholder={phrase("说明来意，对方接受后这段内容会成为第一条聊天消息", "Introduce your reason for messaging. This becomes the first chat message after they accept.")} requireContent submitLabel={phrase("发送消息请求", "Send message request")} title={phrase("发送消息请求", "Send message request")} value={messageRequestBody} /> : null}
    {isBlockConfirmOpen ? <div className="chat-confirm-backdrop" role="presentation"><section aria-modal="true" className="chat-confirm-dialog" role="dialog"><span className="chat-confirm-icon"><Ban aria-hidden="true" size={20} /></span><div><strong>{phrase(`将 ${profile.nickname} 加入黑名单`, `Block ${profile.nickname}`)}</strong><p>{phrase("双方将不能查看主页、添加好友、私信、订阅或互相发送群聊邀请，现有待处理请求也会取消。", "Neither of you can view profiles, add friends, send direct messages, subscribe, or send group invitations. Pending requests will be canceled.")}</p></div><footer><button disabled={isActing} onClick={() => setIsBlockConfirmOpen(false)} type="button">{phrase("取消", "Cancel")}</button><button className="danger" disabled={isActing} onClick={() => void confirmBlock()} type="button">{phrase("确认拉黑", "Confirm block")}</button></footer></section></div> : null}
    <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function formatJoinedAt(value: string, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}
