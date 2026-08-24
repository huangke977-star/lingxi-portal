"use client";

import { Eye, EyeOff, Heart, KeyRound, LoaderCircle, Lock, MessageCircleMore, Plus, Search, Send, ThumbsDown, ThumbsUp, Unlock, UserRoundPen, X } from "lucide-react";
import { FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { getMe } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
import { isSiteManager } from "@/lib/user-permissions";
import { useLanguage } from "@/components/language-provider";
import { localizedPath } from "@/lib/i18n";
import {
  claimAnonymousIdentity,
  createAnonymousTopic,
  getAnonymousTopic,
  getAnonymousTopicAdmin,
  listAnonymousTopics,
  listAnonymousTopicsAdmin,
  readAnonymousIdentity,
  reactToAnonymousMessage,
  saveAnonymousIdentity,
  sendAnonymousMessage,
  toggleAnonymousTopicFavorite,
  type AnonymousTopicDetail,
  type AnonymousTopicMessage,
  type AnonymousTopicSort,
  type AnonymousTopicSummary,
  type AnonymousTopicVisibility,
  updateAnonymousMessage,
  updateAnonymousTopic,
  updateAnonymousTopicAsCreator,
} from "@/lib/anonymous-topics-api";

export function AnonymousTopicsPanel({ initialSort = "time", management = false, pageSize = 5, title, moreHref, showLoadMore = false, showSearch = false, showSort = false }: { initialSort?: AnonymousTopicSort; management?: boolean; pageSize?: number; title?: string; moreHref?: string; showLoadMore?: boolean; showSearch?: boolean; showSort?: boolean }) {
  const { locale, phrase, t } = useLanguage();
  const [items, setItems] = useState<AnonymousTopicSummary[]>([]);
  const [pageInfo, setPageInfo] = useState({ page: 1, totalPages: 1 });
  const [topic, setTopic] = useState<AnonymousTopicDetail | null>(null);
  const [error, setError] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isIdentityOpen, setIsIdentityOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isManager, setIsManager] = useState(false);
  const [message, setMessage] = useState("");
  const [topicDraft, setTopicDraft] = useState({ title: "", nickname: "", password: "" });
  const [identityDraft, setIdentityDraft] = useState({ nickname: "", password: "" });
  const [identityCreate, setIdentityCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<AnonymousTopicSort>(initialSort);
  const [visibility, setVisibility] = useState<AnonymousTopicVisibility>("visible");
  const sortOptions: ReadonlyArray<{ label: string; value: AnonymousTopicSort }> = [
    { label: t("voice.sort.time"), value: "time" },
    { label: t("voice.sort.participation"), value: "participation" },
    { label: t("voice.sort.likes"), value: "likes" },
    { label: t("voice.sort.favorites"), value: "favorites" },
  ];
  const visibilityOptions: ReadonlyArray<{ label: string; value: AnonymousTopicVisibility }> = [
    { label: t("voice.visibility.all"), value: "all" },
    { label: t("voice.visibility.visible"), value: "visible" },
    { label: t("voice.visibility.hidden"), value: "hidden" },
  ];

  const loadTopics = useCallback(async (pageNumber = 1, append = false) => {
    setIsLoading(true);
    try {
      const token = readAccessToken();
      const useAdminList = Boolean(token && (management || (isManager && showSearch)));
      const page = useAdminList && token
        ? await listAnonymousTopicsAdmin(token, { page: pageNumber, pageSize, q: query, sort, visibility })
        : await listAnonymousTopics({ page: pageNumber, pageSize, q: query, sort });
      setItems((current) => append ? [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))] : page.items);
      setPageInfo({ page: page.page, totalPages: page.totalPages });
      setError("");
    }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : t("voice.loading")); }
    finally { setIsLoading(false); }
  }, [isManager, management, pageSize, query, showSearch, sort, t, visibility]);

  function loadMoreTopics() {
    if (isLoading || pageInfo.page >= pageInfo.totalPages) return;
    void loadTopics(pageInfo.page + 1, true);
  }

  const loadTopic = useCallback(async (id: number, beforeSequence?: number) => {
    const token = readAccessToken();
    const next = token && (management || isManager)
      ? await getAnonymousTopicAdmin(token, id, { limit: 40, beforeSequence })
      : await getAnonymousTopic(id, { limit: 40, beforeSequence });
    setTopic((current) => {
      if (!beforeSequence || current?.id !== id) return next;
      const known = new Set(current.messages.map((item) => item.id));
      return { ...next, messages: [...next.messages.filter((item) => !known.has(item.id)), ...current.messages] };
    });
  }, [isManager, management]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTopics(), query ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [loadTopics, query]);
  useEffect(() => {
    const token = readAccessToken();
    if (!token) return;
    void getMe(token).then((user) => setIsManager(isSiteManager(user))).catch(() => setIsManager(false));
  }, []);
  useEffect(() => {
    const topicId = topic?.id;
    if (!topicId) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadTopic(topicId);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [loadTopic, topic?.id]);

  async function openTopic(id: number) {
    try { await loadTopic(id); setMessage(""); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : phrase("无法打开话题。", "Could not open the topic.")); }
  }

  async function createTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const created = await createAnonymousTopic(topicDraft);
      saveAnonymousIdentity(created.id, created);
      setTopicDraft({ title: "", nickname: "", password: "" });
      setIsCreateOpen(false);
      await loadTopics();
      await openTopic(created.id);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("发起话题失败。", "Could not create the topic.")); }
    finally { setIsSaving(false); }
  }

  async function claimIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!topic) return;
    setIsSaving(true);
    try {
      const identity = await claimAnonymousIdentity(topic.id, { ...identityDraft, create: identityCreate });
      saveAnonymousIdentity(topic.id, identity);
      setIdentityDraft({ nickname: "", password: "" });
      setIdentityCreate(false);
      setIsIdentityOpen(false);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("无法设置或恢复昵称。", "Could not set or recover the nickname.")); }
    finally { setIsSaving(false); }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!topic || !message.trim()) return;
    setIsSaving(true);
    try {
      const identity = readAnonymousIdentity(topic.id);
      const sent = await sendAnonymousMessage(topic.id, message, identity?.identityToken);
      setTopic((current) => current ? { ...current, messageCount: Math.max(current.messageCount + 1, sent.sequence), messages: [...current.messages.filter((item) => item.id !== sent.id), sent] } : current);
      setMessage("");
      await loadTopics();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("发送失败。", "Could not send the message.")); }
    finally { setIsSaving(false); }
  }

  async function react(messageId: number, value: "up" | "down") {
    try {
      const next = await reactToAnonymousMessage(messageId, value);
      setTopic((current) => current ? { ...current, messages: current.messages.map((item) => item.id === next.id ? next : item) } : current);
      await loadTopics();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("操作失败。", "Action failed.")); }
  }

  async function toggleFavorite(item: AnonymousTopicSummary) {
    try {
      const next = await toggleAnonymousTopicFavorite(item.id);
      setItems((current) => current.map((known) => known.id === item.id ? { ...known, ...next } : known));
      setTopic((current) => current?.id === item.id ? { ...current, ...next } : current);
      if (sort === "favorites" || sort === "home") await loadTopics();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("无法更新话题喜欢状态。", "Could not update topic favorite status.")); }
  }

  async function moderateTopic() {
    if (!topic) return;
    setIsSaving(true);
    try {
      const nextStatus = topic.status === "active" ? "closed" : "active";
      const token = readAccessToken();
      const identity = readAnonymousIdentity(topic.id);
      const next = isManager && token
        ? await updateAnonymousTopic(token, topic.id, { status: nextStatus })
        : identity?.isCreator
          ? await updateAnonymousTopicAsCreator(topic.id, nextStatus, identity.identityToken)
          : null;
      if (!next) throw new Error(phrase("只有话题创建者或管理员可以操作话题状态。", "Only the topic creator or an administrator can change the topic status."));
      setTopic({ ...topic, ...next });
      await loadTopics();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("更新话题失败。", "Could not update the topic.")); }
    finally { setIsSaving(false); }
  }

  async function toggleTopicHidden() {
    const token = readAccessToken();
    if (!token || !topic || !isManager) return;
    setIsSaving(true);
    try {
      const next = await updateAnonymousTopic(token, topic.id, { isHidden: !topic.isHidden });
      setTopic({ ...topic, ...next });
      await loadTopics();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("更新话题可见状态失败。", "Could not update topic visibility.")); }
    finally { setIsSaving(false); }
  }

  async function hideMessage(messageId: number, isHidden: boolean) {
    const token = readAccessToken();
    if (!token || !topic) return;
    setIsSaving(true);
    try {
      await updateAnonymousMessage(token, messageId, isHidden);
      await Promise.all([loadTopic(topic.id), loadTopics()]);
    }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("更新消息可见状态失败。", "Could not update message visibility.")); }
    finally { setIsSaving(false); }
  }

  return <section className="p8-surface anonymous-topics-panel">
    <div className="p8-section-heading"><div><MessageCircleMore aria-hidden="true" size={17} /><h2>{title ?? t("voice.title")}</h2></div><span className="p8-heading-actions-compact">{isManager && (showSearch || management) ? <span className="anonymous-topic-visibility"><GlassSelect ariaLabel={t("voice.visibility")} onChange={setVisibility} options={visibilityOptions} value={visibility} /></span> : null}{showSort ? <span className="anonymous-topic-sort"><GlassSelect ariaLabel={t("voice.sort")} onChange={setSort} options={sortOptions} value={sort} /></span> : null}{moreHref ? <Link href={localizedPath(moreHref, locale)}>{t("voice.all")}</Link> : null}{!management ? <button aria-label={t("voice.start")} className="p8-heading-icon" onClick={() => setIsCreateOpen(true)} title={t("voice.start")} type="button"><Plus aria-hidden="true" size={17} /></button> : null}</span></div>
    {showSearch || management ? <label className="p8-list-search"><Search aria-hidden="true" size={16} /><input onChange={(event) => setQuery(event.target.value)} placeholder={t("voice.search")} value={query} /></label> : null}
    {isLoading && !items.length ? <p className="p8-empty"><LoaderCircle aria-hidden="true" className="spin" size={15} />{t("voice.loading")}</p> : items.length ? <><div className="anonymous-topic-list">{items.map((item) => <AnonymousTopicListRow item={item} key={item.id} onFavorite={toggleFavorite} onOpen={openTopic} />)}</div>{showLoadMore && pageInfo.page < pageInfo.totalPages ? <button className="p8-load-more" disabled={isLoading} onClick={loadMoreTopics} type="button">{isLoading ? t("common.loading") : t("voice.loadMore")}</button> : null}</> : <p className="p8-empty">{t("voice.none")}</p>}
    {topic ? <TopicDialog identityCreate={identityCreate} identityOpen={isIdentityOpen} identityDraft={identityDraft} isManager={isManager} isSaving={isSaving} message={message} onClaim={claimIdentity} onClose={() => { setIdentityCreate(false); setIsIdentityOpen(false); setTopic(null); }} onCloseIdentity={() => { setIdentityCreate(false); setIsIdentityOpen(false); }} onHideMessage={hideMessage} onLoadMore={() => void loadTopic(topic.id, topic.messages[0]?.sequence)} onModerateTopic={moderateTopic} onOpenIdentity={() => { setIdentityDraft({ nickname: "", password: "" }); setIdentityCreate(false); setIsIdentityOpen(true); }} onReact={react} onSend={sendMessage} onToggleTopicHidden={toggleTopicHidden} setIdentityCreate={setIdentityCreate} setIdentityDraft={setIdentityDraft} setMessage={setMessage} topic={topic} /> : null}
    {isCreateOpen ? <ModalPortal><div className="modal-backdrop anonymous-topic-backdrop" role="presentation"><section aria-modal="true" className="anonymous-topic-modal topic-create-modal" role="dialog"><header><span><MessageCircleMore aria-hidden="true" size={18} /><strong>{phrase("发起匿名话题", "Start anonymous topic")}</strong></span><button aria-label={t("common.close")} onClick={() => setIsCreateOpen(false)} title={t("common.close")} type="button"><X aria-hidden="true" size={17} /></button></header><form onSubmit={createTopic}><label><span>{phrase("话题", "Topic")}</span><input autoFocus maxLength={120} onChange={(event) => setTopicDraft({ ...topicDraft, title: event.target.value })} placeholder={phrase("一句话描述想吐槽的内容", "Describe what you want to discuss in one sentence")} required value={topicDraft.title} /></label><label><span>{phrase("昵称", "Nickname")}</span><input maxLength={32} onChange={(event) => setTopicDraft({ ...topicDraft, nickname: event.target.value })} placeholder={phrase("创建话题必须填写昵称", "A nickname is required to create a topic")} required value={topicDraft.nickname} /></label><label><span>{phrase("密码", "Password")}</span><input minLength={6} onChange={(event) => setTopicDraft({ ...topicDraft, password: event.target.value })} placeholder={phrase("用于其他设备恢复昵称", "Use this to recover your nickname on another device")} required type="password" value={topicDraft.password} /></label><footer><button disabled={isSaving} type="submit"><Plus aria-hidden="true" size={15} />{isSaving ? phrase("创建中", "Creating") : phrase("创建并进入", "Create and enter")}</button></footer></form></section></div></ModalPortal> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function TopicDialog({ identityCreate, identityOpen, identityDraft, isManager, isSaving, message, onClaim, onClose, onCloseIdentity, onHideMessage, onLoadMore, onModerateTopic, onOpenIdentity, onReact, onSend, onToggleTopicHidden, setIdentityCreate, setIdentityDraft, setMessage, topic }: { identityCreate: boolean; identityOpen: boolean; identityDraft: { nickname: string; password: string }; isManager: boolean; isSaving: boolean; message: string; onClaim: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; onCloseIdentity: () => void; onHideMessage: (id: number, isHidden: boolean) => void; onLoadMore: () => void; onModerateTopic: () => void; onOpenIdentity: () => void; onReact: (id: number, value: "up" | "down") => void; onSend: (event: FormEvent<HTMLFormElement>) => void; onToggleTopicHidden: () => void; setIdentityCreate: (value: boolean) => void; setIdentityDraft: (value: { nickname: string; password: string }) => void; setMessage: (value: string) => void; topic: AnonymousTopicDetail }) {
  const { phrase, t } = useLanguage();
  const identity = readAnonymousIdentity(topic.id);
  const canModerate = isManager || Boolean(identity?.isCreator);
  const topicState = topic.isHidden
    ? t("voice.hidden")
    : topic.status === "closed"
      ? t("voice.closed")
      : t("voice.messageCount", { count: topic.messageCount });
  const currentIdentity = identity
    ? `${phrase("昵称：", "Nickname: ")}${identity.nickname}${identity.isCreator ? phrase("（创建者）", " (Creator)") : ""} · `
    : "";
  return <ModalPortal><div className="modal-backdrop anonymous-topic-backdrop" role="presentation"><section aria-modal="true" className="anonymous-topic-modal topic-chat-modal" role="dialog"><header><span className="anonymous-topic-title"><MessageCircleMore aria-hidden="true" size={18} /><strong>{topic.title}</strong><small>{currentIdentity}{topicState}</small></span><div><button aria-label={phrase("获取昵称", "Get nickname")} onClick={onOpenIdentity} title={phrase("获取或创建昵称", "Get or create nickname")} type="button"><UserRoundPen aria-hidden="true" size={16} /></button>{isManager ? <button aria-label={topic.isHidden ? phrase("取消隐藏话题", "Show topic") : phrase("隐藏话题", "Hide topic")} disabled={isSaving} onClick={() => void onToggleTopicHidden()} title={topic.isHidden ? phrase("取消隐藏话题", "Show topic") : phrase("隐藏话题", "Hide topic")} type="button">{topic.isHidden ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}</button> : null}{canModerate ? <button aria-label={topic.status === "active" ? phrase("关闭话题", "Close topic") : phrase("重新开放话题", "Reopen topic")} disabled={isSaving} onClick={() => void onModerateTopic()} title={topic.status === "active" ? phrase("关闭话题", "Close topic") : phrase("重新开放话题", "Reopen topic")} type="button">{topic.status === "active" ? <Unlock aria-hidden="true" size={16} /> : <Lock aria-hidden="true" size={16} />}</button> : null}<button aria-label={t("common.close")} onClick={onClose} title={t("common.close")} type="button"><X aria-hidden="true" size={17} /></button></div></header><main className="anonymous-topic-chat">{identity ? <span className="anonymous-identity-note"><KeyRound aria-hidden="true" size={14} />{phrase("当前昵称：", "Current nickname: ")}{identity.nickname}</span> : <button className="anonymous-identity-note" onClick={onOpenIdentity} type="button"><KeyRound aria-hidden="true" size={14} />{phrase("匿名发言，获取昵称后可在其他设备恢复", "Post anonymously. Get a nickname to recover it on another device.")}</button>}{topic.hasMore ? <button className="anonymous-load-more" onClick={onLoadMore} type="button">{phrase("加载更早消息", "Load earlier messages")}</button> : null}<div className="anonymous-message-list">{topic.messages.map((item) => <AnonymousMessageRow isManager={isManager} key={item.id} message={item} onHide={onHideMessage} onReact={onReact} />)}</div></main><form className="anonymous-message-composer" onSubmit={onSend}><textarea disabled={topic.status === "closed" || topic.isHidden || isSaving} maxLength={2000} onChange={(event) => setMessage(event.target.value)} placeholder={topic.isHidden ? t("voice.hidden") : topic.status === "closed" ? t("voice.closed") : phrase("说点什么", "Say something")} rows={2} value={message} /><button aria-label={t("common.send")} disabled={topic.status === "closed" || topic.isHidden || isSaving || !message.trim()} title={t("common.send")} type="submit"><Send aria-hidden="true" size={17} /></button></form>{identityOpen ? <div className="anonymous-identity-sheet"><form onSubmit={onClaim}><header><span><KeyRound aria-hidden="true" size={17} /><strong>{identityCreate ? phrase("创建昵称", "Create nickname") : phrase("获取昵称", "Get nickname")}</strong></span><button aria-label={phrase("关闭昵称窗口", "Close nickname panel")} onClick={onCloseIdentity} title={t("common.close")} type="button"><X aria-hidden="true" size={16} /></button></header><p>{identityCreate ? phrase("昵称和密码在当前话题内一一绑定，创建后不能修改。", "A nickname and password are uniquely paired within this topic and cannot be changed after creation.") : phrase("输入已绑定的密码，即可获取这个话题中的昵称。", "Enter the linked password to recover this topic nickname.")}</p><label className="anonymous-identity-create"><input checked={identityCreate} onChange={(event) => setIdentityCreate(event.target.checked)} type="checkbox" /><span>{phrase("创建昵称", "Create nickname")}</span></label>{identityCreate ? <label><span>{phrase("昵称", "Nickname")}</span><input autoFocus maxLength={32} onChange={(event) => setIdentityDraft({ ...identityDraft, nickname: event.target.value })} required value={identityDraft.nickname} /></label> : null}<label><span>{phrase("密码", "Password")}</span><input autoFocus={!identityCreate} minLength={6} onChange={(event) => setIdentityDraft({ ...identityDraft, password: event.target.value })} required type="password" value={identityDraft.password} /></label><footer><button disabled={isSaving} type="submit">{identityCreate ? phrase("创建并使用", "Create and use") : phrase("获取昵称", "Get nickname")}</button></footer></form></div> : null}</section></div></ModalPortal>;
}

function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function AnonymousTopicListRow({ item, onFavorite, onOpen }: {
  item: AnonymousTopicSummary;
  onFavorite: (item: AnonymousTopicSummary) => Promise<void>;
  onOpen: (id: number) => Promise<void>;
}) {
  const { locale, phrase, t } = useLanguage();
  return <article className={item.isHidden ? "hidden" : undefined}>
    <button className="anonymous-topic-open" onClick={() => void onOpen(item.id)} type="button">
      <span className="anonymous-topic-list-copy">
        <strong>{item.title}</strong>
        <span className="anonymous-topic-subline"><small>{formatTime(item.updatedAt, locale)}{item.isHidden ? ` · ${t("voice.hidden")}` : ""}</small>{item.topLikedMessage || item.topDislikedMessage ? <span className="anonymous-topic-highlights">
          {item.topLikedMessage ? <small className="up" title={item.topLikedMessage.body}><ThumbsUp aria-hidden="true" size={12} /><span>{topicHighlightLabel(item.topLikedMessage, locale)}</span></small> : null}
          {item.topDislikedMessage ? <small className="down" title={item.topDislikedMessage.body}><ThumbsDown aria-hidden="true" size={12} /><span>{topicHighlightLabel(item.topDislikedMessage, locale)}</span></small> : null}
        </span> : null}</span>
      </span>
    </button>
    <span className="anonymous-topic-metrics">
      {item.status === "closed" ? <em className="closed">{t("voice.closed")}</em> : <em>{t("voice.messageCount", { count: item.messageCount })}</em>}
      <button aria-label={item.favorited ? t("voice.unfavorite", { title: item.title }) : t("voice.favorite", { title: item.title })} className={item.favorited ? "active" : undefined} onClick={() => void onFavorite(item)} title={item.favorited ? phrase("取消喜欢", "Remove favorite") : phrase("喜欢话题", "Favorite topic")} type="button"><Heart aria-hidden="true" fill={item.favorited ? "currentColor" : "none"} size={15} /><span>{item.favoriteCount}</span></button>
    </span>
  </article>;
}

function topicHighlightLabel(message: NonNullable<AnonymousTopicSummary["topLikedMessage"]>, locale: "zh-CN" | "en-US") {
  return locale === "en-US" ? `#${message.sequence}: ${message.body}` : `#${message.sequence}：${message.body}`;
}

function AnonymousMessageRow({ isManager, message, onHide, onReact }: { isManager: boolean; message: AnonymousTopicMessage; onHide: (id: number, isHidden: boolean) => void; onReact: (id: number, value: "up" | "down") => void }) {
  const { locale, phrase } = useLanguage();
  const visibilityAction = message.isHidden ? phrase("恢复消息", "Show message") : phrase("隐藏消息", "Hide message");
  return <article className={`anonymous-message${message.isHidden ? " hidden" : ""}`}><header><span>#{message.sequence}</span><time>{formatTime(message.createdAt, locale)}</time>{isManager ? <button aria-label={visibilityAction} onClick={() => void onHide(message.id, !message.isHidden)} title={visibilityAction} type="button">{message.isHidden ? <EyeOff aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />}</button> : null}</header><p>{message.body}</p><footer><button aria-label={phrase("点赞", "Like")} onClick={() => void onReact(message.id, "up")} title={phrase("点赞", "Like")} type="button"><ThumbsUp aria-hidden="true" size={14} />{message.likeCount}</button><button aria-label={phrase("踩", "Dislike")} onClick={() => void onReact(message.id, "down")} title={phrase("踩", "Dislike")} type="button"><ThumbsDown aria-hidden="true" size={14} />{message.dislikeCount}</button></footer></article>;
}

function formatTime(value: string, locale: "zh-CN" | "en-US") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
