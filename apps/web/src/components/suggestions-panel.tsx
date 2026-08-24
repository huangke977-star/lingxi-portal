"use client";

import { Lightbulb, LoaderCircle, MessageCircleMore, Plus, Search, Send, X } from "lucide-react";
import { FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { localizedPath, type TranslationKey } from "@/lib/i18n";
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

const STATUS_KEYS: Record<SuggestionStatus, TranslationKey> = {
  pending: "suggestion.status.pending",
  scheduled: "suggestion.status.scheduled",
  in_progress: "suggestion.status.inProgress",
  completed: "suggestion.status.completed",
  rejected: "suggestion.status.rejected",
};

export function SuggestionsPanel({ className = "", mode = "public", pageSize = 5, title, moreHref, showLoadMore = false, showSearch = false }: { className?: string; mode?: SuggestionsPanelMode; pageSize?: number; title?: string; moreHref?: string; showLoadMore?: boolean; showSearch?: boolean }) {
  const { locale, phrase, t } = useLanguage();
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
      setError(loadError instanceof Error ? loadError.message : t("suggestion.loading"));
    } finally { setIsLoading(false); }
  }, [mode, pageSize, query, t]);

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
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : phrase("无法读取建议详情。", "Could not load suggestion details.")); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token) { setError(phrase("登录后才能提交建议。", "Sign in to submit a suggestion.")); return; }
    setIsSaving(true);
    try {
      const created = await createSuggestion(token, draft);
      setDraft({ title: "", content: "" });
      setIsCreateOpen(false);
      setDetail(created);
      await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("提交建议失败。", "Could not submit the suggestion.")); }
    finally { setIsSaving(false); }
  }

  async function changeStatus(status: SuggestionStatus) {
    const token = readAccessToken();
    if (!token || !detail) return;
    setIsSaving(true);
    try {
      setDetail(await updateSuggestionStatus(token, detail.id, status));
      await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("更新建议进度失败。", "Could not update the suggestion progress.")); }
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
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : phrase("回复建议失败。", "Could not reply to the suggestion.")); }
    finally { setIsSaving(false); }
  }

  const statusLabel = (status: SuggestionStatus) => t(STATUS_KEYS[status]);

  return <section className={`p8-surface suggestions-panel${className ? ` ${className}` : ""}`}>
    <div className="p8-section-heading">
      <div><Lightbulb aria-hidden="true" size={17} /><h2>{title ?? t("suggestion.title")}</h2></div>
      {mode === "public" ? <span className="p8-heading-actions-compact">{moreHref ? <Link href={localizedPath(moreHref, locale)}>{t("suggestion.all")}</Link> : null}<button aria-label={t("suggestion.submit")} className="p8-heading-icon" onClick={() => setIsCreateOpen(true)} title={t("suggestion.submit")} type="button"><Plus aria-hidden="true" size={17} /></button></span> : <small>{mode === "inbox" ? t("suggestion.public") : t("suggestion.private")}</small>}
    </div>
    {showSearch ? <label className="p8-list-search"><Search aria-hidden="true" size={16} /><input onChange={(event) => setQuery(event.target.value)} placeholder={t("suggestion.search")} value={query} /></label> : null}
    {isLoading && !items.length ? <p className="p8-empty"><LoaderCircle aria-hidden="true" className="spin" size={15} />{t("suggestion.loading")}</p> : items.length ? <><div className="suggestion-list">{items.map((item) => <button className="suggestion-list-item" key={item.id} onClick={() => void openDetail(item.id)} type="button"><span><strong>{item.title}</strong><small>{formatTime(item.updatedAt, locale)}</small></span><em className={`suggestion-status ${item.status}`}>{statusLabel(item.status)}</em></button>)}</div>{showLoadMore && pageInfo.page < pageInfo.totalPages ? <button className="p8-load-more" disabled={isLoading} onClick={loadMore} type="button">{isLoading ? t("common.loading") : t("suggestion.loadMore")}</button> : null}</> : <p className="p8-empty">{mode === "mine" ? t("suggestion.noneMine") : mode === "inbox" ? t("suggestion.noneInbox") : t("suggestion.none")}</p>}
    {detail ? <SuggestionDetailDialog detail={detail} isSaving={isSaving} mode={mode} onChangeStatus={changeStatus} onClose={() => setDetail(null)} onReply={submitReply} reply={reply} setReply={setReply} /> : null}
    {isCreateOpen ? <ModalPortal><div className="modal-backdrop suggestion-modal-backdrop" role="presentation"><section aria-modal="true" className="suggestion-modal" role="dialog"><header><span><Lightbulb aria-hidden="true" size={18} /><strong>{t("suggestion.submit")}</strong></span><button aria-label={t("common.close")} onClick={() => setIsCreateOpen(false)} title={t("common.close")} type="button"><X aria-hidden="true" size={17} /></button></header><form onSubmit={submit}><label><span>{phrase("标题", "Title")}</span><input autoFocus maxLength={120} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={phrase("一句话说明你的建议", "Summarize your suggestion in one sentence")} required value={draft.title} /></label><label><span>{phrase("具体内容", "Details")}</span><textarea maxLength={4000} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder={phrase("建议内容会对站内用户公开，管理员会在这里回复和更新进度。", "Suggestions are public. Administrators can reply and update the progress here.")} required rows={7} value={draft.content} /></label><footer><button disabled={isSaving} type="submit"><Send aria-hidden="true" size={15} />{isSaving ? phrase("提交中", "Submitting") : t("common.send")}</button></footer></form></section></div></ModalPortal> : null}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function SuggestionDetailDialog({ detail, isSaving, mode, onChangeStatus, onClose, onReply, reply, setReply }: { detail: SuggestionDetail; isSaving: boolean; mode: SuggestionsPanelMode; onChangeStatus: (status: SuggestionStatus) => void; onClose: () => void; onReply: (event: FormEvent<HTMLFormElement>) => void; reply: string; setReply: (value: string) => void }) {
  const { locale, t } = useLanguage();
  return <ModalPortal><div className="modal-backdrop suggestion-modal-backdrop" role="presentation"><section aria-modal="true" className="suggestion-modal suggestion-detail-modal" role="dialog"><header><span><Lightbulb aria-hidden="true" size={18} /><strong>{t("suggestion.detail")}</strong></span><button aria-label={t("common.close")} onClick={onClose} type="button"><X aria-hidden="true" size={17} /></button></header><main><div className="suggestion-detail-heading"><span><h2>{detail.title}</h2><small>{detail.user.nickname} · {formatTime(detail.createdAt, locale)}</small></span>{mode === "inbox" ? <label className="suggestion-status-select"><span>{t("suggestion.progress")}</span><GlassSelect ariaLabel={t("suggestion.progress")} disabled={isSaving} onChange={onChangeStatus} options={SUGGESTION_STATUSES.map((status) => ({ label: t(STATUS_KEYS[status]), value: status }))} value={detail.status} /></label> : <em className={`suggestion-status ${detail.status}`}>{t(STATUS_KEYS[detail.status])}</em>}</div><p className="suggestion-content">{detail.content}</p><div className="suggestion-replies"><span><MessageCircleMore aria-hidden="true" size={15} />{t("suggestion.replies", { count: detail.replies.length })}</span>{detail.replies.length ? detail.replies.map((item) => <article key={item.id}><strong>{item.author.nickname}</strong><time>{formatTime(item.createdAt, locale)}</time><p>{item.content}</p></article>) : <p>{t("suggestion.noReplies")}</p>}</div>{mode === "inbox" ? <form className="suggestion-reply-form" onSubmit={onReply}><div><textarea maxLength={2000} onChange={(event) => setReply(event.target.value)} placeholder={t("suggestion.replyPlaceholder")} rows={3} value={reply} /><button aria-label={t("common.send")} disabled={isSaving || !reply.trim()} title={t("common.send")} type="submit"><Send aria-hidden="true" size={16} /></button></div></form> : null}</main></section></div></ModalPortal>;
}

function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

function formatTime(value: string, locale: "zh-CN" | "en-US") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
