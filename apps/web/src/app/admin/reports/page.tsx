"use client";

import { AlertTriangle, BarChart3, Check, ChevronLeft, ChevronRight, ClipboardCheck, FileText, Flag, LoaderCircle, MessageSquare, Plus, Save, Settings2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AdminArticlePreviewModal } from "@/components/admin-article-preview-modal";
import { AppToast } from "@/components/app-toast";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { useLanguage } from "@/components/language-provider";
import { GroupReportMessagePreview } from "@/components/group-report-message-preview";
import { GlassSelect } from "@/components/glass-select";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import {
  bulkHandleModerationReports,
  createModerationRule,
  createModerationTemplate,
  deleteModerationRule,
  deleteModerationTemplate,
  getModerationOverview,
  getModerationReportSummary,
  getModerationSettings,
  listModerationReports,
  listModerationRuleHits,
  listModerationRules,
  listModerationTemplates,
  ModerationOverview,
  ModerationReport,
  ModerationReportSource,
  ModerationReportStatus,
  ModerationRule,
  ModerationRuleHit,
  ModerationSettings,
  ModerationTemplate,
  updateModerationRule,
  updateModerationSettings,
  updateModerationTemplate,
} from "@/lib/moderation-api";
import { getMyArticleReportPreview, moderateArticleReport, moderateCommentReport, type Article } from "@/lib/article-api";
import { handleChatGroupReport } from "@/lib/social-api";
import { isSiteManager } from "@/lib/user-permissions";

const PAGE_SIZE = 20;
const STATUS_LABEL: Record<ModerationReportStatus | "all", string> = { pending: "待处理", resolved: "已处理", rejected: "已驳回", all: "全部状态" };
const SOURCE_LABEL: Record<ModerationReportSource | "all", string> = { article: "文章举报", comment: "评论举报", group_message: "群消息举报", all: "全部来源" };
const REASON_LABEL: Record<string, string> = { spam: "垃圾广告", harassment: "辱骂骚扰", illegal: "违法违规", privacy: "隐私泄露", misinformation: "不实内容", other: "其他" };
type ModerationActionStatus = Exclude<ModerationReportStatus, "pending">;
type ActionTarget = { report: ModerationReport; status: ModerationActionStatus };
type ResolutionMode = "keep" | "block" | "delete";
type ModerationView = "queue" | "insights" | "settings";

function resolutionOptions(source: ModerationReportSource, phrase: (chinese: string, english: string) => string): Array<{ label: string; value: ResolutionMode }> {
  if (source === "article") return [
    { value: "keep", label: phrase("处理但不修改文章", "Resolve and keep article") },
    { value: "block", label: phrase("屏蔽文章", "Block article") },
    { value: "delete", label: phrase("删除文章", "Delete article") },
  ];
  if (source === "comment") return [
    { value: "keep", label: phrase("处理但保留评论", "Resolve and keep comment") },
    { value: "block", label: phrase("屏蔽评论", "Block comment") },
    { value: "delete", label: phrase("删除评论", "Delete comment") },
  ];
  return [
    { value: "keep", label: phrase("处理但保留消息", "Resolve and keep message") },
    { value: "delete", label: phrase("处理并删除消息", "Resolve and delete message") },
  ];
}

export default function ModerationReportsPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const statusOptions = Object.entries(STATUS_LABEL).map(([value, label]) => ({
    value: value as ModerationReportStatus | "all",
    label: phrase(label, value === "pending" ? "Pending" : value === "resolved" ? "Resolved" : value === "rejected" ? "Rejected" : "All statuses"),
  }));
  const sourceOptions = Object.entries(SOURCE_LABEL).map(([value, label]) => ({
    value: value as ModerationReportSource | "all",
    label: phrase(label, value === "article" ? "Article reports" : value === "comment" ? "Comment reports" : value === "group_message" ? "Group message reports" : "All sources"),
  }));
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
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);
  const previewRequestRef = useRef(0);
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [resolutionMode, setResolutionMode] = useState<ResolutionMode>("keep");
  const [resolution, setResolution] = useState("");
  const [templateId, setTemplateId] = useState("manual");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [batchStatus, setBatchStatus] = useState<ModerationActionStatus | null>(null);
  const [view, setView] = useState<ModerationView>("queue");
  const [overview, setOverview] = useState<ModerationOverview | null>(null);
  const [ruleHits, setRuleHits] = useState<ModerationRuleHit[]>([]);
  const [rules, setRules] = useState<ModerationRule[]>([]);
  const [templates, setTemplates] = useState<ModerationTemplate[]>([]);
  const [settings, setSettings] = useState<ModerationSettings | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load(token: string, nextPage = page) {
    setIsLoading(true);
    try {
      const [result, summaryResult, templateResult] = await Promise.all([
        listModerationReports(token, { status, type: source, page: nextPage, pageSize: PAGE_SIZE }),
        getModerationReportSummary(token),
        listModerationTemplates(token),
      ]);
      setItems(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setSummary(summaryResult);
      setTemplates(templateResult.items.filter((item) => item.enabled));
      if (result.page !== nextPage) setPage(result.page);
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) { clearAuthTokens(); router.replace(localizedPath("/", locale)); return; }
      setError(loadError instanceof Error ? loadError.message : phrase("举报中心读取失败。", "Could not load report center."));
    } finally { setIsLoading(false); }
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) { router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/reports", locale))}`); return; }
    let active = true;
    Promise.all([getMe(token), getModerationReportSummary(token)]).then(([currentUser, summaryResult]) => {
      if (!active) return;
      if (!isSiteManager(currentUser)) { router.replace(localizedPath("/", locale)); return; }
      setUser(currentUser);
      setSummary(summaryResult);
      void load(token, 1);
    }).catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : phrase("举报中心读取失败。", "Could not load report center.")); });
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

  async function loadGovernance() {
    const token = readAccessToken();
    if (!token || !user) return;
    try {
      const [overviewResult, hitsResult, rulesResult, templateResult, settingsResult] = await Promise.all([
        getModerationOverview(token),
        listModerationRuleHits(token),
        listModerationRules(token),
        listModerationTemplates(token),
        getModerationSettings(token),
      ]);
      setOverview(overviewResult);
      setRuleHits(hitsResult.items);
      setRules(rulesResult.items);
      setTemplates(templateResult.items);
      setSettings(settingsResult);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : phrase("内容治理数据读取失败。", "Could not load content governance data."));
    }
  }

  useEffect(() => {
    if (view === "queue") return;
    const timer = window.setTimeout(() => void loadGovernance(), 0);
    return () => window.clearTimeout(timer);
    // Governance views refresh when their tab becomes active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, view]);

  async function submitAction() {
    const token = readAccessToken();
    if (!token || !actionTarget) return;
    const { report, status: nextStatus } = actionTarget;
    const feedback = resolution.trim() || (nextStatus === "resolved" ? phrase("举报已处理。", "Report resolved.") : phrase("未发现违规。", "No violation found."));
    setBusyKey(report.key);
    try {
      if (report.source === "article") {
        await moderateArticleReport(token, report.id, {
          status: nextStatus,
          resolution: feedback,
          articleStatus: nextStatus === "resolved" && resolutionMode !== "keep" ? (resolutionMode === "block" ? "blocked" : "deleted") : undefined,
        });
      } else if (report.source === "comment") {
        await moderateCommentReport(token, report.id, {
          status: nextStatus,
          resolution: feedback,
          commentStatus: nextStatus === "resolved" && resolutionMode !== "keep" ? (resolutionMode === "block" ? "blocked" : "deleted") : undefined,
        });
      } else {
        await handleChatGroupReport(token, report.id, {
          status: nextStatus,
          resolution: feedback,
          deleteMessage: nextStatus === "resolved" && resolutionMode === "delete",
        });
      }
      setActionTarget(null);
      setResolutionMode("keep");
      setResolution("");
      setTemplateId("manual");
      setNotice(nextStatus === "resolved" ? phrase("举报已处理。", "Report resolved.") : phrase("举报已驳回。", "Report rejected."));
      await load(token, page);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : phrase("举报处理失败。", "Could not process report.")); }
    finally { setBusyKey(""); }
  }

  async function submitBatchAction() {
    const token = readAccessToken();
    if (!token || !batchStatus || !selectedIds.length) return;
    const selected = items.filter((item) => selectedIds.includes(item.id));
    const selectedSource = selected[0]?.source;
    if (!selectedSource || selected.some((item) => item.source !== selectedSource)) {
      setError(phrase("批量处理一次只能选择同一种举报来源。", "Batch processing can include one report source at a time."));
      return;
    }
    setBusyKey("batch");
    try {
      const result = await bulkHandleModerationReports(token, {
        source: selectedSource,
        reportIds: selectedIds,
        status: batchStatus,
        resolution: resolution.trim() || (batchStatus === "resolved" ? phrase("举报已处理。", "Report resolved.") : phrase("未发现违规。", "No violation found.")),
      });
      setBatchStatus(null);
      setSelectedIds([]);
      setResolution("");
      setTemplateId("manual");
      setNotice(result.failed.length ? phrase(`已处理 ${result.succeeded.length} 条，${result.failed.length} 条未处理。`, `${result.succeeded.length} processed; ${result.failed.length} not processed.`) : phrase(`已批量处理 ${result.succeeded.length} 条举报。`, `${result.succeeded.length} report(s) processed in bulk.`));
      await load(token, page);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("批量处理失败。", "Could not process reports in bulk."));
    } finally { setBusyKey(""); }
  }

  function toggleSelection(report: ModerationReport, checked: boolean) {
    setSelectedIds((current) => {
      if (!checked) return current.filter((id) => id !== report.id);
      const currentReports = items.filter((item) => current.includes(item.id));
      return currentReports.length && currentReports.some((item) => item.source !== report.source) ? [report.id] : [...current, report.id];
    });
  }

  function chooseTemplate(value: string) {
    setTemplateId(value);
    if (value === "manual") return;
    const selected = templates.find((item) => String(item.id) === value);
    if (selected) setResolution(selected.content);
  }

  async function openPreview(report: ModerationReport) {
    const requestId = ++previewRequestRef.current;
    setPreviewArticle(null);
    if (report.source !== "article") {
      setPreviewReport(report);
      return;
    }

    setPreviewReport(null);
    const token = readAccessToken();
    if (!token) return;
    try {
      const article = await getMyArticleReportPreview(token, report.id);
      if (previewRequestRef.current === requestId) setPreviewArticle(article);
    } catch (previewError) {
      if (previewRequestRef.current !== requestId) return;
      if (isAuthExpiredError(previewError)) {
        clearAuthTokens();
        router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/reports", locale))}`);
        return;
      }
      setError(previewError instanceof Error ? previewError.message : phrase("文章内容加载失败。", "Could not load article content."));
    }
  }

  if (!user && isLoading && !error) return <AdminPageLoading className="moderation-reports-page" loadingLabel={phrase("正在打开举报中心。", "Opening report center.")} title={phrase("举报中心", "Report center")} />;
  return <section className="page-shell moderation-reports-page">
    <AdminPageHeader className="moderation-reports-header" description={phrase("统一处理举报、规则命中和处理时限。", "Handle reports, rule matches, and response deadlines in one place.")} title={phrase("举报中心", "Report center")} actions={<div className="moderation-summary"><span><b>{summary.pending}</b><small>{phrase("待处理", "Pending")}</small></span><span><b>{overview?.reports.overdue ?? 0}</b><small>{phrase("已超时", "Overdue")}</small></span><span><b>{summary.total}</b><small>{phrase("全部记录", "All records")}</small></span></div>} />
    <nav aria-label={phrase("举报中心功能", "Report center views")} className="moderation-admin-tabs">
      <button className={view === "queue" ? "active" : ""} onClick={() => setView("queue")} type="button"><ClipboardCheck size={15} />{phrase("举报队列", "Report queue")}</button>
      <button className={view === "insights" ? "active" : ""} onClick={() => setView("insights")} type="button"><BarChart3 size={15} />{phrase("规则命中与统计", "Rule matches and analytics")}</button>
      {user?.isSuperAdmin ? <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")} type="button"><Settings2 size={15} />{phrase("规则与自动化", "Rules and automation")}</button> : null}
    </nav>
    {view === "queue" ? <>
      <div className="moderation-reports-toolbar"><div className="moderation-filter-group"><GlassSelect ariaLabel={phrase("举报状态", "Report status")} onChange={setStatus} options={statusOptions} value={status} /><GlassSelect ariaLabel={phrase("举报来源", "Report source")} onChange={setSource} options={sourceOptions} value={source} /></div><div className="moderation-source-summary"><span><FileText aria-hidden="true" size={14} />{phrase("文章", "Articles")} {summary.bySource.article}</span><span><MessageSquare aria-hidden="true" size={14} />{phrase("评论", "Comments")} {summary.bySource.comment}</span><span><Flag aria-hidden="true" size={14} />{phrase("群消息", "Group messages")} {summary.bySource.group_message}</span></div></div>
      {selectedIds.length ? <div className="moderation-batch-bar"><span>{phrase(`已选择 ${selectedIds.length} 条同类举报`, `${selectedIds.length} matching report(s) selected`)}</span><div><button disabled={busyKey === "batch"} onClick={() => { setBatchStatus("rejected"); setResolution(""); setTemplateId("manual"); }} type="button">{phrase("批量驳回", "Reject selected")}</button><button disabled={busyKey === "batch"} onClick={() => { setBatchStatus("resolved"); setResolution(""); setTemplateId("manual"); }} type="button">{phrase("批量处理", "Resolve selected")}</button><button aria-label={phrase("取消选择", "Clear selection")} onClick={() => setSelectedIds([])} title={phrase("取消选择", "Clear selection")} type="button"><X size={15} /></button></div></div> : null}
      {isLoading ? <div className="article-empty-state"><LoaderCircle className="spin" size={22} />{phrase("正在读取举报队列。", "Loading report queue.")}</div> : items.length ? <div className="moderation-report-list">{items.map((report) => <ModerationReportRow busy={busyKey === report.key} key={report.key} onAction={(nextReport, nextStatus) => { setActionTarget({ report: nextReport, status: nextStatus }); setResolutionMode(nextStatus === "resolved" && nextReport.source === "group_message" ? "delete" : "keep"); setResolution(""); setTemplateId("manual"); }} onPreview={(nextReport) => void openPreview(nextReport)} onSelect={toggleSelection} report={report} selected={selectedIds.includes(report.id)} selectable={!selectedIds.length || items.filter((item) => selectedIds.includes(item.id)).every((item) => item.source === report.source)} />)}</div> : <div className="article-empty-state"><AlertTriangle size={22} />{phrase("当前筛选下没有举报记录。", "No reports match the current filters.")}</div>}
      {totalPages > 1 ? <footer className="moderation-pagination"><button aria-label={phrase("上一页", "Previous page")} disabled={page <= 1 || isLoading} onClick={() => { const next = page - 1; setPage(next); const token = readAccessToken(); if (token) void load(token, next); }} type="button"><ChevronLeft size={16} /></button><span>{phrase(`第 ${page} / ${totalPages} 页 · 共 ${total} 条`, `Page ${page} of ${totalPages} · ${total} total`)}</span><button aria-label={phrase("下一页", "Next page")} disabled={page >= totalPages || isLoading} onClick={() => { const next = page + 1; setPage(next); const token = readAccessToken(); if (token) void load(token, next); }} type="button"><ChevronRight size={16} /></button></footer> : null}
    </> : null}
    {view === "insights" ? <ModerationInsights overview={overview} ruleHits={ruleHits} /> : null}
    {view === "settings" && user?.isSuperAdmin ? <ModerationConfiguration key={settings?.updatedAt ?? "loading"} onError={setError} onNotice={setNotice} onRefresh={() => void loadGovernance()} rules={rules} settings={settings} templates={templates} /> : null}
    {previewReport ? <ModerationReportPreview report={previewReport} onClose={() => setPreviewReport(null)} /> : null}
    {previewArticle ? <AdminArticlePreviewModal article={previewArticle} onClose={() => setPreviewArticle(null)} /> : null}
    {actionTarget ? <div className="modal-backdrop moderation-action-backdrop" role="presentation"><form aria-modal="true" className="moderation-action-dialog" onSubmit={(event) => { event.preventDefault(); void submitAction(); }} role="dialog"><header><span><AlertTriangle size={17} /><strong>{actionTarget.status === "resolved" ? phrase("处理举报", "Resolve report") : phrase("驳回举报", "Reject report")}</strong></span><button aria-label={phrase("关闭", "Close")} onClick={() => setActionTarget(null)} type="button"><X size={17} /></button></header>{actionTarget.status === "resolved" ? <label className="moderation-action-field"><span>{phrase("处理方式", "Resolution")}</span><GlassSelect ariaLabel={phrase("处理方式", "Resolution")} onChange={setResolutionMode} options={resolutionOptions(actionTarget.report.source, phrase)} value={resolutionMode} /></label> : null}<label className="moderation-action-field"><span>{phrase("处理模板", "Response template")}</span><GlassSelect ariaLabel={phrase("处理模板", "Response template")} onChange={chooseTemplate} options={[{ value: "manual", label: phrase("手动填写", "Write manually") }, ...templates.filter((item) => item.status === actionTarget.status).map((item) => ({ value: String(item.id), label: item.name }))]} value={templateId} /></label><p>{actionDescription(actionTarget, resolutionMode, phrase)}</p><textarea autoFocus maxLength={500} onChange={(event) => setResolution(event.target.value)} placeholder={phrase("填写处理反馈", "Write feedback for this decision")} required value={resolution} /><footer><button onClick={() => setActionTarget(null)} type="button">{phrase("取消", "Cancel")}</button><button disabled={busyKey === actionTarget.report.key} type="submit">{busyKey === actionTarget.report.key ? phrase("处理中", "Processing") : phrase("确认", "Confirm")}</button></footer></form></div> : null}
    {batchStatus ? <div className="modal-backdrop moderation-action-backdrop" role="presentation"><form aria-modal="true" className="moderation-action-dialog" onSubmit={(event) => { event.preventDefault(); void submitBatchAction(); }} role="dialog"><header><span><ClipboardCheck size={17} /><strong>{batchStatus === "resolved" ? phrase("批量处理举报", "Resolve selected reports") : phrase("批量驳回举报", "Reject selected reports")}</strong></span><button aria-label={phrase("关闭", "Close")} onClick={() => setBatchStatus(null)} type="button"><X size={17} /></button></header><label className="moderation-action-field"><span>{phrase("处理模板", "Response template")}</span><GlassSelect ariaLabel={phrase("批量处理模板", "Batch response template")} onChange={chooseTemplate} options={[{ value: "manual", label: phrase("手动填写", "Write manually") }, ...templates.filter((item) => item.status === batchStatus).map((item) => ({ value: String(item.id), label: item.name }))]} value={templateId} /></label><p>{phrase("批量操作将保留原内容，并逐条发送处理结果通知。", "Batch processing keeps the original content and sends every reporter a result notification.")}</p><textarea autoFocus maxLength={500} onChange={(event) => setResolution(event.target.value)} placeholder={phrase("填写统一处理反馈", "Write shared feedback")} required value={resolution} /><footer><button onClick={() => setBatchStatus(null)} type="button">{phrase("取消", "Cancel")}</button><button disabled={busyKey === "batch"} type="submit">{busyKey === "batch" ? phrase("处理中", "Processing") : phrase("确认", "Confirm")}</button></footer></form></div> : null}
    <AppToast duration={error ? 4200 : 2800} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function ModerationInsights({ overview, ruleHits }: { overview: ModerationOverview | null; ruleHits: ModerationRuleHit[] }) {
  const { locale, phrase } = useLanguage();
  if (!overview) return <div className="article-empty-state"><LoaderCircle className="spin" size={22} />{phrase("正在读取治理统计。", "Loading moderation analytics.")}</div>;
  return <section className="moderation-insights" aria-label={phrase("内容治理统计", "Content governance analytics")}>
    <div className="moderation-overview-grid">
      <Statistic label={phrase("待处理", "Pending")} value={overview.reports.pending} />
      <Statistic label={phrase("已超时", "Overdue")} tone="warning" value={overview.reports.overdue} />
      <Statistic label={phrase("近 7 日命中", "Matches in 7 days")} value={overview.ruleHits.last7Days} />
      <Statistic label={phrase("平均处理时长", "Average handling time")} value={overview.reports.averageHandleMinutes === null ? "--" : phrase(`${overview.reports.averageHandleMinutes} 分`, `${overview.reports.averageHandleMinutes} min`)} />
    </div>
    <div className="moderation-governance-panel"><header><strong>{phrase("处理队列", "Processing queue")}</strong><small>{phrase("按来源统计未完成举报与超时数量", "Pending and overdue reports by source")}</small></header><div className="moderation-metric-lines">{(["article", "comment", "group_message"] as ModerationReportSource[]).map((source) => <div key={source}><span>{sourceLabel(source, phrase)}</span><b>{phrase(`${overview.reports.bySource[source].pending} 待处理`, `${overview.reports.bySource[source].pending} pending`)}</b><small>{phrase(`${overview.reports.bySource[source].overdue} 超时 / ${overview.reports.bySource[source].total} 总数`, `${overview.reports.bySource[source].overdue} overdue / ${overview.reports.bySource[source].total} total`)}</small></div>)}</div></div>
    <div className="moderation-governance-panel"><header><strong>{phrase("最近规则命中", "Recent rule matches")}</strong><small>{phrase(`最近 30 天 ${overview.ruleHits.last30Days} 次`, `${overview.ruleHits.last30Days} in the last 30 days`)}</small></header>{ruleHits.length ? <div className="moderation-hit-list">{ruleHits.map((hit) => <article key={hit.id}><span>{ruleTypeLabel(hit.rule.type, phrase)}</span><strong>{hit.rule.name}</strong><p>{hit.detail}: {hit.contentPreview}</p><time>{formatTime(hit.createdAt, locale)}</time></article>)}</div> : <div className="moderation-empty">{phrase("暂无规则命中记录。", "No rule matches yet.")}</div>}</div>
  </section>;
}

function Statistic({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return <div className={`moderation-statistic ${tone}`}><b>{value}</b><span>{label}</span></div>;
}

function ModerationConfiguration({ rules, templates, settings, onRefresh, onNotice, onError }: { rules: ModerationRule[]; templates: ModerationTemplate[]; settings: ModerationSettings | null; onRefresh: () => void; onNotice: (value: string) => void; onError: (value: string) => void }) {
  const { phrase } = useLanguage();
  const [ruleId, setRuleId] = useState<number | null>(null);
  const [ruleDraft, setRuleDraft] = useState({ name: "", type: "sensitive_word" as ModerationRule["type"], action: "record" as ModerationRule["action"], sources: ["article", "comment"] as ModerationReportSource[], keywords: "", threshold: 1, windowSeconds: 60, enabled: true });
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [templateDraft, setTemplateDraft] = useState({ name: "", status: "resolved" as ModerationTemplate["status"], content: "", enabled: true });
  const [settingsDraft, setSettingsDraft] = useState<ModerationSettings | null>(settings);
  const [busy, setBusy] = useState("");

  function resetRule() { setRuleId(null); setRuleDraft({ name: "", type: "sensitive_word", action: "record", sources: ["article", "comment"], keywords: "", threshold: 1, windowSeconds: 60, enabled: true }); }
  function resetTemplate() { setTemplateId(null); setTemplateDraft({ name: "", status: "resolved", content: "", enabled: true }); }
  function editRule(rule: ModerationRule) { setRuleId(rule.id); setRuleDraft({ name: rule.name, type: rule.type, action: rule.action, sources: rule.sources, keywords: rule.keywords, threshold: rule.threshold, windowSeconds: rule.windowSeconds, enabled: rule.enabled }); }
  function editTemplate(template: ModerationTemplate) { setTemplateId(template.id); setTemplateDraft({ name: template.name, status: template.status, content: template.content, enabled: template.enabled }); }
  async function saveRule(event: FormEvent) {
    event.preventDefault(); const token = readAccessToken(); if (!token) return;
    setBusy("rule");
    try { if (ruleId) await updateModerationRule(token, ruleId, { ...ruleDraft }); else await createModerationRule(token, ruleDraft); resetRule(); onNotice(phrase("治理规则已保存。", "Moderation rule saved.")); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : phrase("规则保存失败。", "Could not save moderation rule.")); } finally { setBusy(""); }
  }
  async function saveTemplate(event: FormEvent) {
    event.preventDefault(); const token = readAccessToken(); if (!token) return;
    setBusy("template");
    try { if (templateId) await updateModerationTemplate(token, templateId, templateDraft); else await createModerationTemplate(token, templateDraft); resetTemplate(); onNotice(phrase("处理模板已保存。", "Response template saved.")); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : phrase("模板保存失败。", "Could not save response template.")); } finally { setBusy(""); }
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault(); const token = readAccessToken(); if (!token || !settingsDraft) return;
    setBusy("settings");
    try { await updateModerationSettings(token, { deadlineHours: Number(settingsDraft.deadlineHours), reminderLeadHours: Number(settingsDraft.reminderLeadHours), automaticRemindersEnabled: settingsDraft.automaticRemindersEnabled }); onNotice(phrase("处理时限已保存。", "Handling deadline saved.")); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : phrase("处理时限保存失败。", "Could not save handling deadline.")); } finally { setBusy(""); }
  }
  async function remove(kind: "rule" | "template", id: number) {
    const token = readAccessToken(); if (!token) return; setBusy(`${kind}-${id}`);
    try { if (kind === "rule") await deleteModerationRule(token, id); else await deleteModerationTemplate(token, id); onNotice(kind === "rule" ? phrase("治理规则已删除。", "Moderation rule deleted.") : phrase("处理模板已删除。", "Response template deleted.")); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : phrase("删除失败。", "Could not delete item.")); } finally { setBusy(""); }
  }
  return <section className="moderation-configuration">
    <div className="moderation-configuration-grid">
      <form className="moderation-governance-panel moderation-form" onSubmit={saveRule}>
        <header><strong>{ruleId ? phrase("编辑治理规则", "Edit moderation rule") : phrase("新增治理规则", "New moderation rule")}</strong><button aria-label={phrase("新建规则", "New rule")} onClick={resetRule} title={phrase("新建规则", "New rule")} type="button"><Plus size={16} /></button></header>
        <div className="moderation-form-grid">
          <label><span>{phrase("名称", "Name")}</span><input maxLength={80} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} required value={ruleDraft.name} /></label>
          <label><span>{phrase("规则类型", "Rule type")}</span><GlassSelect ariaLabel={phrase("规则类型", "Rule type")} disabled={Boolean(ruleId)} onChange={(value) => setRuleDraft({ ...ruleDraft, type: value })} options={[{ value: "sensitive_word", label: phrase("敏感词", "Sensitive words") }, { value: "link_rate", label: phrase("链接频率", "Link frequency") }, { value: "duplicate_content", label: phrase("重复内容", "Duplicate content") }, { value: "high_frequency", label: phrase("高频发言", "High-frequency posting") }]} value={ruleDraft.type} /></label>
          <label><span>{phrase("命中动作", "Match action")}</span><GlassSelect ariaLabel={phrase("命中动作", "Match action")} onChange={(value) => setRuleDraft({ ...ruleDraft, action: value })} options={[{ value: "record", label: phrase("记录但放行", "Record and allow") }, { value: "block", label: phrase("记录并拦截", "Record and block") }]} value={ruleDraft.action} /></label>
          <label><span>{phrase("阈值", "Threshold")}</span><input min={1} onChange={(event) => setRuleDraft({ ...ruleDraft, threshold: Number(event.target.value) })} type="number" value={ruleDraft.threshold} /></label>
          <label><span>{phrase("统计窗口（秒）", "Window (seconds)")}</span><input min={10} onChange={(event) => setRuleDraft({ ...ruleDraft, windowSeconds: Number(event.target.value) })} type="number" value={ruleDraft.windowSeconds} /></label>
        </div>
        {ruleDraft.type === "sensitive_word" ? <label className="moderation-form-wide"><span>{phrase("关键词（逗号或换行分隔）", "Keywords (comma or line separated)")}</span><textarea maxLength={4000} onChange={(event) => setRuleDraft({ ...ruleDraft, keywords: event.target.value })} required value={ruleDraft.keywords} /></label> : null}
        <div className="moderation-source-checks">{(["article", "comment", "group_message"] as ModerationReportSource[]).map((source) => <label key={source}><input checked={ruleDraft.sources.includes(source)} onChange={(event) => setRuleDraft({ ...ruleDraft, sources: event.target.checked ? [...ruleDraft.sources, source] : ruleDraft.sources.filter((item) => item !== source) })} type="checkbox" /><span>{sourceLabel(source, phrase)}</span></label>)}<label><input checked={ruleDraft.enabled} onChange={(event) => setRuleDraft({ ...ruleDraft, enabled: event.target.checked })} type="checkbox" /><span>{phrase("启用规则", "Enable rule")}</span></label></div>
        <footer><button disabled={busy === "rule"} type="submit"><Save size={15} />{phrase("保存规则", "Save rule")}</button></footer>
      </form>
      <section className="moderation-governance-panel moderation-rule-list"><header><strong>{phrase("已配置规则", "Configured rules")}</strong><small>{phrase(`${rules.length} 条`, `${rules.length} rules`)}</small></header>{rules.length ? rules.map((rule) => <article key={rule.id} onClick={() => editRule(rule)} role="button" tabIndex={0}><span>{ruleTypeLabel(rule.type, phrase)}</span><strong>{rule.name}</strong><small>{rule.action === "block" ? phrase("拦截", "Block") : phrase("记录", "Record")} · {rule.enabled ? phrase("启用", "Enabled") : phrase("停用", "Disabled")}</small><button aria-label={phrase("删除规则", "Delete rule")} disabled={busy === `rule-${rule.id}`} onClick={(event) => { event.stopPropagation(); void remove("rule", rule.id); }} title={phrase("删除规则", "Delete rule")} type="button"><Trash2 size={15} /></button></article>) : <div className="moderation-empty">{phrase("尚未配置自动治理规则。", "No automated moderation rules configured.")}</div>}</section>
    </div>
    <div className="moderation-configuration-grid">
      <form className="moderation-governance-panel moderation-form" onSubmit={saveTemplate}><header><strong>{templateId ? phrase("编辑处理模板", "Edit response template") : phrase("新增处理模板", "New response template")}</strong><button aria-label={phrase("新建模板", "New template")} onClick={resetTemplate} title={phrase("新建模板", "New template")} type="button"><Plus size={16} /></button></header><div className="moderation-form-grid"><label><span>{phrase("名称", "Name")}</span><input maxLength={80} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} required value={templateDraft.name} /></label><label><span>{phrase("适用结果", "Outcome")}</span><GlassSelect ariaLabel={phrase("适用结果", "Outcome")} onChange={(value) => setTemplateDraft({ ...templateDraft, status: value })} options={[{ value: "resolved", label: phrase("处理", "Resolved") }, { value: "rejected", label: phrase("驳回", "Rejected") }]} value={templateDraft.status} /></label></div><label className="moderation-form-wide"><span>{phrase("反馈内容", "Feedback")}</span><textarea maxLength={500} onChange={(event) => setTemplateDraft({ ...templateDraft, content: event.target.value })} required value={templateDraft.content} /></label><label className="moderation-toggle"><input checked={templateDraft.enabled} onChange={(event) => setTemplateDraft({ ...templateDraft, enabled: event.target.checked })} type="checkbox" /><span>{phrase("启用模板", "Enable template")}</span></label><footer><button disabled={busy === "template"} type="submit"><Save size={15} />{phrase("保存模板", "Save template")}</button></footer></form>
      <section className="moderation-governance-panel moderation-rule-list"><header><strong>{phrase("处理模板", "Response templates")}</strong><small>{phrase(`${templates.length} 条`, `${templates.length} templates`)}</small></header>{templates.length ? templates.map((template) => <article key={template.id} onClick={() => editTemplate(template)} role="button" tabIndex={0}><span>{template.status === "resolved" ? phrase("处理", "Resolved") : phrase("驳回", "Rejected")}</span><strong>{template.name}</strong><small>{template.enabled ? phrase("启用", "Enabled") : phrase("停用", "Disabled")}</small><button aria-label={phrase("删除模板", "Delete template")} disabled={busy === `template-${template.id}`} onClick={(event) => { event.stopPropagation(); void remove("template", template.id); }} title={phrase("删除模板", "Delete template")} type="button"><Trash2 size={15} /></button></article>) : <div className="moderation-empty">{phrase("尚未配置反馈模板。", "No response templates configured.")}</div>}</section>
    </div>
    <form className="moderation-governance-panel moderation-form moderation-deadline-form" onSubmit={saveSettings}><header><strong>{phrase("处理时限与提醒", "Handling deadline and reminders")}</strong><small>{phrase("自动提醒在临近或超过时限时仅发送一次", "Automatic reminders are sent once when a deadline nears or passes")}</small></header>{settingsDraft ? <div className="moderation-form-grid"><label><span>{phrase("处理时限（小时）", "Deadline (hours)")}</span><input max={168} min={1} onChange={(event) => setSettingsDraft({ ...settingsDraft, deadlineHours: Number(event.target.value) })} type="number" value={settingsDraft.deadlineHours} /></label><label><span>{phrase("提前提醒（小时）", "Reminder lead time (hours)")}</span><input max={167} min={0} onChange={(event) => setSettingsDraft({ ...settingsDraft, reminderLeadHours: Number(event.target.value) })} type="number" value={settingsDraft.reminderLeadHours} /></label><label className="moderation-toggle"><input checked={settingsDraft.automaticRemindersEnabled} onChange={(event) => setSettingsDraft({ ...settingsDraft, automaticRemindersEnabled: event.target.checked })} type="checkbox" /><span>{phrase("启用自动提醒", "Enable automatic reminders")}</span></label></div> : <div className="moderation-empty">{phrase("正在读取处理时限。", "Loading handling deadline.")}</div>}<footer><button disabled={busy === "settings" || !settingsDraft} type="submit"><Save size={15} />{phrase("保存时限", "Save deadline")}</button></footer></form>
  </section>;
}

function ModerationReportRow({ report, busy, onAction, onPreview, onSelect, selected, selectable }: { report: ModerationReport; busy: boolean; onAction: (report: ModerationReport, status: ModerationActionStatus) => void; onPreview: (report: ModerationReport) => void; onSelect: (report: ModerationReport, checked: boolean) => void; selected: boolean; selectable: boolean }) {
  const { locale, phrase } = useLanguage();
  const content = report.source === "article" ? report.article?.title : report.source === "comment" ? report.comment?.body : report.message?.body || report.message?.attachments.map((item) => phrase(`附件：${item.originalName}`, `Attachment: ${item.originalName}`)).join(", ") || phrase("附件消息", "Attachment message");
  const targetLabel = report.source === "group_message" ? phrase("被举报用户", "Reported user") : report.source === "comment" ? phrase("评论作者", "Comment author") : phrase("文章作者", "Article author");
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPreview(report); } }
  return <article className={`moderation-report-row ${report.status}`} aria-label={phrase(`查看${sourceLabel(report.source, phrase)}内容`, `View ${sourceLabel(report.source, phrase).toLowerCase()} content`)} onClick={() => onPreview(report)} onKeyDown={handleKeyDown} role="button" tabIndex={0}>
    <label className="moderation-report-select" onClick={(event) => event.stopPropagation()}><input aria-label={phrase(`选择${sourceLabel(report.source, phrase)}`, `Select ${sourceLabel(report.source, phrase).toLowerCase()}`)} checked={selected} disabled={!selectable && !selected || report.status !== "pending"} onChange={(event) => onSelect(report, event.target.checked)} type="checkbox" /></label>
    <div className="moderation-report-row-main"><div className="moderation-report-row-heading"><span className={`moderation-report-source ${report.source}`}><SourceIcon source={report.source} />{sourceLabel(report.source, phrase)}</span><span className="moderation-report-reason">{reasonLabel(report.reason, phrase)}</span><span className="moderation-report-heading-meta">{targetLabel}: {report.targetUser?.nickname || phrase("未知用户", "Unknown user")}{report.group ? ` · ${report.group.name}` : ""} · {phrase("举报人", "Reporter")}: {report.reporter.nickname}</span></div><div className="moderation-report-content"><strong>{content}</strong>{report.detail ? <p title={report.detail}>{report.detail}</p> : null}</div></div>
    <aside className="moderation-report-row-side"><time>{formatTime(report.createdAt, locale)}</time><footer className="moderation-report-row-actions" onClick={(event) => event.stopPropagation()}>{report.status === "pending" ? <><button aria-label={phrase("驳回举报", "Reject report")} disabled={busy} onClick={() => onAction(report, "rejected")} title={phrase("驳回举报", "Reject report")} type="button"><X size={16} /></button><button aria-label={phrase("处理举报", "Resolve report")} className="confirm" disabled={busy} onClick={() => onAction(report, "resolved")} title={report.source === "group_message" ? phrase("处理并删除群消息", "Resolve and delete group message") : phrase("处理举报", "Resolve report")} type="button">{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}</button></> : <small>{report.status === "resolved" ? phrase("已处理", "Resolved") : phrase("已驳回", "Rejected")}</small>}</footer></aside>
  </article>;
}

function ModerationReportPreview({ report, onClose }: { report: ModerationReport; onClose: () => void }) {
  const { phrase } = useLanguage();
  if (report.source === "group_message" && report.group && report.message) return <GroupReportMessagePreview group={report.group} message={report.message} onClose={onClose} />;
  if (typeof document === "undefined") return null;
  const title = report.source === "article" ? phrase("文章名称", "Article title") : phrase("评论内容", "Comment content");
  const content = report.source === "article" ? report.article?.title : report.comment?.body;
  return createPortal(<div className="group-management-preview-backdrop" onClick={onClose} role="presentation"><section aria-modal="true" className="group-management-preview moderation-report-content-preview" onClick={(event) => event.stopPropagation()} role="dialog"><header><span><SourceIcon source={report.source} /><strong>{title}</strong></span><button aria-label={phrase("关闭内容预览", "Close content preview")} onClick={onClose} type="button"><X size={17} /></button></header><div className="group-management-preview-content moderation-report-preview-content"><div className="chat-message theirs group-report-preview-message moderation-report-preview-message"><div><p>{content || phrase("暂无内容", "No content")}</p></div></div></div></section></div>, document.body);
}

function SourceIcon({ source }: { source: ModerationReportSource }) { if (source === "article") return <FileText aria-hidden="true" size={14} />; if (source === "comment") return <MessageSquare aria-hidden="true" size={14} />; return <Flag aria-hidden="true" size={14} />; }
function sourceLabel(source: ModerationReportSource, phrase: (chinese: string, english: string) => string): string { return source === "article" ? phrase("文章举报", "Article report") : source === "comment" ? phrase("评论举报", "Comment report") : phrase("群消息举报", "Group message report"); }
function reasonLabel(reason: string, phrase: (chinese: string, english: string) => string): string { const english: Record<string, string> = { spam: "Spam", harassment: "Harassment", illegal: "Illegal content", privacy: "Privacy", misinformation: "Misinformation", other: "Other" }; return phrase(REASON_LABEL[reason] ?? reason, english[reason] ?? reason); }
function ruleTypeLabel(type: ModerationRule["type"], phrase: (chinese: string, english: string) => string): string { return type === "sensitive_word" ? phrase("敏感词", "Sensitive words") : type === "link_rate" ? phrase("链接频率", "Link frequency") : type === "duplicate_content" ? phrase("重复内容", "Duplicate content") : phrase("高频发言", "High-frequency posting"); }
function actionDescription(target: ActionTarget, mode: ResolutionMode, phrase: (chinese: string, english: string) => string): string {
  if (target.status === "rejected") return phrase("填写的反馈会记录在举报记录中，并通知举报者。", "Your feedback is saved to the report record and sent to the reporter.");
  const content = target.report.source === "article" ? phrase("文章", "article") : target.report.source === "comment" ? phrase("评论", "comment") : phrase("群消息", "group message");
  if (mode === "keep") return phrase(`举报将标记为已处理，但保留原${content}。`, `The report will be resolved and the original ${content} will remain.`);
  if (mode === "block") return phrase(`举报将标记为已处理，并屏蔽被举报${content}。`, `The report will be resolved and the reported ${content} will be blocked.`);
  return phrase(`举报将标记为已处理，并删除被举报${content}。`, `The report will be resolved and the reported ${content} will be deleted.`);
}
function formatTime(value: string, locale: "zh-CN" | "en-US"): string { return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
