"use client";

import { Ban, Check, Flag, LoaderCircle, Search, ShieldOff, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { getMe, isAuthExpiredError, resolveApiUrl } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  banChatGroup,
  downloadChatAttachment,
  downloadChatAttachmentThumbnail,
  handleChatGroupReport,
  liftChatGroupBan,
  listAdminChatGroups,
  listChatGroupReports,
  type ChatAttachment,
  type ChatGroupReport,
  type ChatGroupSummary,
  type SocialUser,
} from "@/lib/social-api";

type ManagerTab = "groups" | "reports";
type ReportStatus = "pending" | "resolved" | "rejected";

export default function GroupReportsAdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<ManagerTab>("groups");
  const [groups, setGroups] = useState<ChatGroupSummary[]>([]);
  const [reports, setReports] = useState<ChatGroupReport[]>([]);
  const [reportStatus, setReportStatus] = useState<ReportStatus>("pending");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState("");
  const [banTarget, setBanTarget] = useState<ChatGroupSummary | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [reason, setReason] = useState("");
  const [previewReport, setPreviewReport] = useState<ChatGroupReport | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login?from=%2Fadmin%2Fgroups");
      return;
    }
    let active = true;
    // The request lifecycle owns this loading flag; this local reset avoids stale results when filters change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    Promise.all([getMe(token), listAdminChatGroups(token, search), listChatGroupReports(token, undefined, reportStatus)])
      .then(([currentUser, groupResult, reportResult]) => {
        if (!active) return;
        if (!(currentUser.isSuperAdmin || currentUser.role.level >= 90)) {
          router.replace("/");
          return;
        }
        setGroups(groupResult.items);
        setReports(reportResult.items);
      })
      .catch((loadError) => {
        if (!active) return;
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "群聊管理读取失败。");
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [reportStatus, router, search]);

  const filteredReports = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return reports;
    return reports.filter((report) => [
      report.group.name,
      report.message.body,
      report.message.sender.nickname,
      report.reporter.nickname,
      report.detail ?? "",
    ].some((value) => value.toLocaleLowerCase().includes(keyword)));
  }, [reports, search]);

  function openBanDialog(group: ChatGroupSummary) {
    setBanTarget(group);
    setPermanent(false);
    setDurationMinutes(60);
    setReason(group.banReason ?? "");
  }

  async function submitBan() {
    const token = readAccessToken();
    if (!token || !banTarget) return;
    if (reason.trim().length < 2) {
      setError("请填写至少 2 个字符的封禁理由。");
      return;
    }
    if (!permanent && (!Number.isInteger(durationMinutes) || durationMinutes < 1)) {
      setError("限时封禁至少需要 1 分钟。");
      return;
    }
    setBusyKey(`ban:${banTarget.id}`);
    try {
      const updated = await banChatGroup(token, banTarget.id, { permanent, durationMinutes, reason: reason.trim() });
      setGroups((current) => current.map((group) => group.id === updated.id ? updated : group));
      setBanTarget(null);
      setNotice("群聊已封禁，群主和管理员将收到系统通知。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "群聊封禁失败。");
    } finally {
      setBusyKey("");
    }
  }

  async function liftBan(group: ChatGroupSummary) {
    const token = readAccessToken();
    if (!token) return;
    setBusyKey(`lift:${group.id}`);
    try {
      const updated = await liftChatGroupBan(token, group.id);
      setGroups((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice("群聊封禁已解除。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "解除封禁失败。");
    } finally {
      setBusyKey("");
    }
  }

  async function handleReport(report: ChatGroupReport, status: "resolved" | "rejected") {
    const token = readAccessToken();
    if (!token) return;
    setBusyKey(`report:${report.id}`);
    try {
      await handleChatGroupReport(token, report.id, {
        status,
        deleteMessage: status === "resolved",
        resolution: status === "resolved" ? "站点管理员已处理" : "未发现违规",
      });
      setReports((current) => current.filter((item) => item.id !== report.id));
      setNotice(status === "resolved" ? "举报已处理，消息已删除。" : "举报已驳回。");
      setPreviewReport(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "举报处理失败。");
    } finally {
      setBusyKey("");
    }
  }

  return <section className="page-shell group-management-admin-page">
    <header className="group-management-admin-header"><div><span className="page-kicker">SITE MODERATION</span><h1>群聊管理</h1><p>管理全站群聊状态，并集中处理群聊举报。</p></div><span className="group-management-admin-summary"><b>{groups.length}</b><small>个群聊</small></span></header>
    <div className="group-management-admin-toolbar">
      <nav aria-label="群聊管理页签"><button className={tab === "groups" ? "active" : ""} onClick={() => setTab("groups")} type="button"><ShieldOff aria-hidden="true" size={16} />群聊列表</button><button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")} type="button"><Flag aria-hidden="true" size={16} />群聊举报{reportStatus === "pending" && reports.length ? <b>{reports.length}</b> : null}</button></nav>
      <label className="group-management-search"><Search aria-hidden="true" size={16} /><input aria-label="搜索群聊管理内容" onChange={(event) => setSearch(event.target.value)} placeholder="搜索群名称、成员或内容" value={search} />{search ? <button aria-label="清空搜索" onClick={() => setSearch("")} type="button"><X aria-hidden="true" size={14} /></button> : null}</label>
    </div>
    {tab === "reports" ? <div className="group-management-report-filter"><nav aria-label="举报状态"><button className={reportStatus === "pending" ? "active" : ""} onClick={() => setReportStatus("pending")} type="button">待处理</button><button className={reportStatus === "resolved" ? "active" : ""} onClick={() => setReportStatus("resolved")} type="button">已处理</button><button className={reportStatus === "rejected" ? "active" : ""} onClick={() => setReportStatus("rejected")} type="button">已驳回</button></nav></div> : null}
    {isLoading ? <div className="article-empty-state"><LoaderCircle aria-hidden="true" className="spin" size={22} />正在读取群聊管理数据。</div> : tab === "groups" ? <GroupAdminGrid groups={groups} busyKey={busyKey} onBan={openBanDialog} onLift={liftBan} onOpenProfile={(username) => router.push(`/users/${encodeURIComponent(username)}`)} /> : <ReportAdminGrid reports={filteredReports} status={reportStatus} busyKey={busyKey} onHandle={handleReport} onOpenProfile={(username) => router.push(`/users/${encodeURIComponent(username)}`)} onPreview={setPreviewReport} />}
    {banTarget ? <div className="group-management-modal-backdrop" onClick={() => setBanTarget(null)} role="presentation"><section aria-modal="true" className="group-management-ban-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><header><span><Ban aria-hidden="true" size={18} /><strong>{banTarget.isBanned ? "调整群聊封禁" : "封禁群聊"}</strong></span><button aria-label="关闭封禁窗口" onClick={() => setBanTarget(null)} type="button"><X aria-hidden="true" size={17} /></button></header><p>群成员仍可进入并查看历史消息，但无法发送文字、图片、文件或转发内容。</p><label className="group-management-switch"><input checked={permanent} onChange={(event) => setPermanent(event.target.checked)} type="checkbox" /><span>永久封禁</span></label>{!permanent ? <label><span>封禁时长（分钟）</span><input min={1} max={525600} onChange={(event) => setDurationMinutes(Number(event.target.value))} type="number" value={durationMinutes} /></label> : null}<label><span>封禁理由</span><textarea maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="说明封禁原因" rows={4} value={reason} /></label><footer><button onClick={() => setBanTarget(null)} type="button">取消</button><button disabled={busyKey === `ban:${banTarget.id}`} onClick={() => void submitBan()} type="button">{busyKey === `ban:${banTarget.id}` ? "处理中" : "确认封禁"}</button></footer></section></div> : null}
    {previewReport ? <ReportPreview report={previewReport} onClose={() => setPreviewReport(null)} /> : null}
    <AppToast duration={error ? 4200 : 2800} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function GroupAdminGrid({ groups, busyKey, onBan, onLift, onOpenProfile }: { groups: ChatGroupSummary[]; busyKey: string; onBan: (group: ChatGroupSummary) => void; onLift: (group: ChatGroupSummary) => Promise<void>; onOpenProfile: (username: string) => void }) {
  if (!groups.length) return <div className="article-empty-state">当前没有匹配的群聊。</div>;
  return <div className="group-admin-grid">{groups.map((group) => <article className={`group-admin-card${group.isBanned ? " banned" : ""}`} key={group.id}>
    <div className="group-admin-card-cover">{group.avatarUrl ? <img alt="" src={resolveApiUrl(group.avatarUrl)} /> : <strong>{fallbackText(group.name)}</strong>}<span>{group.isBanned ? <><Ban aria-hidden="true" size={14} />已封禁</> : "正常"}</span></div>
    <div className="group-admin-card-body"><div className="group-admin-card-title"><strong>{group.name}</strong><small>{group.memberCount} 人 · {group.temporary ? "临时群聊" : "长期群聊"}</small></div><p>{group.announcement || "暂无群介绍"}</p><button className="group-admin-owner" onClick={() => onOpenProfile(group.owner.username)} title={`查看群主 ${group.owner.nickname}`} type="button"><Avatar user={group.owner} /><span><small>群主</small><strong>{group.owner.nickname}</strong></span><UserRound aria-hidden="true" size={14} /></button><footer>{group.isBanned ? <button className="icon-action" disabled={busyKey === `lift:${group.id}`} onClick={() => void onLift(group)} title="解除封禁" type="button">{busyKey === `lift:${group.id}` ? <LoaderCircle className="spin" size={16} /> : <ShieldOff aria-hidden="true" size={16} />}</button> : <button className="icon-action danger" disabled={busyKey === `ban:${group.id}`} onClick={() => onBan(group)} title="封禁群聊" type="button">{busyKey === `ban:${group.id}` ? <LoaderCircle className="spin" size={16} /> : <Ban aria-hidden="true" size={16} />}</button>}<small>{group.isBanned ? group.bannedUntil ? `至 ${formatMinute(group.bannedUntil)}` : "永久封禁" : "允许正常发言"}</small></footer></div>
  </article>)}</div>;
}

function ReportAdminGrid({ reports, status, busyKey, onHandle, onOpenProfile, onPreview }: { reports: ChatGroupReport[]; status: ReportStatus; busyKey: string; onHandle: (report: ChatGroupReport, status: "resolved" | "rejected") => Promise<void>; onOpenProfile: (username: string) => void; onPreview: (report: ChatGroupReport) => void }) {
  if (!reports.length) return <div className="article-empty-state">当前没有匹配的群聊举报。</div>;
  return <div className="group-admin-grid report-admin-grid">{reports.map((report) => {
    const image = report.message.attachments?.find((attachment) => attachment.kind === "image");
    const file = report.message.attachments?.find((attachment) => attachment.kind === "file");
    return <article className="group-admin-card report-admin-card" key={report.id}>
      <div className="report-admin-content"><strong>被举报内容</strong><button onClick={() => onPreview(report)} title="查看完整举报内容" type="button">{report.message.body ? <span>{report.message.body}</span> : image ? <ReportCardImage attachment={image} /> : file ? <span className="report-admin-file-excerpt">文件：{file.originalName}</span> : <span>附件消息，点击查看</span>}</button></div>
      <div className="group-admin-card-body">
        <div className="report-admin-identities"><button onClick={() => onOpenProfile(report.message.sender.username)} title={`查看 ${report.message.sender.nickname}`} type="button"><Avatar user={report.message.sender} /><span>{report.message.sender.nickname}</span></button><span className="report-admin-arrow">被举报</span><button onClick={() => onOpenProfile(report.reporter.username)} title={`查看 ${report.reporter.nickname}`} type="button"><Avatar user={report.reporter} /><span>{report.reporter.nickname}</span></button></div>
        <div className="report-admin-group"><GroupAvatar group={report.group} /><div className="group-admin-card-title"><strong>{report.group.name}</strong><small>{formatMinute(report.createdAt)} · {report.reason}</small></div></div>
        <p>{report.detail || "未填写补充说明"}</p>
        <footer>{status === "pending" ? <><button className="icon-action" disabled={busyKey === `report:${report.id}`} onClick={() => void onHandle(report, "rejected")} title="驳回举报" type="button"><X aria-hidden="true" size={16} /></button><button className="icon-action danger" disabled={busyKey === `report:${report.id}`} onClick={() => void onHandle(report, "resolved")} title="处理并删除消息" type="button"><Check aria-hidden="true" size={16} /></button></> : <small className="report-admin-status">{status === "resolved" ? "已处理" : "已驳回"}</small>}</footer>
      </div>
    </article>;
  })}</div>;
}

function ReportCardImage({ attachment }: { attachment: ChatAttachment }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const token = readAccessToken();
    if (!token) return;
    let active = true;
    let objectUrl = "";
    downloadChatAttachmentThumbnail(token, attachment).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attachment]);
  return url ? <img alt={attachment.originalName} src={url} /> : <span>正在读取图片</span>;
}

function ReportPreview({ report, onClose }: { report: ChatGroupReport; onClose: () => void }) {
  return <div className="group-management-preview-backdrop" onClick={onClose} role="presentation"><section aria-modal="true" className="group-management-preview" onClick={(event) => event.stopPropagation()} role="dialog"><header><span className="report-admin-group"><GroupAvatar group={report.group} /><strong>{report.group.name} · 被举报内容</strong></span><button aria-label="关闭内容预览" onClick={onClose} type="button"><X aria-hidden="true" size={18} /></button></header><div className="group-management-preview-content">{report.message.body ? <p>{report.message.body}</p> : null}{report.message.attachments?.map((attachment) => <PreviewAttachment attachment={attachment} key={attachment.id} />)}</div></section></div>;
}

function PreviewAttachment({ attachment }: { attachment: ChatAttachment }) {
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    if (attachment.kind !== "image") return;
    const token = readAccessToken();
    if (!token) return;
    let active = true;
    let objectUrl = "";
    downloadChatAttachment(token, attachment).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);
  async function download() {
    const token = readAccessToken();
    if (!token) return;
    const blob = await downloadChatAttachment(token, attachment);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = attachment.originalName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="group-management-preview-attachment">{attachment.kind === "image" && previewUrl ? <img alt={attachment.originalName} src={previewUrl} /> : <button onClick={() => void download()} type="button">{attachment.kind === "image" ? "正在读取图片" : attachment.originalName}</button>}<small>{formatBytes(attachment.sizeBytes)}</small></div>;
}

function Avatar({ user }: { user: SocialUser }) {
  return <span className="group-admin-avatar">{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : <strong>{fallbackText(user.nickname)}</strong>}</span>;
}

function GroupAvatar({ group }: { group: Pick<ChatGroupSummary, "name" | "avatarUrl"> | ChatGroupReport["group"] }) {
  return <span className="group-admin-avatar group-admin-group-avatar">{group.avatarUrl ? <img alt="" src={resolveApiUrl(group.avatarUrl)} /> : <strong>{fallbackText(group.name)}</strong>}</span>;
}

function fallbackText(value: string): string {
  return Array.from(value.trim()).slice(0, 2).join("").toUpperCase() || "群";
}

function formatMinute(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
