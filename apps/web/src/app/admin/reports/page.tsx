"use client";

import { AlertTriangle, Check, ChevronLeft, ChevronRight, FileText, Flag, LoaderCircle, MessageSquare, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AppToast } from "@/components/app-toast";
import { GroupReportMessagePreview } from "@/components/group-report-message-preview";
import { GlassSelect } from "@/components/glass-select";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getModerationReportSummary, listModerationReports, ModerationReport, ModerationReportSource, ModerationReportStatus } from "@/lib/moderation-api";
import { moderateArticleReport, moderateCommentReport } from "@/lib/article-api";
import { handleChatGroupReport } from "@/lib/social-api";
import { isSiteManager } from "@/lib/user-permissions";

const PAGE_SIZE = 20;
const STATUS_LABEL: Record<ModerationReportStatus | "all", string> = { pending: "待处理", resolved: "已处理", rejected: "已驳回", all: "全部状态" };
const SOURCE_LABEL: Record<ModerationReportSource | "all", string> = { article: "文章举报", comment: "评论举报", group_message: "群消息举报", all: "全部来源" };
const REASON_LABEL: Record<string, string> = { spam: "垃圾广告", harassment: "辱骂骚扰", illegal: "违法违规", privacy: "隐私泄露", misinformation: "不实内容", other: "其他" };
type ModerationActionStatus = Exclude<ModerationReportStatus, "pending">;
type ActionTarget = { report: ModerationReport; status: ModerationActionStatus };

export default function ModerationReportsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [items, setItems] = useState<ModerationReport[]>([]);
  const [status, setStatus] = useState<ModerationReportStatus | "all">("pending");
  const [source, setSource] = useState<ModerationReportSource | "all">("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState({ total: 0, pending: 0, bySource: { article: 0, comment: 0, group_message: 0 } });
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [previewReport, setPreviewReport] = useState<ModerationReport | null>(null);
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [resolution, setResolution] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load(token: string, nextPage = page) {
    setIsLoading(true);
    try {
      const [result, summaryResult] = await Promise.all([
        listModerationReports(token, { status, type: source, page: nextPage, pageSize: PAGE_SIZE }),
        getModerationReportSummary(token),
      ]);
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setSummary(summaryResult);
      if (result.page !== nextPage) setPage(result.page);
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) { clearAuthTokens(); router.replace("/"); return; }
      setError(loadError instanceof Error ? loadError.message : "举报中心读取失败。");
    } finally { setIsLoading(false); }
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) { router.replace("/login?from=%2Fadmin%2Freports"); return; }
    let active = true;
    Promise.all([getMe(token), getModerationReportSummary(token)]).then(([currentUser, summaryResult]) => {
      if (!active) return;
      if (!isSiteManager(currentUser)) { router.replace("/"); return; }
      setUser(currentUser);
      setSummary(summaryResult);
      void load(token, 1);
    }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "举报中心读取失败。"); });
    return () => { active = false; };
    // The protected workspace is initialized once; subsequent filters own reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token || !user) return;
    // Filter changes intentionally restart at page one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
    void load(token, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, source]);

  async function submitAction() {
    const token = readAccessToken();
    if (!token || !actionTarget) return;
    const { report, status: nextStatus } = actionTarget;
    const feedback = resolution.trim() || (nextStatus === "resolved" ? "举报已处理。" : "未发现违规。");
    setBusyKey(report.key);
    try {
      if (report.source === "article") await moderateArticleReport(token, report.id, { status: nextStatus, resolution: feedback });
      else if (report.source === "comment") await moderateCommentReport(token, report.id, { status: nextStatus, resolution: feedback });
      else await handleChatGroupReport(token, report.id, { status: nextStatus, resolution: feedback, deleteMessage: nextStatus === "resolved" });
      setActionTarget(null);
      setResolution("");
      setNotice(nextStatus === "resolved" ? "举报已处理。" : "举报已驳回。");
      await load(token, page);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "举报处理失败。"); }
    finally { setBusyKey(""); }
  }

  if (!user && isLoading && !error) return <section className="page-shell moderation-reports-page"><div className="article-empty-state"><LoaderCircle className="spin" size={22} />正在打开举报中心。</div></section>;
  return <section className="page-shell moderation-reports-page">
    <header className="moderation-reports-header"><div><span className="page-kicker">CONTENT MODERATION</span><h1>举报中心</h1><p>将文章、评论和群消息举报集中到同一条处理队列中。</p></div><div className="moderation-summary"><span><b>{summary.pending}</b><small>待处理</small></span><span><b>{summary.total}</b><small>全部记录</small></span></div></header>
    <div className="moderation-reports-toolbar"><div className="moderation-filter-group"><GlassSelect ariaLabel="举报状态" onChange={setStatus} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value: value as ModerationReportStatus | "all", label }))} value={status} /><GlassSelect ariaLabel="举报来源" onChange={setSource} options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value: value as ModerationReportSource | "all", label }))} value={source} /></div><div className="moderation-source-summary"><span><FileText aria-hidden="true" size={14} />文章 {summary.bySource.article}</span><span><MessageSquare aria-hidden="true" size={14} />评论 {summary.bySource.comment}</span><span><Flag aria-hidden="true" size={14} />群消息 {summary.bySource.group_message}</span></div></div>
    {isLoading ? <div className="article-empty-state"><LoaderCircle className="spin" size={22} />正在读取举报队列。</div> : items.length ? <div className="moderation-report-list">{items.map((report) => <ModerationReportRow busy={busyKey === report.key} key={report.key} onAction={(nextReport, nextStatus) => { setActionTarget({ report: nextReport, status: nextStatus }); setResolution(""); }} onPreview={setPreviewReport} report={report} />)}</div> : <div className="article-empty-state"><AlertTriangle size={22} />当前筛选下没有举报记录。</div>}
    {totalPages > 1 ? <footer className="moderation-pagination"><button aria-label="上一页" disabled={page <= 1 || isLoading} onClick={() => { const next = page - 1; setPage(next); const token = readAccessToken(); if (token) void load(token, next); }} type="button"><ChevronLeft size={16} /></button><span>第 {page} / {totalPages} 页 · 共 {total} 条</span><button aria-label="下一页" disabled={page >= totalPages || isLoading} onClick={() => { const next = page + 1; setPage(next); const token = readAccessToken(); if (token) void load(token, next); }} type="button"><ChevronRight size={16} /></button></footer> : null}
    {previewReport ? <ModerationReportPreview report={previewReport} onClose={() => setPreviewReport(null)} /> : null}
    {actionTarget ? <div className="modal-backdrop moderation-action-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setActionTarget(null); }} role="presentation"><form aria-modal="true" className="moderation-action-dialog" onSubmit={(event) => { event.preventDefault(); void submitAction(); }} role="dialog"><header><span><AlertTriangle size={17} /><strong>{actionTarget.status === "resolved" ? "处理举报" : "驳回举报"}</strong></span><button aria-label="关闭" onClick={() => setActionTarget(null)} type="button"><X size={17} /></button></header><p>{actionTarget.report.source === "group_message" && actionTarget.status === "resolved" ? "处理后会删除被举报群消息，并通知举报者和消息发送者。" : "填写的反馈会记录在举报记录中，并沿用原有通知流程。"}</p><textarea autoFocus maxLength={500} onChange={(event) => setResolution(event.target.value)} placeholder="填写处理反馈" required value={resolution} /><footer><button onClick={() => setActionTarget(null)} type="button">取消</button><button disabled={busyKey === actionTarget.report.key} type="submit">{busyKey === actionTarget.report.key ? "处理中" : "确认"}</button></footer></form></div> : null}
    <AppToast duration={error ? 4200 : 2800} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function ModerationReportRow({ report, busy, onAction, onPreview }: { report: ModerationReport; busy: boolean; onAction: (report: ModerationReport, status: ModerationActionStatus) => void; onPreview: (report: ModerationReport) => void }) {
  const content = report.source === "article" ? report.article?.title : report.source === "comment" ? report.comment?.body : report.message?.body || report.message?.attachments.map((item) => `附件：${item.originalName}`).join("、") || "附件消息";
  const targetLabel = report.source === "group_message" ? "被举报用户" : report.source === "comment" ? "评论作者" : "文章作者";
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPreview(report); } }
  return <article className={`moderation-report-row ${report.status}`} aria-label={`查看${report.sourceLabel}内容`} onClick={() => onPreview(report)} onKeyDown={handleKeyDown} role="button" tabIndex={0}>
    <div className="moderation-report-row-main"><div className="moderation-report-row-heading"><span className={`moderation-report-source ${report.source}`}><SourceIcon source={report.source} />{report.sourceLabel}</span><span className="moderation-report-reason">{REASON_LABEL[report.reason] ?? report.reason}</span><span className="moderation-report-heading-meta">{targetLabel}：{report.targetUser?.nickname || "未知用户"}{report.group ? ` · ${report.group.name}` : ""} · 举报人：{report.reporter.nickname}</span><time>{formatTime(report.createdAt)}</time></div><div className="moderation-report-content"><strong>{content}</strong></div></div>
    <footer className="moderation-report-row-actions" onClick={(event) => event.stopPropagation()}>{report.status === "pending" ? <><button aria-label="驳回举报" disabled={busy} onClick={() => onAction(report, "rejected")} title="驳回举报" type="button"><X size={16} /></button><button aria-label="处理举报" className="confirm" disabled={busy} onClick={() => onAction(report, "resolved")} title={report.source === "group_message" ? "处理并删除群消息" : "处理举报"} type="button">{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}</button></> : <small>{report.status === "resolved" ? "已处理" : "已驳回"}</small>}</footer>
  </article>;
}

function ModerationReportPreview({ report, onClose }: { report: ModerationReport; onClose: () => void }) {
  if (report.source === "group_message" && report.group && report.message) return <GroupReportMessagePreview group={report.group} message={report.message} onClose={onClose} />;
  if (typeof document === "undefined") return null;
  const title = report.source === "article" ? "文章名称" : "评论内容";
  const content = report.source === "article" ? report.article?.title : report.comment?.body;
  return createPortal(<div className="modal-backdrop moderation-content-backdrop" onClick={onClose} role="presentation"><section aria-modal="true" className="moderation-content-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><header><span><SourceIcon source={report.source} /><strong>{title}</strong></span><button aria-label="关闭内容预览" onClick={onClose} type="button"><X size={17} /></button></header><div className="moderation-content-dialog-body">{content || "暂无内容"}</div></section></div>, document.body);
}

function SourceIcon({ source }: { source: ModerationReportSource }) { if (source === "article") return <FileText aria-hidden="true" size={14} />; if (source === "comment") return <MessageSquare aria-hidden="true" size={14} />; return <Flag aria-hidden="true" size={14} />; }
function formatTime(value: string): string { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
