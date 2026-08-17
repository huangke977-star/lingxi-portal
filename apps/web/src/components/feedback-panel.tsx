"use client";

import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, LifeBuoy, Plus, Send, X } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { isAuthExpiredError } from "@/lib/auth-api";
import { createFeedback, getFeedback, listFeedbackInbox, listMyFeedback, replyFeedback, updateFeedbackStatus, type FeedbackCategory, type FeedbackDetail, type FeedbackStatus, type FeedbackSummary } from "@/lib/feedback-api";

const STATUS_LABEL: Record<FeedbackStatus, string> = { pending: "待处理", in_progress: "处理中", resolved: "已解决", closed: "已关闭" };
const CATEGORY_LABEL: Record<FeedbackCategory, string> = { bug: "功能异常", account: "账号问题", content: "内容问题", payment: "积分与资源", other: "其他" };
const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ label, value: value as FeedbackStatus }));
const INBOX_STATUS_OPTIONS = [{ label: "全部", value: "all" as const }, ...STATUS_OPTIONS];
const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ label, value: value as FeedbackCategory }));

export function FeedbackPanel({ mode = "mine" }: { mode?: "mine" | "inbox" }) {
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<FeedbackSummary[]>([]);
  const [detail, setDetail] = useState<FeedbackDetail | null>(null);
  const [draft, setDraft] = useState({ category: "bug" as FeedbackCategory, title: "", content: "" });
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState<FeedbackStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load(nextPage = page, q = search) {
    const accessToken = token ?? readAccessToken();
    if (!accessToken) return;
    try {
      const result = mode === "inbox" ? await listFeedbackInbox(accessToken, nextPage, 12, q, status === "all" ? undefined : status) : await listMyFeedback(accessToken, nextPage, 12, q);
      setToken(accessToken); setItems(result.items); setPage(result.page); setTotalPages(result.totalPages);
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) { clearAuthTokens(); window.location.href = "/login"; return; }
      setError(loadError instanceof Error ? loadError.message : "无法读取反馈。");
    } finally { setIsLoading(false); }
  }

  // The list is an external query keyed by the visible mode and status filter.
  useEffect(() => {
    // Loading is asynchronous; the state updates only occur after the request settles.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(1, "");
  }, [mode, status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openDetail(id: number) {
    const accessToken = token ?? readAccessToken(); if (!accessToken) return;
    try { setDetail(await getFeedback(accessToken, id)); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "无法读取反馈详情。"); }
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault(); const accessToken = token ?? readAccessToken(); if (!accessToken) return;
    setIsSaving(true); setError("");
    try { await createFeedback(accessToken, draft); setDraft({ category: "bug", title: "", content: "" }); setIsCreateOpen(false); setNotice("反馈已提交。"); await load(1); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "反馈提交失败。"); } finally { setIsSaving(false); }
  }

  async function sendReply() {
    const accessToken = token ?? readAccessToken(); if (!accessToken || !detail || !reply.trim()) return;
    setIsSaving(true);
    try { setDetail(await replyFeedback(accessToken, detail.id, reply)); setReply(""); setNotice("回复已发送。"); } catch (replyError) { setError(replyError instanceof Error ? replyError.message : "回复失败。"); } finally { setIsSaving(false); }
  }

  async function changeStatus(nextStatus: FeedbackStatus) {
    const accessToken = token ?? readAccessToken(); if (!accessToken || !detail) return;
    setIsSaving(true);
    try { setDetail(await updateFeedbackStatus(accessToken, detail.id, nextStatus)); setStatus(nextStatus); setNotice("反馈状态已更新。"); await load(page); } catch (statusError) { setError(statusError instanceof Error ? statusError.message : "状态更新失败。"); } finally { setIsSaving(false); }
  }

  return (
    <section className="p8-surface feedback-panel">
    <header className="feedback-panel-heading"><div><span className="section-label"><LifeBuoy aria-hidden="true" size={14} /> PRIVATE FEEDBACK</span><h1>{mode === "inbox" ? "用户反馈" : "我的反馈"}</h1><p>{mode === "inbox" ? "处理用户提交的问题和使用反馈。" : "反馈只对你和管理员可见。"}</p></div>{mode === "mine" ? <button className="icon-action" aria-label="提交反馈" onClick={() => setIsCreateOpen(true)} title="提交反馈" type="button"><Plus aria-hidden="true" size={17} /></button> : null}</header>
      <div className="feedback-toolbar">
        <input
          aria-label="搜索反馈"
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void load(1, search); }}
          placeholder="搜索标题或内容"
          value={search}
        />
        {mode === "inbox" ? <GlassSelect ariaLabel="反馈状态" onChange={setStatus} options={INBOX_STATUS_OPTIONS} value={status} /> : null}
      </div>
    {isLoading ? (
      <p className="p8-empty">正在读取反馈。</p>
    ) : items.length ? (
      <div className="feedback-list">
        {items.map((item) => (
          <button className="feedback-list-item" key={item.id} onClick={() => void openDetail(item.id)} type="button">
            <span>
              <strong>{item.title}</strong>
              <small>{CATEGORY_LABEL[item.category]} · {new Date(item.updatedAt).toLocaleString("zh-CN")}</small>
            </span>
            <em className={`feedback-status ${item.status}`}>{STATUS_LABEL[item.status]}</em>
          </button>
        ))}
      </div>
    ) : (
      <p className="p8-empty">暂无反馈记录。</p>
    )}
    {totalPages > 1 ? <footer className="feedback-pagination"><button aria-label="上一页" disabled={page <= 1} onClick={() => void load(page - 1)} type="button"><ChevronLeft size={16} /></button><span>{page} / {totalPages}</span><button aria-label="下一页" disabled={page >= totalPages} onClick={() => void load(page + 1)} type="button"><ChevronRight size={16} /></button></footer> : null}
    {isCreateOpen ? <FeedbackModalPortal><div className="modal-backdrop feedback-modal-backdrop" role="presentation"><form aria-modal="true" className="feedback-modal feedback-create-modal" onSubmit={submitCreate} role="dialog"><header><strong>提交反馈</strong><button aria-label="关闭" onClick={() => setIsCreateOpen(false)} type="button"><X size={17} /></button></header><label>分类<GlassSelect ariaLabel="反馈分类" onChange={(category) => setDraft({ ...draft, category })} options={CATEGORY_OPTIONS} value={draft.category} /></label><label>标题<input maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required value={draft.title} /></label><label>具体内容<textarea maxLength={5000} onChange={(event) => setDraft({ ...draft, content: event.target.value })} required rows={8} value={draft.content} /></label><footer><button className="button" disabled={isSaving} type="submit"><Send size={15} />{isSaving ? "提交中" : "提交"}</button></footer></form></div></FeedbackModalPortal> : null}
    {detail ? <FeedbackModalPortal><div className="modal-backdrop feedback-modal-backdrop" role="presentation"><section aria-modal="true" className="feedback-modal feedback-detail-modal" role="dialog"><header><div><strong>{detail.title}</strong><small>{CATEGORY_LABEL[detail.category]} · {STATUS_LABEL[detail.status]}</small></div><button aria-label="关闭" onClick={() => setDetail(null)} type="button"><X size={17} /></button></header><p className="feedback-detail-content">{detail.content}</p><div className="feedback-replies">{detail.replies.map((item) => <article key={item.id}><strong>{item.author.nickname}</strong><small>{new Date(item.createdAt).toLocaleString("zh-CN")}</small><p>{item.content}</p></article>)}</div>{mode === "inbox" ? <label>处理状态<GlassSelect ariaLabel="处理状态" onChange={(nextStatus) => void changeStatus(nextStatus)} options={STATUS_OPTIONS} value={detail.status} /></label> : null}<div className="feedback-reply-box"><textarea aria-label="反馈回复" onChange={(event) => setReply(event.target.value)} placeholder={mode === "inbox" ? "回复用户" : "补充说明"} rows={3} value={reply} /><button aria-label="发送回复" disabled={isSaving || !reply.trim()} onClick={() => void sendReply()} title="发送回复" type="button"><Check size={16} /></button></div></section></div></FeedbackModalPortal> : null}
    <AppToast duration={3200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function FeedbackModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
