"use client";

import { Ban, Check, Flag, LoaderCircle, Search, ShieldOff, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { AdminPageHeader } from "@/components/admin-page-header";
import { GroupReportMessagePreview } from "@/components/group-report-message-preview";
import { useLanguage } from "@/components/language-provider";
import { getMe, isAuthExpiredError, resolveApiUrl } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { formatDate, localizedPath, type TranslationKey } from "@/lib/i18n";
import { isSiteManager } from "@/lib/user-permissions";
import {
  banChatGroup,
  downloadChatAttachmentThumbnail,
  handleChatGroupReport,
  liftChatGroupBan,
  getChatGroup,
  listAdminChatGroups,
  listChatGroupReports,
  type ChatAttachment,
  type ChatGroupMember,
  type ChatGroupReport,
  type ChatGroupSummary,
  type SocialUser,
} from "@/lib/social-api";

type ManagerTab = "groups" | "reports";
type ReportStatus = "pending" | "resolved" | "rejected";
type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

export default function GroupReportsAdminPage() {
  const router = useRouter();
  const { locale, t } = useLanguage();
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
  const [membersTarget, setMembersTarget] = useState<{ group: ChatGroupSummary; members: ChatGroupMember[] } | null>(null);
  const [membersLoadingId, setMembersLoadingId] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/groups", locale))}`);
      return;
    }
    let active = true;
    // The request lifecycle owns this loading flag; this local reset avoids stale results when filters change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    Promise.all([getMe(token), listAdminChatGroups(token, search), listChatGroupReports(token, undefined, reportStatus)])
      .then(([currentUser, groupResult, reportResult]) => {
        if (!active) return;
        if (!isSiteManager(currentUser)) {
          router.replace(localizedPath("/", locale));
          return;
        }
        setGroups(groupResult.items);
        setReports(reportResult.items);
      })
      .catch((loadError) => {
        if (!active) return;
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : t("groupAdmin.loadFailed"));
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [locale, reportStatus, router, search, t]);

  const filteredReports = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase();
    if (!keyword) return reports;
    return reports.filter((report) => [
      report.group.name,
      report.message.sender.nickname,
      report.message.sender.username,
      report.reporter.nickname,
      report.reporter.username,
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
      setError(t("groupAdmin.banReasonRequired"));
      return;
    }
    if (!permanent && (!Number.isInteger(durationMinutes) || durationMinutes < 1)) {
      setError(t("groupAdmin.banDurationRequired"));
      return;
    }
    setBusyKey(`ban:${banTarget.id}`);
    try {
      const updated = await banChatGroup(token, banTarget.id, { permanent, durationMinutes, reason: reason.trim() });
      setGroups((current) => current.map((group) => group.id === updated.id ? updated : group));
      setBanTarget(null);
      setNotice(t("groupAdmin.bannedNotice"));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("groupAdmin.banFailed"));
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
      setNotice(t("groupAdmin.liftedNotice"));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("groupAdmin.liftFailed"));
    } finally {
      setBusyKey("");
    }
  }

  async function openMembers(group: ChatGroupSummary) {
    const token = readAccessToken();
    if (!token) return;
    setMembersLoadingId(group.id);
    setError("");
    try {
      const detail = await getChatGroup(token, group.id);
      setMembersTarget({ group, members: detail.members.filter((member) => member.status === "active") });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("groupAdmin.membersLoadFailed"));
    } finally {
      setMembersLoadingId(0);
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
        resolution: status === "resolved" ? t("groupAdmin.resolved") : t("groupAdmin.rejected"),
      });
      setReports((current) => current.filter((item) => item.id !== report.id));
      setNotice(status === "resolved" ? t("groupAdmin.resolvedNotice") : t("groupAdmin.rejectedNotice"));
      setPreviewReport(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : t("groupAdmin.handleFailed"));
    } finally {
      setBusyKey("");
    }
  }

  return <section className="page-shell group-management-admin-page">
    <AdminPageHeader className="group-management-admin-header" description={t("groupAdmin.description")} title={t("groupAdmin.title")} actions={<span className="group-management-admin-summary"><b>{groups.length}</b><small>{t("groupAdmin.groupCount", { count: groups.length })}</small></span>} />
    <div className="group-management-admin-toolbar">
      <nav aria-label={t("groupAdmin.title")}><button className={tab === "groups" ? "active" : ""} onClick={() => setTab("groups")} type="button"><ShieldOff aria-hidden="true" size={16} />{t("groupAdmin.groups")}</button><button className={tab === "reports" ? "active" : ""} onClick={() => setTab("reports")} type="button"><Flag aria-hidden="true" size={16} />{t("groupAdmin.reports")}{reportStatus === "pending" && reports.length ? <b>{reports.length}</b> : null}</button></nav>
      <div className="group-management-toolbar-actions">
        {tab === "reports" ? <nav aria-label={t("groupAdmin.reportStatus")} className="group-management-report-filter"><button className={reportStatus === "pending" ? "active" : ""} onClick={() => setReportStatus("pending")} type="button">{t("groupAdmin.pending")}</button><button className={reportStatus === "resolved" ? "active" : ""} onClick={() => setReportStatus("resolved")} type="button">{t("groupAdmin.resolved")}</button><button className={reportStatus === "rejected" ? "active" : ""} onClick={() => setReportStatus("rejected")} type="button">{t("groupAdmin.rejected")}</button></nav> : null}
        <label className="group-management-search"><Search aria-hidden="true" size={16} /><input aria-label={tab === "reports" ? t("groupAdmin.searchReports") : t("groupAdmin.searchGroups")} onChange={(event) => setSearch(event.target.value)} placeholder={tab === "reports" ? t("groupAdmin.searchReports") : t("groupAdmin.searchGroups")} value={search} />{search ? <button aria-label={t("common.clear")} onClick={() => setSearch("")} type="button"><X aria-hidden="true" size={14} /></button> : null}</label>
      </div>
    </div>
    {isLoading ? <div className="article-empty-state"><LoaderCircle aria-hidden="true" className="spin" size={22} />{t("groupAdmin.load")}</div> : tab === "groups" ? <GroupAdminGrid busyKey={busyKey} groups={groups} locale={locale} membersLoadingId={membersLoadingId} onBan={openBanDialog} onLift={liftBan} onOpenMembers={openMembers} onOpenProfile={(username) => router.push(localizedPath(`/users/${encodeURIComponent(username)}`, locale))} t={t} /> : <ReportAdminGrid busyKey={busyKey} locale={locale} onHandle={handleReport} onOpenProfile={(username) => router.push(localizedPath(`/users/${encodeURIComponent(username)}`, locale))} onPreview={setPreviewReport} reports={filteredReports} status={reportStatus} t={t} />}
    {banTarget ? <div className="group-management-modal-backdrop" onClick={() => setBanTarget(null)} role="presentation"><section aria-modal="true" className="group-management-ban-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><header><span><Ban aria-hidden="true" size={18} /><strong>{banTarget.isBanned ? t("groupAdmin.adjustBan") : t("groupAdmin.banDialog")}</strong></span><button aria-label={t("groupAdmin.closeBanDialog")} onClick={() => setBanTarget(null)} type="button"><X aria-hidden="true" size={17} /></button></header><p>{t("groupAdmin.banDescription")}</p><label className="group-management-switch"><input checked={permanent} onChange={(event) => setPermanent(event.target.checked)} type="checkbox" /><span>{t("groupAdmin.banPermanently")}</span></label>{!permanent ? <label><span>{t("groupAdmin.banDuration")}</span><input min={1} max={525600} onChange={(event) => setDurationMinutes(Number(event.target.value))} type="number" value={durationMinutes} /></label> : null}<label><span>{t("groupAdmin.banReason")}</span><textarea maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder={t("groupAdmin.banReasonPlaceholder")} rows={4} value={reason} /></label><footer><button onClick={() => setBanTarget(null)} type="button">{t("common.cancel")}</button><button disabled={busyKey === `ban:${banTarget.id}`} onClick={() => void submitBan()} type="button">{busyKey === `ban:${banTarget.id}` ? t("groupAdmin.processing") : t("groupAdmin.confirmBan")}</button></footer></section></div> : null}
    {previewReport ? <GroupReportMessagePreview group={previewReport.group} message={previewReport.message} onClose={() => setPreviewReport(null)} /> : null}
    {membersTarget ? <GroupMembersDialog group={membersTarget.group} members={membersTarget.members} onClose={() => setMembersTarget(null)} onOpenProfile={(username) => router.push(localizedPath(`/users/${encodeURIComponent(username)}`, locale))} t={t} /> : null}
    <AppToast duration={error ? 4200 : 2800} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function GroupAdminGrid({ groups, busyKey, locale, membersLoadingId, onBan, onLift, onOpenMembers, onOpenProfile, t }: { groups: ChatGroupSummary[]; busyKey: string; locale: "zh-CN" | "en-US"; membersLoadingId: number; onBan: (group: ChatGroupSummary) => void; onLift: (group: ChatGroupSummary) => Promise<void>; onOpenMembers: (group: ChatGroupSummary) => Promise<void>; onOpenProfile: (username: string) => void; t: Translate }) {
  if (!groups.length) return <div className="article-empty-state">{t("groupAdmin.noGroups")}</div>;
  return <div className="group-admin-grid">{groups.map((group) => <article className={`group-admin-card${group.isBanned ? " banned" : ""}`} key={group.id}>
    <div className="group-admin-card-cover">{group.avatarUrl ? <img alt="" src={resolveApiUrl(group.avatarUrl)} /> : <strong>{fallbackText(group.name)}</strong>}<span>{group.isBanned ? <><Ban aria-hidden="true" size={14} />{t("groupAdmin.banned")}</> : t("groupAdmin.normal")}</span></div>
    <div className="group-admin-card-body"><div className="group-admin-card-title"><strong>{group.name}</strong><small>{t("common.people", { count: group.memberCount })} · {group.temporary ? t("groupAdmin.temporary") : t("groupAdmin.longTerm")}</small></div><p>{group.announcement || t("groupAdmin.noIntroduction")}</p><div className="group-admin-owner"><button className="group-admin-owner-profile" onClick={() => onOpenProfile(group.owner.username)} title={t("groupAdmin.viewOwner", { name: group.owner.nickname })} type="button"><Avatar className="group-admin-owner-avatar" user={group.owner} /><span><small>{t("groupAdmin.owner")}</small><strong>{group.owner.nickname}</strong></span></button><button aria-label={t("groupAdmin.viewMembers", { name: group.name })} className="group-admin-owner-members" disabled={membersLoadingId === group.id} onClick={() => void onOpenMembers(group)} title={t("groupAdmin.members")} type="button">{membersLoadingId === group.id ? <LoaderCircle aria-hidden="true" className="spin" size={14} /> : <UserRound aria-hidden="true" size={14} />}</button></div><footer>{group.isBanned ? <button className="icon-action" disabled={busyKey === `lift:${group.id}`} onClick={() => void onLift(group)} title={t("groupAdmin.liftBan")} type="button">{busyKey === `lift:${group.id}` ? <LoaderCircle className="spin" size={16} /> : <ShieldOff aria-hidden="true" size={16} />}</button> : <button className="icon-action danger" disabled={busyKey === `ban:${group.id}`} onClick={() => onBan(group)} title={t("groupAdmin.ban")} type="button">{busyKey === `ban:${group.id}` ? <LoaderCircle className="spin" size={16} /> : <Ban aria-hidden="true" size={16} />}</button>}<small>{group.isBanned ? group.bannedUntil ? t("groupAdmin.banUntil", { time: formatMinute(group.bannedUntil, locale) }) : t("groupAdmin.permanentBan") : t("groupAdmin.canSpeak")}</small></footer></div>
  </article>)}</div>;
}

function GroupMembersDialog({ group, members, onClose, onOpenProfile, t }: { group: ChatGroupSummary; members: ChatGroupMember[]; onClose: () => void; onOpenProfile: (username: string) => void; t: Translate }) {
  return <div className="group-management-modal-backdrop" onClick={onClose} role="presentation"><section aria-modal="true" className="group-members-dialog" onClick={(event) => event.stopPropagation()} role="dialog"><header><span><UserRound aria-hidden="true" size={17} /><strong>{group.name} · {t("groupAdmin.members")}</strong><small>{t("common.people", { count: members.length })}</small></span><button aria-label={t("groupAdmin.closeMembers")} onClick={onClose} type="button"><X aria-hidden="true" size={17} /></button></header><div className="group-members-dialog-list">{members.map((member) => <button className="group-member-dialog-item" key={member.user.id} onClick={() => onOpenProfile(member.user.username)} title={t("groupAdmin.viewReporter", { name: member.alias || member.user.nickname })} type="button"><Avatar user={member.user} /><span><strong>{member.alias || member.user.nickname}</strong><small>{member.alias && member.alias !== member.user.nickname ? `@${member.user.username} · ` : ""}{memberRoleLabel(member.role, t)}</small></span></button>)}</div></section></div>;
}

function ReportAdminGrid({ reports, status, busyKey, locale, onHandle, onOpenProfile, onPreview, t }: { reports: ChatGroupReport[]; status: ReportStatus; busyKey: string; locale: "zh-CN" | "en-US"; onHandle: (report: ChatGroupReport, status: "resolved" | "rejected") => Promise<void>; onOpenProfile: (username: string) => void; onPreview: (report: ChatGroupReport) => void; t: Translate }) {
  if (!reports.length) return <div className="article-empty-state">{t("groupAdmin.noReports")}</div>;
  return <div className="group-admin-grid report-admin-grid">{reports.map((report) => {
    const images = report.message.attachments?.filter((attachment) => attachment.kind === "image") ?? [];
    const firstFile = report.message.attachments?.find((attachment) => attachment.kind !== "image");
    return <article className="group-admin-card report-admin-card" key={report.id}>
      <div className="report-admin-content"><strong>{t("groupAdmin.reportedContent")}</strong><button onClick={() => onPreview(report)} title={t("groupAdmin.viewContent")} type="button">{report.message.body ? <span className="report-admin-text-excerpt">{report.message.body}</span> : null}{images.length ? <span className={`report-admin-card-images count-${Math.min(images.length, 4)}`}>{images.slice(0, 4).map((attachment) => <ReportCardImage attachment={attachment} key={attachment.id} t={t} />)}</span> : null}{!report.message.body && !images.length && firstFile ? <span className="report-admin-file-excerpt">{t("groupAdmin.file", { name: firstFile.originalName })}</span> : null}{!report.message.body && !images.length && !firstFile ? <span>{t("groupAdmin.attachmentMessage")}</span> : null}</button></div>
      <div className="group-admin-card-body">
        <button className="report-admin-sender" onClick={() => onOpenProfile(report.message.sender.username)} title={t("groupAdmin.viewReportedUser", { name: report.message.sender.nickname })} type="button"><Avatar user={report.message.sender} /><span><small>{t("groupAdmin.reportedUser")}</small><strong>{report.message.sender.nickname}</strong></span></button>
        <div className="report-admin-group"><GroupAvatar group={report.group} /><div className="group-admin-card-title"><strong>{report.group.name}</strong><small>{formatMinute(report.createdAt, locale)} · {reportReasonLabel(report.reason, t)}</small></div></div>
        <footer><button aria-label={t("groupAdmin.viewReporter", { name: report.reporter.nickname })} className="report-admin-reporter" onClick={() => onOpenProfile(report.reporter.username)} title={t("groupAdmin.viewReporter", { name: report.reporter.nickname })} type="button"><Avatar user={report.reporter} /><strong>{report.reporter.nickname}</strong></button><span>{status === "pending" ? <><button className="icon-action" disabled={busyKey === `report:${report.id}`} onClick={() => void onHandle(report, "rejected")} title={t("groupAdmin.rejected")} type="button"><X aria-hidden="true" size={16} /></button><button className="icon-action danger" disabled={busyKey === `report:${report.id}`} onClick={() => void onHandle(report, "resolved")} title={t("groupAdmin.processAndDelete")} type="button"><Check aria-hidden="true" size={16} /></button></> : <small className="report-admin-status">{status === "resolved" ? t("groupAdmin.resolved") : t("groupAdmin.rejected")}</small>}</span></footer>
      </div>
    </article>;
  })}</div>;
}

function ReportCardImage({ attachment, t }: { attachment: ChatAttachment; t: Translate }) {
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
  return url ? <img alt={attachment.originalName} src={url} /> : <span>{t("groupAdmin.loadingImage")}</span>;
}

function Avatar({ user, className = "" }: { user: SocialUser; className?: string }) {
  return <span className={`group-admin-avatar${className ? ` ${className}` : ""}`}>{user.avatarUrl ? <img alt="" src={resolveApiUrl(user.avatarUrl)} /> : <strong>{fallbackText(user.nickname)}</strong>}</span>;
}

function GroupAvatar({ group }: { group: Pick<ChatGroupSummary, "name" | "avatarUrl"> | ChatGroupReport["group"] }) {
  return <span className="group-admin-avatar group-admin-group-avatar">{group.avatarUrl ? <img alt="" src={resolveApiUrl(group.avatarUrl)} /> : <strong>{fallbackText(group.name)}</strong>}</span>;
}

function fallbackText(value: string): string {
  return Array.from(value.trim()).slice(0, 2).join("").toUpperCase() || "群";
}

function memberRoleLabel(role: ChatGroupMember["role"], t: Translate): string {
  if (role === "owner") return t("groupAdmin.owner");
  if (role === "admin") return t("groupAdmin.administrator");
  return t("groupAdmin.member");
}

function reportReasonLabel(reason: string, t: Translate): string {
  const keys: Record<string, TranslationKey> = {
    spam: "report.reason.spam",
    harassment: "report.reason.harassment",
    illegal: "report.reason.illegal",
    privacy: "report.reason.privacy",
    misinformation: "report.reason.misinformation",
    other: "report.reason.other",
  };
  return keys[reason] ? t(keys[reason]) : reason;
}

function formatMinute(value: string, locale: "zh-CN" | "en-US"): string {
  return formatDate(value, locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
