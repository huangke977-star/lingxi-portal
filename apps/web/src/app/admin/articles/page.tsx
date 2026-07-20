"use client";

import Link from "next/link";
import { Eye, Flag, MessageSquare, Pin, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { Article, ArticleComment, ARTICLE_STATUS_LABEL, ARTICLE_VISIBILITY_LABEL, listAdminArticles, listAdminComments, moderateArticle, moderateArticleComment } from "@/lib/article-api";
import { getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

export default function AdminArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [comments, setComments] = useState<ArticleComment[]>([]);
  const [selected, setSelected] = useState<Article | null>(null);
  const [activeTab, setActiveTab] = useState<"articles" | "comments">("articles");
  const [status, setStatus] = useState<Article["status"]>("published");
  const [visibility, setVisibility] = useState<Article["visibility"]>("public");
  const [roleCodes, setRoleCodes] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [pinOrder, setPinOrder] = useState(0);
  const [titleColor, setTitleColor] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load(token: string) {
    const [articleResult, commentResult] = await Promise.all([
      listAdminArticles(token, { pageSize: 50, sort: "latest" }),
      listAdminComments(token),
    ]);
    setArticles(articleResult.items);
    setComments(commentResult.items);
    if (!selected && articleResult.items[0]) selectArticle(articleResult.items[0]);
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      window.location.href = "/login?from=%2Fadmin%2Farticles";
      return;
    }
    // Both requests hydrate the protected admin workspace after navigation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    Promise.all([getMe(token), load(token)])
      .then(([currentUser]) => {
        if (!currentUser.isSuperAdmin && currentUser.role.level < 90) {
          window.location.href = "/";
          return;
        }
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          window.location.href = "/";
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "无法加载文章管理。");
      })
      .finally(() => setIsLoading(false));
    // Admin access is checked by the API as well; this is only the page gate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectArticle(article: Article) {
    setSelected(article);
    setStatus(article.status);
    setVisibility(article.visibility);
    setRoleCodes(article.allowedRoles.map((role) => role.code).join(", "));
    setIsPinned(article.isPinned);
    setPinOrder(article.pinOrder);
    setTitleColor(article.titleColor);
    setBlockedReason(article.blockedReason ?? "");
  }

  async function saveArticleModeration() {
    const token = readAccessToken();
    if (!token || !selected) return;
    setIsSaving(true);
    try {
      const updated = await moderateArticle(token, selected.id, {
        status,
        visibility,
        roleCodes: roleCodes.split(",").map((value) => value.trim()).filter(Boolean),
        isPinned,
        pinOrder,
        titleColor,
        blockedReason,
      });
      setArticles((current) => current.map((article) => article.id === updated.id ? updated : article));
      setSelected(updated);
      setNotice("文章管理设置已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败。");
    } finally {
      setIsSaving(false);
    }
  }

  async function changeCommentStatus(comment: ArticleComment, nextStatus: ArticleComment["status"]) {
    const token = readAccessToken();
    if (!token) return;
    try {
      await moderateArticleComment(token, comment.id, nextStatus);
      setComments((current) => current.map((item) => item.id === comment.id ? { ...item, status: nextStatus } : item));
      setNotice(nextStatus === "active" ? "回复已恢复。" : "回复已处理。 ");
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "回复处理失败。");
    }
  }

  return (
    <section className="page-shell admin-articles-page">
      <header className="page-header"><span className="eyebrow">Content Control</span><div className="title-row"><div><h1>文章管理</h1><p>管理文章、回复、阅读权限和展示排序。</p></div><Link className="text-action" href="/articles"><Eye aria-hidden="true" size={16} />查看文章</Link></div></header>
      {isLoading ? <div className="article-empty-state">正在读取内容管理。</div> : <>
        <div className="admin-content-tabs"><button className={activeTab === "articles" ? "active" : undefined} onClick={() => setActiveTab("articles")} type="button"><FileTextIcon />文章 <span>{articles.length}</span></button><button className={activeTab === "comments" ? "active" : undefined} onClick={() => setActiveTab("comments")} type="button"><MessageSquare aria-hidden="true" size={16} />评论与回复 <span>{comments.length}</span></button></div>
        {activeTab === "articles" ? <div className="admin-articles-layout"><aside className="admin-article-list">{articles.map((article) => <button className={`admin-article-row${selected?.id === article.id ? " active" : ""}`} key={article.id} onClick={() => selectArticle(article)} type="button"><span><strong>{article.title}</strong><small>{article.author.nickname} · {ARTICLE_STATUS_LABEL[article.status]}</small></span>{article.isPinned ? <Pin aria-hidden="true" size={15} /> : null}</button>)}{!articles.length ? <div className="article-empty-inline">暂时没有文章。</div> : null}</aside><section className="admin-article-inspector">{selected ? <><div className="admin-inspector-heading"><div><span className="section-label">Article Inspector</span><h2>{selected.title}</h2></div><span className="admin-article-author">{selected.author.nickname}</span></div><div className="admin-stat-strip"><span><Eye aria-hidden="true" size={15} />{selected.viewCount}<small>阅读</small></span><span><HeartIcon />{selected.likeCount}<small>点赞</small></span><span><MessageSquare aria-hidden="true" size={15} />{selected.commentCount}<small>评论</small></span><span><BookmarkIcon />{selected.favoriteCount}<small>收藏</small></span></div><div className="admin-article-controls"><label>文章状态<select onChange={(event) => setStatus(event.target.value as Article["status"])} value={status}>{Object.entries(ARTICLE_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>阅读权限<select onChange={(event) => setVisibility(event.target.value as Article["visibility"])} value={visibility}>{Object.entries(ARTICLE_VISIBILITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>标题颜色<input aria-label="标题颜色" onChange={(event) => setTitleColor(event.target.value)} type="color" value={titleColor || "#2b2530"} /></label><label>置顶顺序<input min={0} onChange={(event) => setPinOrder(Number(event.target.value))} type="number" value={pinOrder} /></label></div>{visibility === "role_restricted" ? <input className="admin-role-input" onChange={(event) => setRoleCodes(event.target.value)} placeholder="角色代码，用逗号分隔" value={roleCodes} /> : null}<label className="admin-pin-check"><input checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} type="checkbox" /><Pin aria-hidden="true" size={16} />置顶文章</label><label className="admin-reason-field">屏蔽说明<textarea maxLength={255} onChange={(event) => setBlockedReason(event.target.value)} placeholder="文章被屏蔽时可以记录原因" rows={3} value={blockedReason} /></label><div className="admin-inspector-footer"><span>更新于 {new Date(selected.updatedAt).toLocaleString("zh-CN")}</span><button className="button" disabled={isSaving} onClick={() => void saveArticleModeration()} type="button"><Save aria-hidden="true" size={16} />{isSaving ? "保存中" : "保存设置"}</button></div></> : <div className="article-empty-state">选择一篇文章查看管理项。</div>}</section></div> : <div className="admin-comments-table">{comments.map((comment) => <article className={`admin-comment-row ${comment.status}`} key={comment.id}><div className="admin-comment-row-heading"><strong>{comment.author.nickname}</strong><span>{new Date(comment.createdAt).toLocaleString("zh-CN")}</span><span className={`article-status-dot ${comment.status}`}>{comment.status === "active" ? "正常" : comment.status === "blocked" ? "已屏蔽" : "已删除"}</span></div><p>{comment.body}</p><div className="admin-comment-row-actions">{comment.status !== "active" ? <button onClick={() => void changeCommentStatus(comment, "active")} type="button"><ShieldCheck aria-hidden="true" size={15} />恢复</button> : <button onClick={() => void changeCommentStatus(comment, "blocked")} type="button"><Flag aria-hidden="true" size={15} />屏蔽</button>}<button className="text-danger-action" onClick={() => void changeCommentStatus(comment, "deleted")} type="button"><Trash2 aria-hidden="true" size={15} />删除</button></div></article>)}{!comments.length ? <div className="article-empty-state">暂时没有评论和回复。</div> : null}</div>}
      </>}
      <AppToast duration={notice ? 2600 : 4200} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function FileTextIcon() {
  return <span aria-hidden="true" className="article-tab-icon">文</span>;
}

function HeartIcon() {
  return <span aria-hidden="true" className="article-stat-symbol">赞</span>;
}

function BookmarkIcon() {
  return <span aria-hidden="true" className="article-stat-symbol">藏</span>;
}
