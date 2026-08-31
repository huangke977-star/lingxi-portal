"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { localizedPath } from "@/lib/i18n";
import { isSiteManager } from "@/lib/user-permissions";
import { getDeletedUserContent, listDeletedUsers, type DeletedUserContent, type DeletedUserPage } from "@/lib/account-privacy-api";

const emptyPage: DeletedUserPage = { items: [], total: 0, page: 1, pageSize: 20, totalPages: 1 };

function canAccessUserManagement(user: { isSuperAdmin: boolean; isAdministrator: boolean }): boolean {
  return isSiteManager(user);
}

export default function DeletedUsersPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [page, setPage] = useState(emptyPage);
  const [pageNumber, setPageNumber] = useState(1);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DeletedUserContent | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const currentToken = readAccessToken();
    if (!currentToken) { router.replace(localizedPath("/login", locale)); return; }
    const tokenTimer = window.setTimeout(() => setToken(currentToken), 0);
    void getMe(currentToken).then((user) => { setAllowed(canAccessUserManagement(user)); }).catch((loadError) => { if (isAuthExpiredError(loadError)) { clearAuthTokens(); router.replace(localizedPath("/", locale)); } else setError(loadError instanceof Error ? loadError.message : phrase("无法读取权限。", "Could not read permissions.")); }).finally(() => setLoading(false));
    return () => window.clearTimeout(tokenTimer);
  }, [locale, phrase, router]);

  useEffect(() => {
    if (!token || !allowed) return;
    const timer = window.setTimeout(() => { setLoading(true); void listDeletedUsers(token, { page: pageNumber, pageSize: 20, search }).then(setPage).catch((loadError) => setError(loadError instanceof Error ? loadError.message : phrase("无法读取注销账号。", "Could not load deleted accounts."))).finally(() => setLoading(false)); }, 200);
    return () => window.clearTimeout(timer);
  }, [allowed, pageNumber, phrase, search, token]);

  async function openContent(id: number) {
    if (!token) return;
    try { setSelected(await getDeletedUserContent(token, id)); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : phrase("无法读取账号内容。", "Could not load account content.")); }
  }

  if (loading && allowed === null) return <AdminPageLoading description={phrase("查看已注销账号的原始身份和内容归属。", "Review original identities and content ownership for deleted accounts.")} loadingLabel={phrase("正在读取权限", "Checking access")} title={phrase("已注销账号", "Deleted accounts")} />;
  if (!allowed) return <section className="page-shell admin-shell"><AdminPageHeader title={phrase("无权访问", "Access denied")} description={phrase("该页面仅管理员可查看。", "This page is available only to site administrators.")} /></section>;

  return <section className="page-shell admin-shell deleted-users-page"><AdminPageHeader title={phrase("已注销账号", "Deleted accounts")} description={phrase("查看已注销账号的原始身份和内容归属，公开页面仍保持匿名。", "Review original identity and content ownership while public pages remain anonymous.")} /><div className="admin-list-toolbar"><div className="admin-summary"><span>{phrase(`${page.total} 个账号`, `${page.total} accounts`)}</span></div><label className="admin-search-field deleted-users-search-field"><input onChange={(event) => { setPageNumber(1); setSearch(event.target.value); }} placeholder={phrase("搜索原用户名、昵称或邮箱", "Search original username, nickname, or email")} value={search} /><Search aria-hidden="true" size={15} /></label></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{phrase("原用户名", "Original username")}</th><th>{phrase("原昵称", "Original nickname")}</th><th>{phrase("原邮箱", "Original email")}</th><th>{phrase("注销时间", "Deleted at")}</th><th>{phrase("内容", "Content")}</th><th>{phrase("查看", "View")}</th></tr></thead><tbody>{page.items.map((item) => <tr key={item.id}><td>{item.originalUsername || "-"}</td><td>{item.originalNickname || "-"}</td><td>{item.originalEmail || "-"}</td><td>{item.deletedAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.deletedAt)) : "-"}</td><td>{phrase(`${item.articleCount} 篇文章 · ${item.commentCount} 条评论`, `${item.articleCount} articles · ${item.commentCount} comments`)}</td><td><button aria-label={phrase("查看内容归属", "View content ownership")} className="table-icon-action" onClick={() => void openContent(item.id)} title={phrase("查看内容归属", "View content ownership")} type="button"><Eye size={16} /></button></td></tr>)}{!page.items.length ? <tr><td className="admin-table-state" colSpan={6}>{phrase("暂无已注销账号。", "No deleted accounts.")}</td></tr> : null}</tbody></table></div><nav className="admin-pagination"><span>{phrase(`第 ${page.page} / ${page.totalPages} 页`, `Page ${page.page} of ${page.totalPages}`)}</span><div><button aria-label={phrase("上一页", "Previous page")} disabled={page.page <= 1 || loading} onClick={() => setPageNumber((value) => value - 1)} type="button"><ChevronLeft size={16} /></button><button aria-label={phrase("下一页", "Next page")} disabled={page.page >= page.totalPages || loading} onClick={() => setPageNumber((value) => value + 1)} type="button"><ChevronRight size={16} /></button></div></nav>{selected ? <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }} role="presentation"><section aria-modal="true" className="deleted-user-modal" role="dialog"><header><div><span className="section-label">{phrase("管理员追溯", "Administrator trace")}</span><h2>{selected.user.originalNickname || selected.user.originalUsername}</h2><p>@{selected.user.originalUsername} · {selected.user.originalEmail}</p></div><button aria-label={phrase("关闭", "Close")} className="table-icon-action" onClick={() => setSelected(null)} type="button">×</button></header><div className="deleted-user-content"><h3>{phrase("文章", "Articles")}</h3>{selected.articles.map((article) => <div key={article.id}><strong>{article.title}</strong><small>{article.status} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(article.createdAt))}</small></div>)}<h3>{phrase("评论", "Comments")}</h3>{selected.comments.map((comment) => <div key={comment.id}><strong>{comment.body}</strong><small>{comment.article.title} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(comment.createdAt))}</small></div>)}</div></section></div> : null}<AppToast message={error} onDismiss={() => setError("")} tone="error" /></section>;
}
