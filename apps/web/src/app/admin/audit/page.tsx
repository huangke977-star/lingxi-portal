"use client";

import { ClipboardList, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { AuditLog, listAuditLogs } from "@/lib/audit-api";
import { AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { isSiteManager } from "@/lib/user-permissions";

export default function AuditLogPage() {
  const router = useRouter();
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
      router.replace("/login");
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
          router.replace("/");
          return;
        }
        if (active) setError(loadError instanceof Error ? loadError.message : "审计日志读取失败。");
      }).finally(() => { if (active) setIsLoading(false); });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [page, result, router, scope, search]);

  if (!isLoading && !isSiteManager(user)) {
    return <section className="page-shell admin-shell"><div className="search-page-empty"><strong>无权访问</strong><span>审计日志仅超级管理员和管理员可查看。</span></div></section>;
  }

  return <section className="page-shell admin-shell audit-page">
    <div className="audit-toolbar">
      <div className="audit-summary"><ClipboardList aria-hidden="true" size={18} /><span>{total} 条操作记录</span></div>
      <label className="admin-search-field"><Search aria-hidden="true" size={15} /><input aria-label="搜索审计日志" onChange={(event) => setSearchDraft(event.target.value)} placeholder="操作者、路径、操作或目标" value={searchDraft} /></label>
      {user?.isSuperAdmin ? <select aria-label="操作范围" onChange={(event) => { setPage(1); setScope(event.target.value); }} value={scope}><option value="">全部范围</option><option value="business">业务操作</option><option value="security">安全设置</option><option value="server">服务器操作</option></select> : null}
      <select aria-label="执行结果" onChange={(event) => { setPage(1); setResult(event.target.value); }} value={result}><option value="">全部结果</option><option value="success">成功</option><option value="failed">失败</option></select>
    </div>

    <div className="admin-table-wrap audit-table-wrap">
      <table className="admin-table audit-table">
        <thead><tr><th>时间</th><th>操作者</th><th>操作</th><th>目标</th><th>结果</th><th>来源</th></tr></thead>
        <tbody>
          {isLoading ? <tr><td className="admin-table-state" colSpan={6}>正在读取审计日志</td></tr> : null}
          {!isLoading && !items.length ? <tr><td className="admin-table-state" colSpan={6}>暂无匹配记录</td></tr> : null}
          {items.map((item) => <AuditRow expanded={expandedId === item.id} item={item} key={item.id} onToggle={() => setExpandedId((current) => current === item.id ? 0 : item.id)} />)}
        </tbody>
      </table>
    </div>
    <nav aria-label="审计日志分页" className="admin-pagination"><span>第 {page} / {totalPages} 页</span><div><button disabled={isLoading || page <= 1} onClick={() => setPage((value) => value - 1)} type="button">上一页</button><button disabled={isLoading || page >= totalPages} onClick={() => setPage((value) => value + 1)} type="button">下一页</button></div></nav>
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function AuditRow({ expanded, item, onToggle }: { expanded: boolean; item: AuditLog; onToggle: () => void }) {
  return <>
    <tr className="audit-row" onClick={onToggle}>
      <td>{formatDateTime(item.createdAt)}</td>
      <td><strong>{item.actor.nickname}</strong><small>@{item.actor.username}</small></td>
      <td><span className={`audit-scope ${item.scope}`}>{scopeLabel(item.scope)}</span><strong>{item.summary}</strong><small>{item.method} {item.path}</small></td>
      <td>{item.targetId || "-"}</td>
      <td><span className={item.statusCode < 400 ? "audit-result success" : "audit-result failed"}>{item.statusCode < 400 ? "成功" : `失败 ${item.statusCode}`}</span><small>{item.durationMs} ms</small></td>
      <td><span>{item.ip || "-"}</span></td>
    </tr>
    {expanded ? <tr className="audit-detail-row"><td colSpan={6}><div><span><strong>动作代码</strong>{item.action}</span><span><strong>目标类型</strong>{item.targetType || "-"}</span><span><strong>浏览器</strong>{formatUserAgent(item.userAgent)}</span></div><pre>{JSON.stringify(item.metadata, null, 2)}</pre></td></tr> : null}
  </>;
}

function scopeLabel(scope: AuditLog["scope"]): string {
  return scope === "business" ? "业务" : scope === "security" ? "安全" : "服务器";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function formatUserAgent(value: string): string {
  if (!value) return "-";
  return value.length > 180 ? `${value.slice(0, 180)}...` : value;
}
