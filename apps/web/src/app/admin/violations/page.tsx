"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Ban, ShieldCheck, X } from "lucide-react";
import { AdminArticlePreviewModal } from "@/components/admin-article-preview-modal";
import { AppToast } from "@/components/app-toast";
import { AdminPageHeader } from "@/components/admin-page-header";
import { useLanguage } from "@/components/language-provider";
import { getMe, isAuthExpiredError, resolveApiUrl } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { isSiteManager } from "@/lib/user-permissions";
import { getAdminArticle, getViolationAuthor, listViolationAuthors, updateViolationRestriction, type Article, type ViolationAuthor, type ViolationAuthorDetail } from "@/lib/article-api";
import { getNamedFallbackText } from "@/lib/user-display";

function date(value: string, locale: "zh-CN" | "en-US") { return new Date(value).toLocaleString(locale, { hour12: false }); }
function avatar(user: { nickname: string; avatarUrl: string | null }) {
  const avatarUrl = user.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
  return avatarUrl ? <img alt="" src={avatarUrl} /> : <span>{getNamedFallbackText(user.nickname)}</span>;
}

export default function ViolationAuthorsPage() {
  const { locale, phrase } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<ViolationAuthor[]>([]);
  const [selected, setSelected] = useState<ViolationAuthorDetail | null>(null);
  const [previewArticle, setPreviewArticle] = useState<Article | null>(null);
  const [restrictionEnd, setRestrictionEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const accessToken = readAccessToken();
    if (!accessToken) { window.location.href = `${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/violations", locale))}`; return; }
    Promise.all([getMe(accessToken), listViolationAuthors(accessToken)]).then(([user, result]) => {
      if (!isSiteManager(user)) throw new Error(phrase("需要管理员权限。", "Administrator access is required."));
      setToken(accessToken); setItems(result.items);
    }).catch((loadError) => { if (isAuthExpiredError(loadError)) { clearAuthTokens(); window.location.href = localizedPath("/login", locale); return; } setError(loadError instanceof Error ? loadError.message : phrase("无法读取违规作者。", "Could not load violation authors.")); }).finally(() => setIsLoading(false));
  }, [locale, phrase]);

  async function open(userId: number) {
    const accessToken = token ?? readAccessToken(); if (!accessToken) return;
    try { const detail = await getViolationAuthor(accessToken, userId); setSelected(detail); setReason(detail.restriction?.reason ?? ""); setRestrictionEnd(detail.restriction?.endsAt ? detail.restriction.endsAt.slice(0, 16) : ""); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : phrase("无法读取作者详情。", "Could not load author details.")); }
  }

  async function update(active: boolean, permanent = false) {
    const accessToken = token ?? readAccessToken(); if (!accessToken || !selected) return;
    try { await updateViolationRestriction(accessToken, selected.user.id, { active, permanent, endsAt: !permanent && restrictionEnd ? new Date(restrictionEnd).toISOString() : undefined, reason }); setNotice(active ? phrase("发布限制已更新。", "Publishing restriction updated.") : phrase("发布限制已解除。", "Publishing restriction removed.")); setSelected({ ...selected, restriction: active ? { id: selected.restriction?.id ?? 0, reason, startsAt: selected.restriction?.startsAt ?? new Date().toISOString(), endsAt: permanent ? null : restrictionEnd ? new Date(restrictionEnd).toISOString() : null, liftedAt: null } : null }); } catch (updateError) { setError(updateError instanceof Error ? updateError.message : phrase("限制更新失败。", "Could not update restriction.")); }
  }

  async function openArticlePreview(articleId: number) {
    const accessToken = token ?? readAccessToken();
    if (!accessToken) return;
    try {
      setPreviewArticle(await getAdminArticle(accessToken, articleId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : phrase("无法读取文章内容。", "Could not load article content."));
    }
  }

  return <section className="page-shell violation-authors-page"><AdminPageHeader className="violation-page-heading" description={phrase("查看有效举报趋势，处理文章发布限制和异常举报行为。", "Review valid report trends, manage publishing restrictions, and investigate suspicious reporting.")} title={phrase("违规作者", "Violation authors")} actions={<span className="violation-count">{phrase(`${items.length} 位`, `${items.length} authors`)}</span>} />{isLoading ? <div className="article-empty-state">{phrase("正在读取违规作者。", "Loading violation authors.")}</div> : <div className="violation-layout"><div className="violation-author-list">{items.map((item) => <button className={selected?.user.id === item.user.id ? "active" : ""} key={item.user.id} onClick={() => void open(item.user.id)} type="button"><span className="violation-avatar">{avatar(item.user)}</span><span><strong>{item.user.nickname}</strong><small>{phrase(`被举报 ${item.totalReceived} 次 · 近 30 天 ${item.recentReceived} 次`, `${item.totalReceived} reports · ${item.recentReceived} in 30 days`)}</small></span>{item.restriction ? <Ban size={15} /> : null}</button>)}</div>{selected ? <section className="violation-inspector"><header><div className="violation-user-heading"><span className="violation-avatar large">{avatar(selected.user)}</span><div><h2>{selected.user.nickname}</h2><small>@{selected.user.username}</small></div></div><button aria-label={phrase("关闭详情", "Close details")} onClick={() => setSelected(null)} type="button"><X size={17} /></button></header><div className="violation-stat-grid"><span><b>{selected.totalReceived}</b><small>{phrase("被举报累计", "Reports received")}</small></span><span><b>{selected.recentReceived}</b><small>{phrase("被举报近 30 天", "Reports received in 30 days")}</small></span><span><b>{selected.totalSubmitted}</b><small>{phrase("举报他人累计", "Reports submitted")}</small></span><span><b>{selected.recentSubmitted}</b><small>{phrase("举报他人近 30 天", "Reports submitted in 30 days")}</small></span></div><section className="violation-restriction"><div><strong>{phrase("发布限制", "Publishing restriction")}</strong><small>{selected.restriction ? selected.restriction.endsAt ? phrase(`限制至 ${date(selected.restriction.endsAt, locale)}`, `Restricted until ${date(selected.restriction.endsAt, locale)}`) : phrase("永久限制", "Permanent restriction") : phrase("当前未限制", "No active restriction")}</small></div><textarea maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder={phrase("限制原因", "Restriction reason")} rows={2} value={reason} /><input aria-label={phrase("限制结束时间", "Restriction end time")} onChange={(event) => setRestrictionEnd(event.target.value)} type="datetime-local" value={restrictionEnd} /><footer>{selected.restriction ? <button onClick={() => void update(false)} type="button"><ShieldCheck size={15} />{phrase("解除限制", "Remove restriction")}</button> : <><button onClick={() => void update(true)} type="button"><Ban size={15} />{phrase("限制 30 天", "Restrict 30 days")}</button><button onClick={() => void update(true, true)} type="button"><Ban size={15} />{phrase("永久限制", "Restrict permanently")}</button></>}</footer></section><ReportSide onOpenArticle={openArticlePreview} title={phrase("被举报记录", "Reports received")} items={selected.received} /><ReportSide onOpenArticle={openArticlePreview} title={phrase("举报他人记录", "Reports submitted")} items={selected.submitted} /></section> : <div className="article-empty-state">{phrase("选择一位作者查看详细记录。", "Select an author to view details.")}</div>}</div>}{!isLoading && !items.length ? <div className="article-empty-state">{phrase("暂无违规作者记录。", "No violation author records.")}</div> : null}{previewArticle ? <AdminArticlePreviewModal article={previewArticle} onClose={() => setPreviewArticle(null)} /> : null}<AppToast duration={3400} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}

function ReportSide({ title, items, onOpenArticle }: { title: string; items: ViolationAuthorDetail["received"]; onOpenArticle: (articleId: number) => void }) {
  const { locale, phrase } = useLanguage();
  return <section className="violation-report-side"><h3>{title}<small>{items.length}</small></h3>{items.length ? items.map((item) => {
    const relatedUser = item.reporter ? { label: phrase("举报人", "Reporter"), user: item.reporter } : item.article.author ? { label: phrase("被举报人", "Reported user"), user: item.article.author } : null;
    const statusLabel = item.status === "resolved" ? phrase("已处理", "Resolved") : item.status === "rejected" ? phrase("已驳回", "Rejected") : phrase("待处理", "Pending");
    const reason = item.reason === "spam" ? phrase("垃圾广告", "Spam") : item.reason === "harassment" ? phrase("辱骂骚扰", "Harassment") : item.reason === "illegal" ? phrase("违法违规", "Illegal content") : item.reason === "privacy" ? phrase("隐私泄露", "Privacy") : item.reason === "misinformation" ? phrase("不实内容", "Misinformation") : item.reason === "other" ? phrase("其他", "Other") : item.reason;
    return <article key={item.id}><div className="violation-report-content"><div className="violation-report-title-line"><button className="violation-report-title-button" onClick={() => void onOpenArticle(item.article.id)} title={phrase("查看文章内容", "View article content")} type="button">{item.article.title}</button><span className={`violation-report-status ${item.status}`}>{statusLabel}</span></div><small>{phrase(`第 ${item.publicationNumber} 次发布 · ${reason} · ${date(item.createdAt, locale)}`, `Publication ${item.publicationNumber} · ${reason} · ${date(item.createdAt, locale)}`)}</small>{item.resolution ? <p className="violation-report-resolution">{phrase(`处理反馈：${item.resolution}`, `Resolution feedback: ${item.resolution}`)}</p> : null}</div>{relatedUser ? <Link aria-label={phrase(`查看${relatedUser.label}${relatedUser.user.nickname}的主页`, `View ${relatedUser.label} ${relatedUser.user.nickname}'s profile`)} className="violation-report-person" href={localizedPath(`/users/${relatedUser.user.username}`, locale)} title={phrase(`查看${relatedUser.label}主页`, `View ${relatedUser.label}'s profile`)}><span className="violation-report-avatar">{avatar(relatedUser.user)}</span><span><small>{relatedUser.label}</small><strong>{relatedUser.user.nickname}</strong></span></Link> : null}</article>;
  }) : <p>{phrase("暂无记录。", "No records.")}</p>}</section>;
}
