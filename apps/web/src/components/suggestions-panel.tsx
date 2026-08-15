"use client";

import { Lightbulb, LoaderCircle, MessageCircleMore, Plus, Search, Send, X } from "lucide-react";
import { FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { readAccessToken } from "@/lib/auth-storage";
import {
  createSuggestion,
  getSuggestion,
  listMySuggestions,
  listPublicSuggestions,
  listSuggestionInbox,
  replyToSuggestion,
  SUGGESTION_STATUSES,
  type SuggestionDetail,
  type SuggestionStatus,
  type SuggestionSummary,
  updateSuggestionStatus,
} from "@/lib/suggestions-api";

type SuggestionsPanelMode = "public" | "mine" | "inbox";

const STATUS_LABEL: Record<SuggestionStatus, string> = {
  pending: "待评估",
  scheduled: "已排期",
  in_progress: "进行中",
  completed: "已完成",
  rejected: "已驳回",
};

export function SuggestionsPanel({ className = "", mode = "public", pageSize = 5, title = "建议", moreHref, showLoadMore = false, showSearch = false }: { className?: string; mode?: SuggestionsPanelMode; pageSize?: number; title?: string; moreHref?: string; showLoadMore?: boolean; showSearch?: boolean }) {
  const [items, setItems] = useState<SuggestionSummary[]>([]);
  const [pageInfo, setPageInfo] = useState({ page: 1, totalPages: 1 });
  const [detail, setDetail] = useState<SuggestionDetail | null>(null);
  const [error, setError] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [reply, setReply] = useState("");
  const [draft, setDraft] = useState({ title: "", content: "" });
  const [query, setQuery] = useState("");

  const load = useCallback(async (pageNumber = 1, append = false) => {
    setIsLoading(true);
    try {
      const token = readAccessToken();
      if (mode !== "public" && !token) {
        setItems([]);
        setPageInfo({ page: 1, totalPages: 1 });
        setError("");
        return;
      }
      const page = mode === "public"
        ? await listPublicSuggestions(pageNumber, pageSize, query)
        : mode === "mine"
          ? await listMySuggestions(token!, pageNumber, pageSize, query)
          : await listSuggestionInbox(token!, pageNumber, pageSize, query);
      setItems((current) => append ? [...current, ...page.items.filter((item) => !current.some((known) => known.id === item.id))] : page.items);
      setPageInfo({ page: page.page ?? pageNumber, totalPages: page.totalPages ?? 1 });
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "无法读取建议。");
    } finally { setIsLoading(false); }
  }, [mode, pageSize, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), query ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  function loadMore() {
    if (isLoading || pageInfo.page >= pageInfo.totalPages) return;
    void load(pageInfo.page + 1, true);
  }

  async function openDetail(id: number) {
    try {
      setDetail(await getSuggestion(id));
      setReply("");
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "无法读取建议详情。"); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token) { setError("登录后才能提交建议。"); return; }
    setIsSaving(true);
    try {
      const created = await createSuggestion(token, draft);
      setDraft({ title: "", content: "" });
      setIsCreateOpen(false);
      setDetail(created);
      await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "提交建议失败。"); }
    finally { setIsSaving(false); }
  }

  async function changeStatus(status: SuggestionStatus) {
    const token = readAccessToken();
    if (!token || !detail) return;
    setIsSaving(true);
    try {
      setDetail(await updateSuggestionStatus(token, detail.id, status));
      await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "更新建议进度失败。"); }
    finally { setIsSaving(false); }
  }

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !detail || !reply.trim()) return;
    setIsSaving(true);
    try {
      setDetail(await replyToSuggestion(token, detail.id, reply));
      setReply("");
      await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "回复建议失败。"); }
    finally { setIsSaving(false); }
  }

  return <section className={`p8-surface suggestions-panel${className ? ` ${className}` : ""}`}>
    <div className="p8-section-heading">
      <div><Lightbulb aria-hidden="true" size={17} /><h2>{title}</h2></div>
      {mode === "public" ? <span className="p8-heading-actions-compact">{moreHref ? <Link href={moreHref}>全部</Link> : null}<button aria-label="提交建议" className="p8-heading-icon" onClick={() => setIsCreateOpen(true)} title="提交建议" type="button"><Plus aria-hidden="true" size={17} /></button></span> : <small>{mode === "inbox" ? "全站用户建议" : "仅自己可见"}</small>}
    </div>
    {showSearch ? <label className="p8-list-search"><Search aria-hidden="true" size={16} /><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索建议标题或内容" value={query} /></label> : null}
    {isLoading && !items.length ? <p className="p8-empty"><LoaderCircle aria-hidden="true" className="spin" size={15} />正在读取建议</p> : items.length ? <><div className="suggestion-list">{items.map((item) => <button className="suggestion-list-item" key={item.id} onClick={() => void openDetail(item.id)} type="button"><span><strong>{item.title}</strong><small>{formatTime(item.updatedAt)}</small></span><em className={`suggestion-status ${item.status}`}>{STATUS_LABEL[item.status]}</em></button>)}</div>{showLoadMore && pageInfo.page < pageInfo.totalPages ? <button className="p8-load-more" disabled={isLoading} onClick={loadMore} type="button">{isLoading ? "正在加载" : "加载更多建议"}</button> : null}</> : <p className="p8-empty">{mode === "mine" ? "暂未提交建议。" : mode === "inbox" ? "暂未收到建议。" : "还没有建议，欢迎提出第一条。"}</p>}
    {detail ? <SuggestionDetailDialog detail={detail} isSaving={isSaving} mode={mode} onChangeStatus={changeStatus} onClose={() => setDetail(null)} onReply={submitReply} reply={reply} setReply={setReply} /> : null}
    {isCreateOpen ? <ModalPortal><div className="modal-backdrop suggestion-modal-backdrop" role="presentation"><section aria-modal="true" className="suggestion-modal" role="dialog"><header><span><Lightbulb aria-hidden="true" size={18} /><strong>提交建议</strong></span><button aria-label="关闭" onClick={() => setIsCreateOpen(false)} type="button"><X aria-hidden="true" size={17} /></button></header><form onSubmit={submit}><label><span>标题</span><input autoFocus maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="一句话说明你的建议" required value={draft.title} /></label><label><span>具体内容</span><textarea maxLength={4000} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="建议内容会对站内用户公开，管理员会在这里回复和更新进度。" required rows={7} value={draft.content} /></label><footer><button disabled={isSaving} type="submit"><Send aria-hidden="true" size={15} />{isSaving ? "提交中" : "提交"}</button></footer></form></section></div></ModalPortal> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function SuggestionDetailDialog({ detail, isSaving, mode, onChangeStatus, onClose, onReply, reply, setReply }: { detail: SuggestionDetail; isSaving: boolean; mode: SuggestionsPanelMode; onChangeStatus: (status: SuggestionStatus) => void; onClose: () => void; onReply: (event: FormEvent<HTMLFormElement>) => void; reply: string; setReply: (value: string) => void }) {
  return <ModalPortal><div className="modal-backdrop suggestion-modal-backdrop" role="presentation"><section aria-modal="true" className="suggestion-modal suggestion-detail-modal" role="dialog"><header><span><Lightbulb aria-hidden="true" size={18} /><strong>建议详情</strong></span><button aria-label="关闭" onClick={onClose} type="button"><X aria-hidden="true" size={17} /></button></header><main><div className="suggestion-detail-heading"><span><h2>{detail.title}</h2><small>{detail.user.nickname} · {formatTime(detail.createdAt)}</small></span>{mode === "inbox" ? <label className="suggestion-status-select"><span>进度</span><GlassSelect ariaLabel="建议进度" disabled={isSaving} onChange={onChangeStatus} options={SUGGESTION_STATUSES.map((status) => ({ label: STATUS_LABEL[status], value: status }))} value={detail.status} /></label> : <em className={`suggestion-status ${detail.status}`}>{STATUS_LABEL[detail.status]}</em>}</div><p className="suggestion-content">{detail.content}</p><div className="suggestion-replies"><span><MessageCircleMore aria-hidden="true" size={15} />回复 {detail.replies.length}</span>{detail.replies.length ? detail.replies.map((item) => <article key={item.id}><strong>{item.author.nickname}</strong><time>{formatTime(item.createdAt)}</time><p>{item.content}</p></article>) : <p>暂未回复。</p>}</div>{mode === "inbox" ? <form className="suggestion-reply-form" onSubmit={onReply}><div><textarea maxLength={2000} onChange={(event) => setReply(event.target.value)} placeholder="回复后会通知建议提交者" rows={3} value={reply} /><button aria-label="发送回复" disabled={isSaving || !reply.trim()} title="发送回复" type="submit"><Send aria-hidden="true" size={16} /></button></div></form> : null}</main></section></div></ModalPortal>;
}

function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
