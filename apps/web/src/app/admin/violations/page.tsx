"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Ban, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { getMe, isAuthExpiredError, resolveApiUrl } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getViolationAuthor, listViolationAuthors, updateViolationRestriction, type ViolationAuthor, type ViolationAuthorDetail } from "@/lib/article-api";

function date(value: string) { return new Date(value).toLocaleString("zh-CN", { hour12: false }); }
const REPORT_REASON_LABEL: Record<string, string> = { spam: "垃圾广告", harassment: "辱骂骚扰", illegal: "违法违规", privacy: "隐私泄露", misinformation: "不实内容", other: "其他" };
function avatar(user: { nickname: string; avatarUrl: string | null }) {
  const avatarUrl = user.avatarUrl ? resolveApiUrl(user.avatarUrl) : null;
  return avatarUrl ? <img alt="" src={avatarUrl} /> : <span>{user.nickname.slice(0, 1)}</span>;
}

export default function ViolationAuthorsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<ViolationAuthor[]>([]);
  const [selected, setSelected] = useState<ViolationAuthorDetail | null>(null);
  const [restrictionEnd, setRestrictionEnd] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const accessToken = readAccessToken();
    if (!accessToken) { window.location.href = "/login?from=%2Fadmin%2Fviolations"; return; }
    Promise.all([getMe(accessToken), listViolationAuthors(accessToken)]).then(([user, result]) => {
      if (!user.isSuperAdmin && user.role.level < 90) throw new Error("需要管理员权限。");
      setToken(accessToken); setItems(result.items);
    }).catch((loadError) => { if (isAuthExpiredError(loadError)) { clearAuthTokens(); window.location.href = "/login"; return; } setError(loadError instanceof Error ? loadError.message : "无法读取违规作者。"); }).finally(() => setIsLoading(false));
  }, []);

  async function open(userId: number) {
    const accessToken = token ?? readAccessToken(); if (!accessToken) return;
    try { const detail = await getViolationAuthor(accessToken, userId); setSelected(detail); setReason(detail.restriction?.reason ?? ""); setRestrictionEnd(detail.restriction?.endsAt ? detail.restriction.endsAt.slice(0, 16) : ""); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "无法读取作者详情。"); }
  }

  async function update(active: boolean, permanent = false) {
    const accessToken = token ?? readAccessToken(); if (!accessToken || !selected) return;
    try { await updateViolationRestriction(accessToken, selected.user.id, { active, permanent, endsAt: !permanent && restrictionEnd ? new Date(restrictionEnd).toISOString() : undefined, reason }); setNotice(active ? "发布限制已更新。" : "发布限制已解除。"); setSelected({ ...selected, restriction: active ? { id: selected.restriction?.id ?? 0, reason, startsAt: selected.restriction?.startsAt ?? new Date().toISOString(), endsAt: permanent ? null : restrictionEnd ? new Date(restrictionEnd).toISOString() : null, liftedAt: null } : null }); } catch (updateError) { setError(updateError instanceof Error ? updateError.message : "限制更新失败。"); }
  }

  return <section className="page-shell violation-authors-page"><header className="violation-page-heading"><div><span className="section-label"><ShieldAlert size={14} /> CONTENT SAFETY</span><h1>违规作者</h1><p>查看有效举报趋势，处理文章发布限制和异常举报行为。</p></div><span className="violation-count">{items.length} 位</span></header>{isLoading ? <div className="article-empty-state">正在读取违规作者。</div> : <div className="violation-layout"><div className="violation-author-list">{items.map((item) => <button className={selected?.user.id === item.user.id ? "active" : ""} key={item.user.id} onClick={() => void open(item.user.id)} type="button"><span className="violation-avatar">{avatar(item.user)}</span><span><strong>{item.user.nickname}</strong><small>被举报 {item.totalReceived} 次 · 近 30 天 {item.recentReceived} 次</small></span>{item.restriction ? <Ban size={15} /> : null}</button>)}</div>{selected ? <section className="violation-inspector"><header><div className="violation-user-heading"><span className="violation-avatar large">{avatar(selected.user)}</span><div><h2>{selected.user.nickname}</h2><small>@{selected.user.username}</small></div></div><button aria-label="关闭详情" onClick={() => setSelected(null)} type="button"><X size={17} /></button></header><div className="violation-stat-grid"><span><b>{selected.totalReceived}</b><small>被举报累计</small></span><span><b>{selected.recentReceived}</b><small>被举报近 30 天</small></span><span><b>{selected.totalSubmitted}</b><small>举报他人累计</small></span><span><b>{selected.recentSubmitted}</b><small>举报他人近 30 天</small></span></div><section className="violation-restriction"><div><strong>发布限制</strong><small>{selected.restriction ? selected.restriction.endsAt ? `限制至 ${date(selected.restriction.endsAt)}` : "永久限制" : "当前未限制"}</small></div><textarea maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="限制原因" rows={2} value={reason} /><input aria-label="限制结束时间" onChange={(event) => setRestrictionEnd(event.target.value)} type="datetime-local" value={restrictionEnd} /><footer>{selected.restriction ? <button onClick={() => void update(false)} type="button"><ShieldCheck size={15} />解除限制</button> : <><button onClick={() => void update(true)} type="button"><Ban size={15} />限制 30 天</button><button onClick={() => void update(true, true)} type="button"><Ban size={15} />永久限制</button></>}</footer></section><ReportSide title="被举报记录" items={selected.received} /><ReportSide title="举报他人记录" items={selected.submitted} /></section> : <div className="article-empty-state">选择一位作者查看详细记录。</div>}</div>}{!isLoading && !items.length ? <div className="article-empty-state">暂无违规作者记录。</div> : null}<AppToast duration={3400} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}

function ReportSide({ title, items }: { title: string; items: ViolationAuthorDetail["received"] }) {
  return <section className="violation-report-side"><h3>{title}<small>{items.length}</small></h3>{items.length ? items.map((item) => {
    const relatedUser = item.reporter ? { label: "举报人", user: item.reporter } : item.article.author ? { label: "被举报人", user: item.article.author } : null;
    const statusLabel = item.status === "resolved" ? "已处理" : item.status === "rejected" ? "已驳回" : "待处理";
    return <article key={item.id}><div className="violation-report-content"><div className="violation-report-title-line"><strong>{item.article.title}</strong><span className={`violation-report-status ${item.status}`}>{statusLabel}</span></div><small>第 {item.publicationNumber} 次发布 · {REPORT_REASON_LABEL[item.reason] ?? item.reason} · {date(item.createdAt)}</small>{item.resolution ? <p className="violation-report-resolution">处理反馈：{item.resolution}</p> : null}</div>{relatedUser ? <Link aria-label={`查看${relatedUser.label}${relatedUser.user.nickname}的主页`} className="violation-report-person" href={`/users/${relatedUser.user.username}`} title={`查看${relatedUser.label}主页`}><span className="violation-report-avatar">{avatar(relatedUser.user)}</span><span><small>{relatedUser.label}</small><strong>{relatedUser.user.nickname}</strong></span></Link> : null}</article>;
  }) : <p>暂无记录。</p>}</section>;
}
