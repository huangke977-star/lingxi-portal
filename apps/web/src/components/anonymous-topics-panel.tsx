"use client";

import { Eye, EyeOff, KeyRound, LoaderCircle, Lock, MessageCircleMore, Plus, Search, Send, ThumbsDown, ThumbsUp, Unlock, UserRoundPen, X } from "lucide-react";
import { FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AppToast } from "@/components/app-toast";
import { getMe } from "@/lib/auth-api";
import { readAccessToken } from "@/lib/auth-storage";
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
  type AnonymousTopicDetail,
  type AnonymousTopicMessage,
  type AnonymousTopicSummary,
  updateAnonymousMessage,
  updateAnonymousTopic,
  updateAnonymousTopicAsCreator,
} from "@/lib/anonymous-topics-api";

export function AnonymousTopicsPanel({ management = false, pageSize = 5, title = "匿名话题", moreHref, showLoadMore = false, showSearch = false }: { management?: boolean; pageSize?: number; title?: string; moreHref?: string; showLoadMore?: boolean; showSearch?: boolean }) {
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

  const loadTopics = useCallback(async (pageNumber = 1, append = false) => {
    setIsLoading(true);
    try {
      const token = readAccessToken();
      const page = management && token
        ? await listAnonymousTopicsAdmin(token, pageNumber, pageSize, query)
        : await listAnonymousTopics(pageNumber, pageSize, query);
      setItems((current) => append ? [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))] : page.items);
      setPageInfo({ page: page.page, totalPages: page.totalPages });
      setError("");
    }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "无法读取匿名话题。"); }
    finally { setIsLoading(false); }
  }, [management, pageSize, query]);

  function loadMoreTopics() {
    if (isLoading || pageInfo.page >= pageInfo.totalPages) return;
    void loadTopics(pageInfo.page + 1, true);
  }

  const loadTopic = useCallback(async (id: number, beforeSequence?: number) => {
    const token = readAccessToken();
    const next = management && token
      ? await getAnonymousTopicAdmin(token, id, { limit: 40, beforeSequence })
      : await getAnonymousTopic(id, { limit: 40, beforeSequence });
    setTopic((current) => {
      if (!beforeSequence || current?.id !== id) return next;
      const known = new Set(current.messages.map((item) => item.id));
      return { ...next, messages: [...next.messages.filter((item) => !known.has(item.id)), ...current.messages] };
    });
  }, [management]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadTopics(), query ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [loadTopics, query]);
  useEffect(() => {
    const token = readAccessToken();
    if (!token) return;
    void getMe(token).then((user) => setIsManager(user.isSuperAdmin || user.role.level >= 90)).catch(() => setIsManager(false));
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
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "无法打开话题。"); }
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
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "发起话题失败。"); }
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
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "无法设置或恢复昵称。"); }
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
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "发送失败。"); }
    finally { setIsSaving(false); }
  }

  async function react(messageId: number, value: "up" | "down") {
    try {
      const next = await reactToAnonymousMessage(messageId, value);
      setTopic((current) => current ? { ...current, messages: current.messages.map((item) => item.id === next.id ? next : item) } : current);
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "操作失败。"); }
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
      if (!next) throw new Error("只有话题创建者或管理员可以操作话题状态。");
      setTopic({ ...topic, ...next });
      await loadTopics();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "更新话题失败。"); }
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
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "更新话题可见状态失败。"); }
    finally { setIsSaving(false); }
  }

  async function hideMessage(messageId: number, isHidden: boolean) {
    const token = readAccessToken();
    if (!token || !topic) return;
    setIsSaving(true);
    try { await updateAnonymousMessage(token, messageId, isHidden); await loadTopic(topic.id); }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : "更新消息可见状态失败。"); }
    finally { setIsSaving(false); }
  }

  return <section className="p8-surface anonymous-topics-panel">
    <div className="p8-section-heading"><div><MessageCircleMore aria-hidden="true" size={17} /><h2>{title}</h2></div>{moreHref || !management ? <span className="p8-heading-actions-compact">{moreHref ? <Link href={moreHref}>全部</Link> : null}{!management ? <button aria-label="发起话题" className="p8-heading-icon" onClick={() => setIsCreateOpen(true)} title="发起话题" type="button"><Plus aria-hidden="true" size={17} /></button> : null}</span> : null}</div>
    {showSearch || management ? <label className="p8-list-search"><Search aria-hidden="true" size={16} /><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索话题" value={query} /></label> : null}
    {isLoading && !items.length ? <p className="p8-empty"><LoaderCircle aria-hidden="true" className="spin" size={15} />正在读取话题</p> : items.length ? <><div className="anonymous-topic-list">{items.map((item) => <button className={item.isHidden ? "hidden" : undefined} key={item.id} onClick={() => void openTopic(item.id)} type="button"><span><strong>{item.title}</strong><small>{formatTime(item.updatedAt)}{item.isHidden ? " · 已隐藏" : ""}</small></span><em className={item.status === "closed" ? "closed" : ""}>{item.status === "closed" ? "已关闭" : `${item.messageCount} 条`}</em></button>)}</div>{showLoadMore && pageInfo.page < pageInfo.totalPages ? <button className="p8-load-more" disabled={isLoading} onClick={loadMoreTopics} type="button">{isLoading ? "正在加载" : "加载更多话题"}</button> : null}</> : <p className="p8-empty">暂时没有话题，发起一个让大家聊聊。</p>}
    {topic ? <TopicDialog identityCreate={identityCreate} identityOpen={isIdentityOpen} identityDraft={identityDraft} isManager={isManager} isSaving={isSaving} message={message} onClaim={claimIdentity} onClose={() => { setIdentityCreate(false); setIsIdentityOpen(false); setTopic(null); }} onCloseIdentity={() => { setIdentityCreate(false); setIsIdentityOpen(false); }} onHideMessage={hideMessage} onLoadMore={() => void loadTopic(topic.id, topic.messages[0]?.sequence)} onModerateTopic={moderateTopic} onOpenIdentity={() => { setIdentityDraft({ nickname: "", password: "" }); setIdentityCreate(false); setIsIdentityOpen(true); }} onReact={react} onSend={sendMessage} onToggleTopicHidden={toggleTopicHidden} setIdentityCreate={setIdentityCreate} setIdentityDraft={setIdentityDraft} setMessage={setMessage} topic={topic} /> : null}
    {isCreateOpen ? <ModalPortal><div className="modal-backdrop anonymous-topic-backdrop" role="presentation"><section aria-modal="true" className="anonymous-topic-modal topic-create-modal" role="dialog"><header><span><MessageCircleMore aria-hidden="true" size={18} /><strong>发起匿名话题</strong></span><button aria-label="关闭" onClick={() => setIsCreateOpen(false)} type="button"><X aria-hidden="true" size={17} /></button></header><form onSubmit={createTopic}><label><span>话题</span><input autoFocus maxLength={120} onChange={(event) => setTopicDraft({ ...topicDraft, title: event.target.value })} placeholder="一句话描述想吐槽的内容" required value={topicDraft.title} /></label><label><span>昵称</span><input maxLength={32} onChange={(event) => setTopicDraft({ ...topicDraft, nickname: event.target.value })} placeholder="创建话题必须填写昵称" required value={topicDraft.nickname} /></label><label><span>密码</span><input minLength={6} onChange={(event) => setTopicDraft({ ...topicDraft, password: event.target.value })} placeholder="用于其他设备恢复昵称" required type="password" value={topicDraft.password} /></label><footer><button disabled={isSaving} type="submit"><Plus aria-hidden="true" size={15} />{isSaving ? "创建中" : "创建并进入"}</button></footer></form></section></div></ModalPortal> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function TopicDialog({ identityCreate, identityOpen, identityDraft, isManager, isSaving, message, onClaim, onClose, onCloseIdentity, onHideMessage, onLoadMore, onModerateTopic, onOpenIdentity, onReact, onSend, onToggleTopicHidden, setIdentityCreate, setIdentityDraft, setMessage, topic }: { identityCreate: boolean; identityOpen: boolean; identityDraft: { nickname: string; password: string }; isManager: boolean; isSaving: boolean; message: string; onClaim: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; onCloseIdentity: () => void; onHideMessage: (id: number, isHidden: boolean) => void; onLoadMore: () => void; onModerateTopic: () => void; onOpenIdentity: () => void; onReact: (id: number, value: "up" | "down") => void; onSend: (event: FormEvent<HTMLFormElement>) => void; onToggleTopicHidden: () => void; setIdentityCreate: (value: boolean) => void; setIdentityDraft: (value: { nickname: string; password: string }) => void; setMessage: (value: string) => void; topic: AnonymousTopicDetail }) {
  const identity = readAnonymousIdentity(topic.id);
  const canModerate = isManager || Boolean(identity?.isCreator);
  return <ModalPortal><div className="modal-backdrop anonymous-topic-backdrop" role="presentation"><section aria-modal="true" className="anonymous-topic-modal topic-chat-modal" role="dialog"><header><span className="anonymous-topic-title"><MessageCircleMore aria-hidden="true" size={18} /><strong>{topic.title}</strong><small>{identity ? `昵称：${identity.nickname}${identity.isCreator ? "（创建者）" : ""} · ` : ""}{topic.isHidden ? "话题已隐藏" : topic.status === "closed" ? "话题已关闭" : `${topic.messageCount} 条消息`}</small></span><div><button aria-label="获取昵称" onClick={onOpenIdentity} title="获取或创建昵称" type="button"><UserRoundPen aria-hidden="true" size={16} /></button>{isManager ? <button aria-label={topic.isHidden ? "取消隐藏话题" : "隐藏话题"} disabled={isSaving} onClick={() => void onToggleTopicHidden()} title={topic.isHidden ? "取消隐藏话题" : "隐藏话题"} type="button">{topic.isHidden ? <Eye aria-hidden="true" size={16} /> : <EyeOff aria-hidden="true" size={16} />}</button> : null}{canModerate ? <button aria-label={topic.status === "active" ? "关闭话题" : "重新开放话题"} disabled={isSaving} onClick={() => void onModerateTopic()} title={topic.status === "active" ? "关闭话题" : "重新开放话题"} type="button">{topic.status === "active" ? <Unlock aria-hidden="true" size={16} /> : <Lock aria-hidden="true" size={16} />}</button> : null}<button aria-label="关闭" onClick={onClose} type="button"><X aria-hidden="true" size={17} /></button></div></header><main className="anonymous-topic-chat">{identity ? <span className="anonymous-identity-note"><KeyRound aria-hidden="true" size={14} />当前昵称：{identity.nickname}</span> : <button className="anonymous-identity-note" onClick={onOpenIdentity} type="button"><KeyRound aria-hidden="true" size={14} />匿名发言，获取昵称后可在其他设备恢复</button>}{topic.hasMore ? <button className="anonymous-load-more" onClick={onLoadMore} type="button">加载更早消息</button> : null}<div className="anonymous-message-list">{topic.messages.map((item) => <AnonymousMessageRow isManager={isManager} key={item.id} message={item} onHide={onHideMessage} onReact={onReact} />)}</div></main><form className="anonymous-message-composer" onSubmit={onSend}><textarea disabled={topic.status === "closed" || topic.isHidden || isSaving} maxLength={2000} onChange={(event) => setMessage(event.target.value)} placeholder={topic.isHidden ? "话题已隐藏" : topic.status === "closed" ? "话题已关闭" : "说点什么"} rows={2} value={message} /><button aria-label="发送" disabled={topic.status === "closed" || topic.isHidden || isSaving || !message.trim()} title="发送" type="submit"><Send aria-hidden="true" size={17} /></button></form>{identityOpen ? <div className="anonymous-identity-sheet"><form onSubmit={onClaim}><header><span><KeyRound aria-hidden="true" size={17} /><strong>{identityCreate ? "创建昵称" : "获取昵称"}</strong></span><button aria-label="关闭昵称窗口" onClick={onCloseIdentity} type="button"><X aria-hidden="true" size={16} /></button></header><p>{identityCreate ? "昵称和密码在当前话题内一一绑定，创建后不能修改。" : "输入已绑定的密码，即可获取这个话题中的昵称。"}</p><label className="anonymous-identity-create"><input checked={identityCreate} onChange={(event) => setIdentityCreate(event.target.checked)} type="checkbox" /><span>创建昵称</span></label>{identityCreate ? <label><span>昵称</span><input autoFocus maxLength={32} onChange={(event) => setIdentityDraft({ ...identityDraft, nickname: event.target.value })} required value={identityDraft.nickname} /></label> : null}<label><span>密码</span><input autoFocus={!identityCreate} minLength={6} onChange={(event) => setIdentityDraft({ ...identityDraft, password: event.target.value })} required type="password" value={identityDraft.password} /></label><footer><button disabled={isSaving} type="submit">{identityCreate ? "创建并使用" : "获取昵称"}</button></footer></form></div> : null}</section></div></ModalPortal>;
}

function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function AnonymousMessageRow({ isManager, message, onHide, onReact }: { isManager: boolean; message: AnonymousTopicMessage; onHide: (id: number, isHidden: boolean) => void; onReact: (id: number, value: "up" | "down") => void }) {
  return <article className={`anonymous-message${message.isHidden ? " hidden" : ""}`}><header><span>{message.nickname ? `#${message.sequence} · ${message.nickname}` : `第 ${message.sequence} 条`}</span><time>{formatTime(message.createdAt)}</time>{isManager ? <button aria-label={message.isHidden ? "恢复消息" : "隐藏消息"} onClick={() => void onHide(message.id, !message.isHidden)} title={message.isHidden ? "恢复消息" : "隐藏消息"} type="button">{message.isHidden ? <Eye aria-hidden="true" size={14} /> : <EyeOff aria-hidden="true" size={14} />}</button> : null}</header><p>{message.body}</p><footer><button onClick={() => void onReact(message.id, "up")} type="button"><ThumbsUp aria-hidden="true" size={14} />{message.likeCount}</button><button onClick={() => void onReact(message.id, "down")} type="button"><ThumbsDown aria-hidden="true" size={14} />{message.dislikeCount}</button></footer></article>;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
