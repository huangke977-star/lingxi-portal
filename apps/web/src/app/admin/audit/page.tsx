"use client";

import { ClipboardList, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { AuditLog, listAuditLogs } from "@/lib/audit-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { auditActionLabel } from "@/lib/system-labels";
import { isSiteManager } from "@/lib/user-permissions";

export default function AuditLogPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [items, setItems] = useState<AuditLog[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("");
  const [result, setResult] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setSearch(searchDraft.trim()); }, 280);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      Promise.all([
        getMe(token),
        listAuditLogs(token, { page, pageSize: 20, search, scope, result }),
      ]).then(([currentUser, response]) => {
        if (!active) return;
        setUser(currentUser);
        if (!isSiteManager(currentUser)) return;
        setItems(response.items);
        setTotal(response.total);
        setTotalPages(response.totalPages);
        if (response.page !== page) setPage(response.page);
      }).catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }
        if (active) setError(loadError instanceof Error ? loadError.message : phrase("审计日志读取失败。", "Could not load audit logs."));
      }).finally(() => { if (active) setIsLoading(false); });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [locale, page, phrase, result, router, scope, search]);

  if (!isLoading && !isSiteManager(user)) {
    return <section className="page-shell admin-shell"><div className="search-page-empty"><strong>{phrase("无权访问", "Access denied")}</strong><span>{phrase("审计日志仅超级管理员和管理员可查看。", "Audit logs are available only to site administrators.")}</span></div></section>;
  }

  return <section className="page-shell admin-shell audit-page">
    <div className="audit-toolbar">
      <div className="audit-summary"><ClipboardList aria-hidden="true" size={18} /><span>{phrase(`${total} 条操作记录`, `${total} audit entries`)}</span></div>
      <label className="admin-search-field"><Search aria-hidden="true" size={15} /><input aria-label={phrase("搜索审计日志", "Search audit logs")} onChange={(event) => setSearchDraft(event.target.value)} placeholder={phrase("操作者、路径、操作或目标", "Actor, path, action, or target")} value={searchDraft} /></label>
      {user?.isSuperAdmin ? <GlassSelect ariaLabel={phrase("操作范围", "Scope")} onChange={(value) => { setPage(1); setScope(value); }} options={[{ value: "", label: phrase("全部范围", "All scopes") }, { value: "business", label: phrase("业务操作", "Business") }, { value: "security", label: phrase("安全设置", "Security") }, { value: "server", label: phrase("服务器操作", "Server") }]} value={scope} /> : null}
      <GlassSelect ariaLabel={phrase("执行结果", "Result")} onChange={(value) => { setPage(1); setResult(value); }} options={[{ value: "", label: phrase("全部结果", "All results") }, { value: "success", label: phrase("成功", "Success") }, { value: "failed", label: phrase("失败", "Failed") }]} value={result} />
    </div>

    <div className="admin-table-wrap audit-table-wrap">
      <table className="admin-table audit-table">
        <thead><tr><th>{phrase("时间", "Time")}</th><th>{phrase("操作者", "Actor")}</th><th>{phrase("操作", "Action")}</th><th>{phrase("目标", "Target")}</th><th>{phrase("结果", "Result")}</th><th>{phrase("来源", "Source")}</th></tr></thead>
        <tbody>
          {isLoading ? <tr><td className="admin-table-state" colSpan={6}>{phrase("正在读取审计日志", "Loading audit logs")}</td></tr> : null}
          {!isLoading && !items.length ? <tr><td className="admin-table-state" colSpan={6}>{phrase("暂无匹配记录", "No matching entries")}</td></tr> : null}
          {items.map((item) => <AuditRow expanded={expandedId === item.id} item={item} key={item.id} onToggle={() => setExpandedId((current) => current === item.id ? 0 : item.id)} />)}
        </tbody>
      </table>
    </div>
    <nav aria-label={phrase("审计日志分页", "Audit log pagination")} className="admin-pagination"><span>{phrase(`第 ${page} / ${totalPages} 页`, `Page ${page} of ${totalPages}`)}</span><div><button disabled={isLoading || page <= 1} onClick={() => setPage((value) => value - 1)} type="button">{phrase("上一页", "Previous")}</button><button disabled={isLoading || page >= totalPages} onClick={() => setPage((value) => value + 1)} type="button">{phrase("下一页", "Next")}</button></div></nav>
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function AuditRow({ expanded, item, onToggle }: { expanded: boolean; item: AuditLog; onToggle: () => void }) {
  const { locale, phrase } = useLanguage();
  return <>
    <tr className="audit-row" onClick={onToggle}>
      <td>{formatDateTime(item.createdAt, locale)}</td>
      <td><strong>{item.actor.nickname}</strong><small>@{item.actor.username}</small></td>
      <td><span className={`audit-scope ${item.scope}`}>{scopeLabel(item.scope, phrase)}</span><strong>{auditActionLabel(item.action, locale, item.summary)}</strong><small>{item.method} {item.path}</small></td>
      <td>{item.targetId || "-"}</td>
      <td><span className={item.statusCode < 400 ? "audit-result success" : "audit-result failed"}>{item.statusCode < 400 ? phrase("成功", "Success") : phrase(`失败 ${item.statusCode}`, `Failed ${item.statusCode}`)}</span><small>{item.durationMs} ms</small></td>
      <td><span>{item.ip || "-"}</span></td>
    </tr>
    {expanded ? <tr className="audit-detail-row"><td colSpan={6}><div><span><strong>{phrase("动作代码", "Action code")}</strong>{item.action}</span><span><strong>{phrase("目标类型", "Target type")}</strong>{item.targetType || "-"}</span><span><strong>{phrase("浏览器", "Browser")}</strong>{formatUserAgent(item.userAgent)}</span></div><pre>{JSON.stringify(item.metadata, null, 2)}</pre></td></tr> : null}
  </>;
}

function scopeLabel(scope: AuditLog["scope"], phrase: (chinese: string, english: string) => string): string {
  return scope === "business" ? phrase("业务", "Business") : scope === "security" ? phrase("安全", "Security") : phrase("服务器", "Server");
}

function formatDateTime(value: string, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function formatUserAgent(value: string): string {
  if (!value) return "-";
  return value.length > 180 ? `${value.slice(0, 180)}...` : value;
}
