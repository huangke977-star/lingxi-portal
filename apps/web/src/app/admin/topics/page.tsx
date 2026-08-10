"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AppToast } from "@/components/app-toast";
import { formatArticleDate } from "@/components/article-ui";
import { listAdminArticles, type Article } from "@/lib/article-api";
import { listRoles } from "@/lib/admin-api";
import { getMe, isAuthExpiredError, type AuthRole, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  addTopicArticle,
  createTopic,
  deleteTopic,
  listAdminTopics,
  removeTopicArticle,
  reorderTopicArticles,
  type ArticleTopic,
  updateTopic,
} from "@/lib/discovery-api";

const blankTopic = { title: "", slug: "", description: "", coverPath: "", visibility: "public" as ArticleTopic["visibility"], status: "active" as ArticleTopic["status"], sortOrder: 0, roleCodes: [] as string[] };

export default function TopicManagementPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [topics, setTopics] = useState<ArticleTopic[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState(blankTopic);
  const [articleToAdd, setArticleToAdd] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = topics.find((topic) => topic.id === selectedId) ?? null;
  const availableArticles = useMemo(() => articles.filter((article) => !selected?.articles.some((item) => item.id === article.id)), [articles, selected]);

  function selectTopic(next: ArticleTopic | null) {
    setSelectedId(next?.id ?? null);
    setDraft(next ? {
      title: next.title,
      slug: next.slug,
      description: next.description,
      coverPath: next.coverPath ?? "",
      visibility: next.visibility,
      status: next.status,
      sortOrder: next.sortOrder,
      roleCodes: next.roleCodes,
    } : blankTopic);
    setArticleToAdd(0);
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) { router.replace("/login?from=%2Fadmin%2Ftopics"); return; }
    getMe(token).then(async (currentUser) => {
      if (!currentUser.isSuperAdmin && currentUser.role.level < 90) throw new Error("需要管理员权限。");
      const [topicResult, articleResult, roleResult] = await Promise.all([listAdminTopics(token), listAdminArticles(token, { page: 1, pageSize: 50, sort: "latest" }), listRoles()]);
      const first = topicResult.items[0] ?? null;
      setUser(currentUser);
      setTopics(topicResult.items);
      setArticles(articleResult.items);
      setRoles(roleResult);
      setSelectedId(first?.id ?? null);
      setDraft(first ? {
        title: first.title,
        slug: first.slug,
        description: first.description,
        coverPath: first.coverPath ?? "",
        visibility: first.visibility,
        status: first.status,
        sortOrder: first.sortOrder,
        roleCodes: first.roleCodes,
      } : blankTopic);
      setArticleToAdd(0);
    }).catch((loadError) => {
      if (isAuthExpiredError(loadError)) { clearAuthTokens(); router.replace("/"); return; }
      setError(loadError instanceof Error ? loadError.message : "专题管理加载失败。");
    }).finally(() => setIsLoading(false));
  }, [router]);

  async function save() {
    const token = readAccessToken();
    if (!token || !draft.title.trim()) return;
    setIsSaving(true);
    try {
      const saved = selected ? await updateTopic(token, selected.id, draft) : await createTopic(token, draft);
      setTopics((current) => selected ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      selectTopic(saved); setNotice(selected ? "专题已保存。" : "专题已创建。");
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "专题保存失败。"); }
    finally { setIsSaving(false); }
  }

  async function remove() {
    const token = readAccessToken();
    if (!token || !selected || !window.confirm(`删除专题“${selected.title}”吗？文章本身不会删除。`)) return;
    try { const remaining = topics.filter((item) => item.id !== selected.id); await deleteTopic(token, selected.id); setTopics(remaining); selectTopic(remaining[0] ?? null); setNotice("专题已删除。"); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "专题删除失败。"); }
  }

  async function addArticle() {
    const token = readAccessToken(); if (!token || !selected || !articleToAdd) return;
    try { replace(await addTopicArticle(token, selected.id, articleToAdd)); setArticleToAdd(0); setNotice("文章已加入专题。"); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "文章添加失败。"); }
  }

  async function removeArticle(articleId: number) {
    const token = readAccessToken(); if (!token || !selected) return;
    try { replace(await removeTopicArticle(token, selected.id, articleId)); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "文章移除失败。"); }
  }

  async function moveArticle(index: number, offset: -1 | 1) {
    const token = readAccessToken(); if (!token || !selected) return;
    const target = index + offset; if (target < 0 || target >= selected.articles.length) return;
    const ids = selected.articles.map((article) => article.id); [ids[index], ids[target]] = [ids[target], ids[index]];
    try { replace(await reorderTopicArticles(token, selected.id, ids)); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "专题排序失败。"); }
  }

  function replace(topic: ArticleTopic) { setTopics((current) => current.map((item) => item.id === topic.id ? topic : item)); }
  function toggleRole(code: string) { setDraft((current) => ({ ...current, roleCodes: current.roleCodes.includes(code) ? current.roleCodes.filter((item) => item !== code) : [...current.roleCodes, code] })); }

  return <section className="page-shell topic-management-page"><ArticleCenterNav active="manage" isLoggedIn user={user} /><div className="topics-toolbar"><span>专题管理</span><button onClick={() => selectTopic(null)} type="button"><Plus aria-hidden="true" size={16} />新建专题</button></div>{isLoading ? <div className="article-empty-state">正在读取专题管理。</div> : <div className="topic-manager-layout"><aside className="topic-manager-list">{topics.map((topic) => <button className={topic.id === selectedId ? "active" : undefined} key={topic.id} onClick={() => selectTopic(topic)} type="button"><span><strong>{topic.title}</strong><small>{topic.articleCount} 篇 · {topic.status === "active" ? "已启用" : "已停用"}</small></span><em>{topic.visibility === "public" ? "公开" : topic.visibility === "authenticated" ? "登录可见" : "指定角色"}</em></button>)}{!topics.length ? <div className="article-empty-inline">还没有专题。</div> : null}</aside><section className="topic-inspector"><header><strong>{selected ? selected.title : "新建专题"}</strong>{selected ? <Link href={`/topics/${selected.slug}`}><ExternalLink aria-hidden="true" size={15} />查看</Link> : null}</header><div className="topic-form-grid"><label><span>专题名称</span><input maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} value={draft.title} /></label><label><span>路径标识</span><input maxLength={120} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} placeholder="留空自动生成" value={draft.slug} /></label><label><span>可见范围</span><select onChange={(event) => setDraft({ ...draft, visibility: event.target.value as ArticleTopic["visibility"] })} value={draft.visibility}><option value="public">公开</option><option value="authenticated">登录可见</option><option value="role_restricted">指定角色</option></select></label><label><span>状态</span><select onChange={(event) => setDraft({ ...draft, status: event.target.value as ArticleTopic["status"] })} value={draft.status}><option value="active">启用</option><option value="disabled">停用</option></select></label><label><span>排序</span><input min={0} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) })} type="number" value={draft.sortOrder} /></label><label className="wide"><span>封面路径或网址</span><input maxLength={512} onChange={(event) => setDraft({ ...draft, coverPath: event.target.value })} value={draft.coverPath} /></label><label className="wide"><span>专题说明</span><textarea maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={3} value={draft.description} /></label></div>{draft.visibility === "role_restricted" ? <div className="topic-role-grid">{roles.map((role) => <label key={role.code}><input checked={draft.roleCodes.includes(role.code)} onChange={() => toggleRole(role.code)} type="checkbox" />{role.name}</label>)}</div> : null}<div className="topic-inspector-actions">{selected ? <button className="text-danger-action" onClick={() => void remove()} type="button"><Trash2 aria-hidden="true" size={15} />删除专题</button> : <span /> }<button className="button" disabled={isSaving || !draft.title.trim()} onClick={() => void save()} type="button"><Save aria-hidden="true" size={16} />{isSaving ? "保存中" : "保存"}</button></div>{selected ? <><div className="collection-article-adder"><select onChange={(event) => setArticleToAdd(Number(event.target.value))} value={articleToAdd}><option value={0}>选择文章加入专题</option>{availableArticles.map((article) => <option key={article.id} value={article.id}>{article.title}</option>)}</select><button disabled={!articleToAdd} onClick={() => void addArticle()} type="button"><Plus aria-hidden="true" size={15} />加入</button></div><div className="collection-article-list">{selected.articles.map((article, index) => <article key={article.id}><span><strong>{article.title}</strong><small>{article.author.nickname} · {formatArticleDate(article.publishedAt)}</small></span><div><button aria-label="上移" disabled={!index} onClick={() => void moveArticle(index, -1)} type="button"><ArrowUp aria-hidden="true" size={15} /></button><button aria-label="下移" disabled={index === selected.articles.length - 1} onClick={() => void moveArticle(index, 1)} type="button"><ArrowDown aria-hidden="true" size={15} /></button><button aria-label="移出专题" onClick={() => void removeArticle(article.id)} type="button"><X aria-hidden="true" size={15} /></button></div></article>)}</div></> : null}</section></div>}<AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} /></section>;
}
