"use client";

import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Plus, Send, X } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { AdminPageHeader } from "@/components/admin-page-header";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { isAuthExpiredError } from "@/lib/auth-api";
import { localizedPath } from "@/lib/i18n";
import { createFeedback, getFeedback, listFeedbackInbox, listMyFeedback, replyFeedback, updateFeedbackStatus, type FeedbackCategory, type FeedbackDetail, type FeedbackStatus, type FeedbackSummary } from "@/lib/feedback-api";

export function FeedbackPanel({ mode = "mine" }: { mode?: "mine" | "inbox" }) {
  const { locale, phrase, t } = useLanguage();
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
  const statusLabel = (value: FeedbackStatus) => value === "pending" ? phrase("待处理", "Pending") : value === "in_progress" ? phrase("处理中", "In progress") : value === "resolved" ? phrase("已解决", "Resolved") : phrase("已关闭", "Closed");
  const categoryLabel = (value: FeedbackCategory) => value === "bug" ? phrase("功能异常", "Feature issue") : value === "account" ? phrase("账号问题", "Account issue") : value === "content" ? phrase("内容问题", "Content issue") : value === "payment" ? phrase("积分与资源", "Points and resources") : phrase("其他", "Other");
  const STATUS_LABEL: Record<FeedbackStatus, string> = { pending: statusLabel("pending"), in_progress: statusLabel("in_progress"), resolved: statusLabel("resolved"), closed: statusLabel("closed") };
  const CATEGORY_LABEL: Record<FeedbackCategory, string> = { bug: categoryLabel("bug"), account: categoryLabel("account"), content: categoryLabel("content"), payment: categoryLabel("payment"), other: categoryLabel("other") };
  const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ label, value: value as FeedbackStatus }));
  const INBOX_STATUS_OPTIONS = [{ label: t("common.all"), value: "all" as const }, ...STATUS_OPTIONS];
  const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ label, value: value as FeedbackCategory }));

  async function load(nextPage = page, q = search) {
    const accessToken = token ?? readAccessToken();
    if (!accessToken) return;
    try {
      const result = mode === "inbox" ? await listFeedbackInbox(accessToken, nextPage, 12, q, status === "all" ? undefined : status) : await listMyFeedback(accessToken, nextPage, 12, q);
      setToken(accessToken); setItems(result.items); setPage(result.page); setTotalPages(result.totalPages);
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) { clearAuthTokens(); window.location.href = localizedPath("/login", locale); return; }
      setError(loadError instanceof Error ? loadError.message : phrase("无法读取反馈。", "Could not load feedback."));
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
    try { setDetail(await getFeedback(accessToken, id)); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : phrase("无法读取反馈详情。", "Could not load feedback details.")); }
  }

  async function submitCreate(event: React.FormEvent) {
    event.preventDefault(); const accessToken = token ?? readAccessToken(); if (!accessToken) return;
    setIsSaving(true); setError("");
    try { await createFeedback(accessToken, draft); setDraft({ category: "bug", title: "", content: "" }); setIsCreateOpen(false); setNotice(phrase("反馈已提交。", "Feedback submitted.")); await load(1); } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("反馈提交失败。", "Could not submit feedback.")); } finally { setIsSaving(false); }
  }

  async function sendReply() {
    const accessToken = token ?? readAccessToken(); if (!accessToken || !detail || !reply.trim()) return;
    setIsSaving(true);
    try { setDetail(await replyFeedback(accessToken, detail.id, reply)); setReply(""); setNotice(phrase("回复已发送。", "Reply sent.")); } catch (replyError) { setError(replyError instanceof Error ? replyError.message : phrase("回复失败。", "Could not send reply.")); } finally { setIsSaving(false); }
  }

  async function changeStatus(nextStatus: FeedbackStatus) {
    const accessToken = token ?? readAccessToken(); if (!accessToken || !detail) return;
    setIsSaving(true);
    try { setDetail(await updateFeedbackStatus(accessToken, detail.id, nextStatus)); setStatus(nextStatus); setNotice(phrase("反馈状态已更新。", "Feedback status updated.")); await load(page); } catch (statusError) { setError(statusError instanceof Error ? statusError.message : phrase("状态更新失败。", "Could not update status.")); } finally { setIsSaving(false); }
  }

  return (
    <section className="p8-surface feedback-panel">
    <AdminPageHeader className="feedback-panel-heading" description={mode === "inbox" ? phrase("处理用户提交的问题和使用反馈。", "Review issues and feedback submitted by users.") : phrase("反馈只对你和管理员可见。", "Feedback is visible only to you and administrators.")} title={mode === "inbox" ? phrase("用户反馈", "User feedback") : phrase("我的反馈", "My feedback")} actions={mode === "mine" ? <button aria-label={phrase("提交反馈", "Submit feedback")} className="admin-header-icon-action" onClick={() => setIsCreateOpen(true)} title={phrase("提交反馈", "Submit feedback")} type="button"><Plus aria-hidden="true" size={16} /></button> : undefined} />
      <div className="feedback-toolbar">
        <input
          aria-label={phrase("搜索反馈", "Search feedback")}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void load(1, search); }}
          placeholder={phrase("搜索标题或内容", "Search titles or content")}
          value={search}
        />
        {mode === "inbox" ? <GlassSelect ariaLabel={phrase("反馈状态", "Feedback status")} onChange={setStatus} options={INBOX_STATUS_OPTIONS} value={status} /> : null}
      </div>
    {isLoading ? (
      <p className="p8-empty">{phrase("正在读取反馈。", "Loading feedback.")}</p>
    ) : items.length ? (
      <div className="feedback-list">
        {items.map((item) => (
          <button className="feedback-list-item" key={item.id} onClick={() => void openDetail(item.id)} type="button">
            <span>
              <strong>{item.title}</strong>
              <small>{categoryLabel(item.category)} · {new Date(item.updatedAt).toLocaleString(locale)}</small>
            </span>
            <em className={`feedback-status ${item.status}`}>{statusLabel(item.status)}</em>
          </button>
        ))}
      </div>
    ) : (
      <p className="p8-empty">{phrase("暂无反馈记录。", "No feedback records.")}</p>
    )}
    {totalPages > 1 ? <footer className="feedback-pagination"><button aria-label={phrase("上一页", "Previous page")} disabled={page <= 1} onClick={() => void load(page - 1)} title={phrase("上一页", "Previous page")} type="button"><ChevronLeft size={16} /></button><span>{page} / {totalPages}</span><button aria-label={phrase("下一页", "Next page")} disabled={page >= totalPages} onClick={() => void load(page + 1)} title={phrase("下一页", "Next page")} type="button"><ChevronRight size={16} /></button></footer> : null}
    {isCreateOpen ? <FeedbackModalPortal><div className="modal-backdrop feedback-modal-backdrop" role="presentation"><form aria-modal="true" className="feedback-modal feedback-create-modal" onSubmit={submitCreate} role="dialog"><header><strong>{phrase("提交反馈", "Submit feedback")}</strong><button aria-label={t("common.close")} onClick={() => setIsCreateOpen(false)} title={t("common.close")} type="button"><X size={17} /></button></header><label>{phrase("分类", "Category")}<GlassSelect ariaLabel={phrase("反馈分类", "Feedback category")} onChange={(category) => setDraft({ ...draft, category })} options={CATEGORY_OPTIONS} value={draft.category} /></label><label>{phrase("标题", "Title")}<input maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={phrase("简要说明问题或建议", "Briefly describe the issue or suggestion")} required value={draft.title} /></label><label>{phrase("具体内容", "Details")}<textarea maxLength={5000} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder={phrase("请尽量提供复现步骤或期望结果", "Include reproduction steps or expected results when possible")} required rows={8} value={draft.content} /></label><footer><button className="button" disabled={isSaving} type="submit"><Send size={15} />{isSaving ? phrase("提交中", "Submitting") : phrase("提交", "Submit")}</button></footer></form></div></FeedbackModalPortal> : null}
    {detail ? <FeedbackModalPortal><div className="modal-backdrop feedback-modal-backdrop" role="presentation"><section aria-modal="true" className="feedback-modal feedback-detail-modal" role="dialog"><header><div><strong>{detail.title}</strong><small>{CATEGORY_LABEL[detail.category]} · {STATUS_LABEL[detail.status]}</small></div><button aria-label={t("common.close")} onClick={() => setDetail(null)} title={t("common.close")} type="button"><X size={17} /></button></header><p className="feedback-detail-content">{detail.content}</p><div className="feedback-replies">{detail.replies.map((item) => <article key={item.id}><strong>{item.author.nickname}</strong><small>{new Date(item.createdAt).toLocaleString(locale)}</small><p>{item.content}</p></article>)}</div>{mode === "inbox" ? <label>{phrase("处理状态", "Status")}<GlassSelect ariaLabel={phrase("处理状态", "Status")} onChange={(nextStatus) => void changeStatus(nextStatus)} options={STATUS_OPTIONS} value={detail.status} /></label> : null}<div className="feedback-reply-box"><textarea aria-label={phrase("反馈回复", "Feedback reply")} onChange={(event) => setReply(event.target.value)} placeholder={mode === "inbox" ? phrase("回复用户", "Reply to user") : phrase("补充说明", "Add details")} rows={3} value={reply} /><button aria-label={phrase("发送回复", "Send reply")} disabled={isSaving || !reply.trim()} onClick={() => void sendReply()} title={phrase("发送回复", "Send reply")} type="button"><Check size={16} /></button></div></section></div></FeedbackModalPortal> : null}
    <AppToast duration={3200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function FeedbackModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
