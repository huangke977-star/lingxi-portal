"use client";

import { AlertTriangle, BarChart3, Check, ChevronLeft, ChevronRight, ClipboardCheck, FileText, Flag, LoaderCircle, MessageSquare, Plus, Save, Settings2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AdminArticlePreviewModal } from "@/components/admin-article-preview-modal";
import { AppToast } from "@/components/app-toast";
import { GroupReportMessagePreview } from "@/components/group-report-message-preview";
import { GlassSelect } from "@/components/glass-select";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
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

const RESOLUTION_OPTIONS: Record<ModerationReportSource, Array<{ label: string; value: ResolutionMode }>> = {
  article: [
    { value: "keep", label: "处理但不修改文章" },
    { value: "block", label: "屏蔽文章" },
    { value: "delete", label: "删除文章" },
  ],
  comment: [
    { value: "keep", label: "处理但保留评论" },
    { value: "block", label: "屏蔽评论" },
    { value: "delete", label: "删除评论" },
  ],
  group_message: [
    { value: "keep", label: "处理但保留消息" },
    { value: "delete", label: "处理并删除消息" },
  ],
};

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
      setError(loadError instanceof Error ? loadError.message : "内容治理数据读取失败。");
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
    const feedback = resolution.trim() || (nextStatus === "resolved" ? "举报已处理。" : "未发现违规。");
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
      setNotice(nextStatus === "resolved" ? "举报已处理。" : "举报已驳回。");
      await load(token, page);
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "举报处理失败。"); }
    finally { setBusyKey(""); }
  }

  async function submitBatchAction() {
    const token = readAccessToken();
    if (!token || !batchStatus || !selectedIds.length) return;
    const selected = items.filter((item) => selectedIds.includes(item.id));
    const selectedSource = selected[0]?.source;
    if (!selectedSource || selected.some((item) => item.source !== selectedSource)) {
      setError("批量处理一次只能选择同一种举报来源。");
      return;
    }
    setBusyKey("batch");
    try {
      const result = await bulkHandleModerationReports(token, {
        source: selectedSource,
        reportIds: selectedIds,
        status: batchStatus,
        resolution: resolution.trim() || (batchStatus === "resolved" ? "举报已处理。" : "未发现违规。"),
      });
      setBatchStatus(null);
      setSelectedIds([]);
      setResolution("");
      setTemplateId("manual");
      setNotice(result.failed.length ? `已处理 ${result.succeeded.length} 条，${result.failed.length} 条未处理。` : `已批量处理 ${result.succeeded.length} 条举报。`);
      await load(token, page);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "批量处理失败。");
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
        router.replace("/login?from=%2Fadmin%2Freports");
        return;
      }
      setError(previewError instanceof Error ? previewError.message : "文章内容加载失败。");
    }
  }

  if (!user && isLoading && !error) return <section className="page-shell moderation-reports-page"><div className="article-empty-state"><LoaderCircle className="spin" size={22} />正在打开举报中心。</div></section>;
  return <section className="page-shell moderation-reports-page">
    <header className="moderation-reports-header"><div><span className="page-kicker">CONTENT MODERATION</span><h1>举报中心</h1><p>统一处理举报、规则命中和处理时限。</p></div><div className="moderation-summary"><span><b>{summary.pending}</b><small>待处理</small></span><span><b>{overview?.reports.overdue ?? 0}</b><small>已超时</small></span><span><b>{summary.total}</b><small>全部记录</small></span></div></header>
    <nav aria-label="举报中心功能" className="moderation-admin-tabs">
      <button className={view === "queue" ? "active" : ""} onClick={() => setView("queue")} type="button"><ClipboardCheck size={15} />举报队列</button>
      <button className={view === "insights" ? "active" : ""} onClick={() => setView("insights")} type="button"><BarChart3 size={15} />规则命中与统计</button>
      {user?.isSuperAdmin ? <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")} type="button"><Settings2 size={15} />规则与自动化</button> : null}
    </nav>
    {view === "queue" ? <>
      <div className="moderation-reports-toolbar"><div className="moderation-filter-group"><GlassSelect ariaLabel="举报状态" onChange={setStatus} options={Object.entries(STATUS_LABEL).map(([value, label]) => ({ value: value as ModerationReportStatus | "all", label }))} value={status} /><GlassSelect ariaLabel="举报来源" onChange={setSource} options={Object.entries(SOURCE_LABEL).map(([value, label]) => ({ value: value as ModerationReportSource | "all", label }))} value={source} /></div><div className="moderation-source-summary"><span><FileText aria-hidden="true" size={14} />文章 {summary.bySource.article}</span><span><MessageSquare aria-hidden="true" size={14} />评论 {summary.bySource.comment}</span><span><Flag aria-hidden="true" size={14} />群消息 {summary.bySource.group_message}</span></div></div>
      {selectedIds.length ? <div className="moderation-batch-bar"><span>已选择 {selectedIds.length} 条同类举报</span><div><button disabled={busyKey === "batch"} onClick={() => { setBatchStatus("rejected"); setResolution(""); setTemplateId("manual"); }} type="button">批量驳回</button><button disabled={busyKey === "batch"} onClick={() => { setBatchStatus("resolved"); setResolution(""); setTemplateId("manual"); }} type="button">批量处理</button><button aria-label="取消选择" onClick={() => setSelectedIds([])} title="取消选择" type="button"><X size={15} /></button></div></div> : null}
      {isLoading ? <div className="article-empty-state"><LoaderCircle className="spin" size={22} />正在读取举报队列。</div> : items.length ? <div className="moderation-report-list">{items.map((report) => <ModerationReportRow busy={busyKey === report.key} key={report.key} onAction={(nextReport, nextStatus) => { setActionTarget({ report: nextReport, status: nextStatus }); setResolutionMode(nextStatus === "resolved" && nextReport.source === "group_message" ? "delete" : "keep"); setResolution(""); setTemplateId("manual"); }} onPreview={(nextReport) => void openPreview(nextReport)} onSelect={toggleSelection} report={report} selected={selectedIds.includes(report.id)} selectable={!selectedIds.length || items.filter((item) => selectedIds.includes(item.id)).every((item) => item.source === report.source)} />)}</div> : <div className="article-empty-state"><AlertTriangle size={22} />当前筛选下没有举报记录。</div>}
      {totalPages > 1 ? <footer className="moderation-pagination"><button aria-label="上一页" disabled={page <= 1 || isLoading} onClick={() => { const next = page - 1; setPage(next); const token = readAccessToken(); if (token) void load(token, next); }} type="button"><ChevronLeft size={16} /></button><span>第 {page} / {totalPages} 页 · 共 {total} 条</span><button aria-label="下一页" disabled={page >= totalPages || isLoading} onClick={() => { const next = page + 1; setPage(next); const token = readAccessToken(); if (token) void load(token, next); }} type="button"><ChevronRight size={16} /></button></footer> : null}
    </> : null}
    {view === "insights" ? <ModerationInsights overview={overview} ruleHits={ruleHits} /> : null}
    {view === "settings" && user?.isSuperAdmin ? <ModerationConfiguration key={settings?.updatedAt ?? "loading"} onError={setError} onNotice={setNotice} onRefresh={() => void loadGovernance()} rules={rules} settings={settings} templates={templates} /> : null}
    {previewReport ? <ModerationReportPreview report={previewReport} onClose={() => setPreviewReport(null)} /> : null}
    {previewArticle ? <AdminArticlePreviewModal article={previewArticle} onClose={() => setPreviewArticle(null)} /> : null}
    {actionTarget ? <div className="modal-backdrop moderation-action-backdrop" role="presentation"><form aria-modal="true" className="moderation-action-dialog" onSubmit={(event) => { event.preventDefault(); void submitAction(); }} role="dialog"><header><span><AlertTriangle size={17} /><strong>{actionTarget.status === "resolved" ? "处理举报" : "驳回举报"}</strong></span><button aria-label="关闭" onClick={() => setActionTarget(null)} type="button"><X size={17} /></button></header>{actionTarget.status === "resolved" ? <label className="moderation-action-field"><span>处理方式</span><GlassSelect ariaLabel="处理方式" onChange={setResolutionMode} options={RESOLUTION_OPTIONS[actionTarget.report.source]} value={resolutionMode} /></label> : null}<label className="moderation-action-field"><span>处理模板</span><GlassSelect ariaLabel="处理模板" onChange={chooseTemplate} options={[{ value: "manual", label: "手动填写" }, ...templates.filter((item) => item.status === actionTarget.status).map((item) => ({ value: String(item.id), label: item.name }))]} value={templateId} /></label><p>{actionDescription(actionTarget, resolutionMode)}</p><textarea autoFocus maxLength={500} onChange={(event) => setResolution(event.target.value)} placeholder="填写处理反馈" required value={resolution} /><footer><button onClick={() => setActionTarget(null)} type="button">取消</button><button disabled={busyKey === actionTarget.report.key} type="submit">{busyKey === actionTarget.report.key ? "处理中" : "确认"}</button></footer></form></div> : null}
    {batchStatus ? <div className="modal-backdrop moderation-action-backdrop" role="presentation"><form aria-modal="true" className="moderation-action-dialog" onSubmit={(event) => { event.preventDefault(); void submitBatchAction(); }} role="dialog"><header><span><ClipboardCheck size={17} /><strong>{batchStatus === "resolved" ? "批量处理举报" : "批量驳回举报"}</strong></span><button aria-label="关闭" onClick={() => setBatchStatus(null)} type="button"><X size={17} /></button></header><label className="moderation-action-field"><span>处理模板</span><GlassSelect ariaLabel="批量处理模板" onChange={chooseTemplate} options={[{ value: "manual", label: "手动填写" }, ...templates.filter((item) => item.status === batchStatus).map((item) => ({ value: String(item.id), label: item.name }))]} value={templateId} /></label><p>批量操作将保留原内容，并逐条发送处理结果通知。</p><textarea autoFocus maxLength={500} onChange={(event) => setResolution(event.target.value)} placeholder="填写统一处理反馈" required value={resolution} /><footer><button onClick={() => setBatchStatus(null)} type="button">取消</button><button disabled={busyKey === "batch"} type="submit">{busyKey === "batch" ? "处理中" : "确认"}</button></footer></form></div> : null}
    <AppToast duration={error ? 4200 : 2800} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function ModerationInsights({ overview, ruleHits }: { overview: ModerationOverview | null; ruleHits: ModerationRuleHit[] }) {
  if (!overview) return <div className="article-empty-state"><LoaderCircle className="spin" size={22} />正在读取治理统计。</div>;
  return <section className="moderation-insights" aria-label="内容治理统计">
    <div className="moderation-overview-grid">
      <Statistic label="待处理" value={overview.reports.pending} />
      <Statistic label="已超时" tone="warning" value={overview.reports.overdue} />
      <Statistic label="近 7 日命中" value={overview.ruleHits.last7Days} />
      <Statistic label="平均处理时长" value={overview.reports.averageHandleMinutes === null ? "--" : `${overview.reports.averageHandleMinutes} 分`} />
    </div>
    <div className="moderation-governance-panel"><header><strong>处理队列</strong><small>按来源统计未完成举报与超时数量</small></header><div className="moderation-metric-lines">{(["article", "comment", "group_message"] as ModerationReportSource[]).map((source) => <div key={source}><span>{SOURCE_LABEL[source]}</span><b>{overview.reports.bySource[source].pending} 待处理</b><small>{overview.reports.bySource[source].overdue} 超时 / {overview.reports.bySource[source].total} 总数</small></div>)}</div></div>
    <div className="moderation-governance-panel"><header><strong>最近规则命中</strong><small>最近 30 天 {overview.ruleHits.last30Days} 次</small></header>{ruleHits.length ? <div className="moderation-hit-list">{ruleHits.map((hit) => <article key={hit.id}><span>{ruleTypeLabel(hit.rule.type)}</span><strong>{hit.rule.name}</strong><p>{hit.detail}：{hit.contentPreview}</p><time>{formatTime(hit.createdAt)}</time></article>)}</div> : <div className="moderation-empty">暂无规则命中记录。</div>}</div>
  </section>;
}

function Statistic({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return <div className={`moderation-statistic ${tone}`}><b>{value}</b><span>{label}</span></div>;
}

function ModerationConfiguration({ rules, templates, settings, onRefresh, onNotice, onError }: { rules: ModerationRule[]; templates: ModerationTemplate[]; settings: ModerationSettings | null; onRefresh: () => void; onNotice: (value: string) => void; onError: (value: string) => void }) {
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
    try { if (ruleId) await updateModerationRule(token, ruleId, { ...ruleDraft }); else await createModerationRule(token, ruleDraft); resetRule(); onNotice("治理规则已保存。"); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : "规则保存失败。"); } finally { setBusy(""); }
  }
  async function saveTemplate(event: FormEvent) {
    event.preventDefault(); const token = readAccessToken(); if (!token) return;
    setBusy("template");
    try { if (templateId) await updateModerationTemplate(token, templateId, templateDraft); else await createModerationTemplate(token, templateDraft); resetTemplate(); onNotice("处理模板已保存。"); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : "模板保存失败。"); } finally { setBusy(""); }
  }
  async function saveSettings(event: FormEvent) {
    event.preventDefault(); const token = readAccessToken(); if (!token || !settingsDraft) return;
    setBusy("settings");
    try { await updateModerationSettings(token, { deadlineHours: Number(settingsDraft.deadlineHours), reminderLeadHours: Number(settingsDraft.reminderLeadHours), automaticRemindersEnabled: settingsDraft.automaticRemindersEnabled }); onNotice("处理时限已保存。"); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : "处理时限保存失败。"); } finally { setBusy(""); }
  }
  async function remove(kind: "rule" | "template", id: number) {
    const token = readAccessToken(); if (!token) return; setBusy(`${kind}-${id}`);
    try { if (kind === "rule") await deleteModerationRule(token, id); else await deleteModerationTemplate(token, id); onNotice(kind === "rule" ? "治理规则已删除。" : "处理模板已删除。"); onRefresh(); } catch (error) { onError(error instanceof Error ? error.message : "删除失败。"); } finally { setBusy(""); }
  }
  return <section className="moderation-configuration">
    <div className="moderation-configuration-grid">
      <form className="moderation-governance-panel moderation-form" onSubmit={saveRule}><header><strong>{ruleId ? "编辑治理规则" : "新增治理规则"}</strong><button aria-label="新建规则" onClick={resetRule} title="新建规则" type="button"><Plus size={16} /></button></header><div className="moderation-form-grid"><label><span>名称</span><input maxLength={80} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} required value={ruleDraft.name} /></label><label><span>规则类型</span><GlassSelect ariaLabel="规则类型" disabled={Boolean(ruleId)} onChange={(value) => setRuleDraft({ ...ruleDraft, type: value })} options={[{ value: "sensitive_word", label: "敏感词" }, { value: "link_rate", label: "链接频率" }, { value: "duplicate_content", label: "重复内容" }, { value: "high_frequency", label: "高频发言" }]} value={ruleDraft.type} /></label><label><span>命中动作</span><GlassSelect ariaLabel="命中动作" onChange={(value) => setRuleDraft({ ...ruleDraft, action: value })} options={[{ value: "record", label: "记录但放行" }, { value: "block", label: "记录并拦截" }]} value={ruleDraft.action} /></label><label><span>阈值</span><input min={1} onChange={(event) => setRuleDraft({ ...ruleDraft, threshold: Number(event.target.value) })} type="number" value={ruleDraft.threshold} /></label><label><span>统计窗口（秒）</span><input min={10} onChange={(event) => setRuleDraft({ ...ruleDraft, windowSeconds: Number(event.target.value) })} type="number" value={ruleDraft.windowSeconds} /></label></div>{ruleDraft.type === "sensitive_word" ? <label className="moderation-form-wide"><span>关键词（逗号或换行分隔）</span><textarea maxLength={4000} onChange={(event) => setRuleDraft({ ...ruleDraft, keywords: event.target.value })} required value={ruleDraft.keywords} /></label> : null}<div className="moderation-source-checks">{(["article", "comment", "group_message"] as ModerationReportSource[]).map((source) => <label key={source}><input checked={ruleDraft.sources.includes(source)} onChange={(event) => setRuleDraft({ ...ruleDraft, sources: event.target.checked ? [...ruleDraft.sources, source] : ruleDraft.sources.filter((item) => item !== source) })} type="checkbox" /><span>{SOURCE_LABEL[source]}</span></label>)}<label><input checked={ruleDraft.enabled} onChange={(event) => setRuleDraft({ ...ruleDraft, enabled: event.target.checked })} type="checkbox" /><span>启用规则</span></label></div><footer><button disabled={busy === "rule"} type="submit"><Save size={15} />保存规则</button></footer></form>
      <section className="moderation-governance-panel moderation-rule-list"><header><strong>已配置规则</strong><small>{rules.length} 条</small></header>{rules.length ? rules.map((rule) => <article key={rule.id} onClick={() => editRule(rule)} role="button" tabIndex={0}><span>{ruleTypeLabel(rule.type)}</span><strong>{rule.name}</strong><small>{rule.action === "block" ? "拦截" : "记录"} · {rule.enabled ? "启用" : "停用"}</small><button aria-label="删除规则" disabled={busy === `rule-${rule.id}`} onClick={(event) => { event.stopPropagation(); void remove("rule", rule.id); }} title="删除规则" type="button"><Trash2 size={15} /></button></article>) : <div className="moderation-empty">尚未配置自动治理规则。</div>}</section>
    </div>
    <div className="moderation-configuration-grid">
      <form className="moderation-governance-panel moderation-form" onSubmit={saveTemplate}><header><strong>{templateId ? "编辑处理模板" : "新增处理模板"}</strong><button aria-label="新建模板" onClick={resetTemplate} title="新建模板" type="button"><Plus size={16} /></button></header><div className="moderation-form-grid"><label><span>名称</span><input maxLength={80} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} required value={templateDraft.name} /></label><label><span>适用结果</span><GlassSelect ariaLabel="适用结果" onChange={(value) => setTemplateDraft({ ...templateDraft, status: value })} options={[{ value: "resolved", label: "处理" }, { value: "rejected", label: "驳回" }]} value={templateDraft.status} /></label></div><label className="moderation-form-wide"><span>反馈内容</span><textarea maxLength={500} onChange={(event) => setTemplateDraft({ ...templateDraft, content: event.target.value })} required value={templateDraft.content} /></label><label className="moderation-toggle"><input checked={templateDraft.enabled} onChange={(event) => setTemplateDraft({ ...templateDraft, enabled: event.target.checked })} type="checkbox" /><span>启用模板</span></label><footer><button disabled={busy === "template"} type="submit"><Save size={15} />保存模板</button></footer></form>
      <section className="moderation-governance-panel moderation-rule-list"><header><strong>处理模板</strong><small>{templates.length} 条</small></header>{templates.length ? templates.map((template) => <article key={template.id} onClick={() => editTemplate(template)} role="button" tabIndex={0}><span>{template.status === "resolved" ? "处理" : "驳回"}</span><strong>{template.name}</strong><small>{template.enabled ? "启用" : "停用"}</small><button aria-label="删除模板" disabled={busy === `template-${template.id}`} onClick={(event) => { event.stopPropagation(); void remove("template", template.id); }} title="删除模板" type="button"><Trash2 size={15} /></button></article>) : <div className="moderation-empty">尚未配置反馈模板。</div>}</section>
    </div>
    <form className="moderation-governance-panel moderation-form moderation-deadline-form" onSubmit={saveSettings}><header><strong>处理时限与提醒</strong><small>自动提醒在临近或超过时限时仅发送一次</small></header>{settingsDraft ? <div className="moderation-form-grid"><label><span>处理时限（小时）</span><input max={168} min={1} onChange={(event) => setSettingsDraft({ ...settingsDraft, deadlineHours: Number(event.target.value) })} type="number" value={settingsDraft.deadlineHours} /></label><label><span>提前提醒（小时）</span><input max={167} min={0} onChange={(event) => setSettingsDraft({ ...settingsDraft, reminderLeadHours: Number(event.target.value) })} type="number" value={settingsDraft.reminderLeadHours} /></label><label className="moderation-toggle"><input checked={settingsDraft.automaticRemindersEnabled} onChange={(event) => setSettingsDraft({ ...settingsDraft, automaticRemindersEnabled: event.target.checked })} type="checkbox" /><span>启用自动提醒</span></label></div> : <div className="moderation-empty">正在读取处理时限。</div>}<footer><button disabled={busy === "settings" || !settingsDraft} type="submit"><Save size={15} />保存时限</button></footer></form>
  </section>;
}

function ModerationReportRow({ report, busy, onAction, onPreview, onSelect, selected, selectable }: { report: ModerationReport; busy: boolean; onAction: (report: ModerationReport, status: ModerationActionStatus) => void; onPreview: (report: ModerationReport) => void; onSelect: (report: ModerationReport, checked: boolean) => void; selected: boolean; selectable: boolean }) {
  const content = report.source === "article" ? report.article?.title : report.source === "comment" ? report.comment?.body : report.message?.body || report.message?.attachments.map((item) => `附件：${item.originalName}`).join("、") || "附件消息";
  const targetLabel = report.source === "group_message" ? "被举报用户" : report.source === "comment" ? "评论作者" : "文章作者";
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPreview(report); } }
  return <article className={`moderation-report-row ${report.status}`} aria-label={`查看${report.sourceLabel}内容`} onClick={() => onPreview(report)} onKeyDown={handleKeyDown} role="button" tabIndex={0}>
    <label className="moderation-report-select" onClick={(event) => event.stopPropagation()}><input aria-label={`选择${report.sourceLabel}`} checked={selected} disabled={!selectable && !selected || report.status !== "pending"} onChange={(event) => onSelect(report, event.target.checked)} type="checkbox" /></label>
    <div className="moderation-report-row-main"><div className="moderation-report-row-heading"><span className={`moderation-report-source ${report.source}`}><SourceIcon source={report.source} />{report.sourceLabel}</span><span className="moderation-report-reason">{REASON_LABEL[report.reason] ?? report.reason}</span><span className="moderation-report-heading-meta">{targetLabel}：{report.targetUser?.nickname || "未知用户"}{report.group ? ` · ${report.group.name}` : ""} · 举报人：{report.reporter.nickname}</span></div><div className="moderation-report-content"><strong>{content}</strong>{report.detail ? <p title={report.detail}>{report.detail}</p> : null}</div></div>
    <aside className="moderation-report-row-side"><time>{formatTime(report.createdAt)}</time><footer className="moderation-report-row-actions" onClick={(event) => event.stopPropagation()}>{report.status === "pending" ? <><button aria-label="驳回举报" disabled={busy} onClick={() => onAction(report, "rejected")} title="驳回举报" type="button"><X size={16} /></button><button aria-label="处理举报" className="confirm" disabled={busy} onClick={() => onAction(report, "resolved")} title={report.source === "group_message" ? "处理并删除群消息" : "处理举报"} type="button">{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}</button></> : <small>{report.status === "resolved" ? "已处理" : "已驳回"}</small>}</footer></aside>
  </article>;
}

function ModerationReportPreview({ report, onClose }: { report: ModerationReport; onClose: () => void }) {
  if (report.source === "group_message" && report.group && report.message) return <GroupReportMessagePreview group={report.group} message={report.message} onClose={onClose} />;
  if (typeof document === "undefined") return null;
  const title = report.source === "article" ? "文章名称" : "评论内容";
  const content = report.source === "article" ? report.article?.title : report.comment?.body;
  return createPortal(<div className="group-management-preview-backdrop" onClick={onClose} role="presentation"><section aria-modal="true" className="group-management-preview moderation-report-content-preview" onClick={(event) => event.stopPropagation()} role="dialog"><header><span><SourceIcon source={report.source} /><strong>{title}</strong></span><button aria-label="关闭内容预览" onClick={onClose} type="button"><X size={17} /></button></header><div className="group-management-preview-content moderation-report-preview-content"><div className="chat-message theirs group-report-preview-message moderation-report-preview-message"><div><p>{content || "暂无内容"}</p></div></div></div></section></div>, document.body);
}

function SourceIcon({ source }: { source: ModerationReportSource }) { if (source === "article") return <FileText aria-hidden="true" size={14} />; if (source === "comment") return <MessageSquare aria-hidden="true" size={14} />; return <Flag aria-hidden="true" size={14} />; }
function ruleTypeLabel(type: ModerationRule["type"]): string { return type === "sensitive_word" ? "敏感词" : type === "link_rate" ? "链接频率" : type === "duplicate_content" ? "重复内容" : "高频发言"; }
function actionDescription(target: ActionTarget, mode: ResolutionMode): string {
  if (target.status === "rejected") return "填写的反馈会记录在举报记录中，并通知举报者。";
  if (mode === "keep") return `举报将标记为已处理，但保留原${target.report.source === "article" ? "文章" : target.report.source === "comment" ? "评论" : "群消息"}。`;
  if (mode === "block") return `举报将标记为已处理，并屏蔽被举报${target.report.source === "article" ? "文章" : "评论"}。`;
  return `举报将标记为已处理，并删除被举报${target.report.source === "article" ? "文章" : target.report.source === "comment" ? "评论" : "群消息"}。`;
}
function formatTime(value: string): string { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }
