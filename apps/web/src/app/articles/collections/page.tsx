"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink, FolderPlus, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AppToast } from "@/components/app-toast";
import { formatArticleDate } from "@/components/article-ui";
import { listMyArticles, type Article } from "@/lib/article-api";
import { getMe, isAuthExpiredError, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  addCollectionArticle,
  createCollection,
  deleteCollection,
  listMyCollections,
  removeCollectionArticle,
  reorderCollectionArticles,
  type ArticleCollection,
  updateCollection,
} from "@/lib/discovery-api";

export default function ArticleCollectionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [collections, setCollections] = useState<ArticleCollection[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<ArticleCollection["visibility"]>("public");
  const [newName, setNewName] = useState("");
  const [articleToAdd, setArticleToAdd] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = collections.find((item) => item.id === selectedId) ?? null;
  const availableArticles = useMemo(() => articles.filter((article) => !selected?.articles.some((item) => item.id === article.id)), [articles, selected]);

  function selectCollection(next: ArticleCollection | null) {
    setSelectedId(next?.id ?? null);
    setName(next?.name ?? "");
    setDescription(next?.description ?? "");
    setVisibility(next?.visibility ?? "public");
    setArticleToAdd(0);
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) { router.replace("/login?from=%2Farticles%2Fcollections"); return; }
    Promise.all([
      getMe(token),
      listMyCollections(token),
      listMyArticles(token, { page: 1, pageSize: 50, status: "published", sort: "latest" }),
    ]).then(([currentUser, collectionResult, articleResult]) => {
      const first = collectionResult.items[0] ?? null;
      setUser(currentUser);
      setCollections(collectionResult.items);
      setArticles(articleResult.items);
      setSelectedId(first?.id ?? null);
      setName(first?.name ?? "");
      setDescription(first?.description ?? "");
      setVisibility(first?.visibility ?? "public");
      setArticleToAdd(0);
    }).catch((loadError) => {
      if (isAuthExpiredError(loadError)) { clearAuthTokens(); router.replace("/"); return; }
      setError(loadError instanceof Error ? loadError.message : "合集加载失败。");
    }).finally(() => setIsLoading(false));
  }, [router]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !newName.trim()) return;
    setIsSaving(true);
    try {
      const created = await createCollection(token, { name: newName.trim() });
      setCollections((current) => [...current, created]);
      selectCollection(created);
      setNewName("");
      setNotice("合集已创建。");
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "合集创建失败。"); }
    finally { setIsSaving(false); }
  }

  async function save() {
    const token = readAccessToken();
    if (!token || !selected) return;
    setIsSaving(true);
    try {
      const updated = await updateCollection(token, selected.id, { name: name.trim(), description: description.trim(), visibility });
      replaceCollection(updated);
      setNotice("合集设置已保存。");
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "合集保存失败。"); }
    finally { setIsSaving(false); }
  }

  async function removeCollection() {
    const token = readAccessToken();
    if (!token || !selected || !window.confirm(`删除合集“${selected.name}”吗？文章本身不会删除。`)) return;
    try {
      await deleteCollection(token, selected.id);
      const remaining = collections.filter((item) => item.id !== selected.id);
      setCollections(remaining);
      selectCollection(remaining[0] ?? null);
      setNotice("合集已删除，文章内容未受影响。");
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "合集删除失败。"); }
  }

  async function addArticle() {
    const token = readAccessToken();
    if (!token || !selected || !articleToAdd) return;
    try {
      replaceCollection(await addCollectionArticle(token, selected.id, articleToAdd));
      setArticleToAdd(0);
      setNotice("文章已加入合集。");
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "文章添加失败。"); }
  }

  async function removeArticle(articleId: number) {
    const token = readAccessToken();
    if (!token || !selected) return;
    try {
      replaceCollection(await removeCollectionArticle(token, selected.id, articleId));
      setNotice("文章已移出合集。");
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "文章移除失败。"); }
  }

  async function moveArticle(index: number, offset: -1 | 1) {
    const token = readAccessToken();
    if (!token || !selected) return;
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= selected.articles.length) return;
    const ids = selected.articles.map((article) => article.id);
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    try { replaceCollection(await reorderCollectionArticles(token, selected.id, ids)); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "合集排序失败。"); }
  }

  function replaceCollection(next: ArticleCollection) {
    setCollections((current) => current.map((item) => item.id === next.id ? next : item));
  }

  return <section className="page-shell collection-manager-page">
    <ArticleCenterNav active="collections" isLoggedIn user={user} />
    <form className="collection-create-bar" onSubmit={create}><FolderPlus aria-hidden="true" size={18} /><input aria-label="新合集名称" maxLength={80} onChange={(event) => setNewName(event.target.value)} placeholder="新合集名称" value={newName} /><button disabled={isSaving || !newName.trim()} type="submit"><Plus aria-hidden="true" size={16} />创建</button></form>
    {isLoading ? <div className="article-empty-state">正在读取合集。</div> : <div className="collection-manager-layout">
      <aside className="collection-manager-list">{collections.map((collection) => <button className={collection.id === selectedId ? "active" : undefined} key={collection.id} onClick={() => selectCollection(collection)} type="button"><span><strong>{collection.name}</strong><small>{collection.articleCount} 篇文章</small></span><em>{collection.visibility === "public" ? "公开" : collection.visibility === "authenticated" ? "登录可见" : "仅自己"}</em></button>)}{!collections.length ? <div className="article-empty-inline">先创建一个合集。</div> : null}</aside>
      <section className="collection-inspector">{selected ? <>
        <header><div><strong>{selected.name}</strong><span>更新于 {formatArticleDate(selected.updatedAt)}</span></div><Link href={`/collections/${selected.id}`}><ExternalLink aria-hidden="true" size={15} />查看</Link></header>
        <div className="collection-form-grid"><label><span>合集名称</span><input maxLength={80} onChange={(event) => setName(event.target.value)} value={name} /></label><label><span>可见范围</span><select onChange={(event) => setVisibility(event.target.value as ArticleCollection["visibility"])} value={visibility}><option value="public">公开</option><option value="authenticated">登录可见</option><option value="private">仅自己</option></select></label><label className="wide"><span>合集说明</span><textarea maxLength={300} onChange={(event) => setDescription(event.target.value)} rows={2} value={description} /></label></div>
        <div className="collection-inspector-actions"><button className="text-danger-action" onClick={() => void removeCollection()} type="button"><Trash2 aria-hidden="true" size={15} />删除合集</button><button className="button" disabled={isSaving || !name.trim()} onClick={() => void save()} type="button"><Save aria-hidden="true" size={16} />保存</button></div>
        <div className="collection-article-adder"><select aria-label="选择文章加入合集" onChange={(event) => setArticleToAdd(Number(event.target.value))} value={articleToAdd}><option value={0}>选择已发布文章</option>{availableArticles.map((article) => <option key={article.id} value={article.id}>{article.title}</option>)}</select><button disabled={!articleToAdd} onClick={() => void addArticle()} type="button"><Plus aria-hidden="true" size={15} />加入</button></div>
        <div className="collection-article-list">{selected.articles.map((article, index) => <article key={article.id}><span><strong>{article.title}</strong><small>{article.category || "随笔"} · {formatArticleDate(article.publishedAt)}</small></span><div><button aria-label="上移" disabled={index === 0} onClick={() => void moveArticle(index, -1)} title="上移" type="button"><ArrowUp aria-hidden="true" size={15} /></button><button aria-label="下移" disabled={index === selected.articles.length - 1} onClick={() => void moveArticle(index, 1)} title="下移" type="button"><ArrowDown aria-hidden="true" size={15} /></button><button aria-label="移出合集" onClick={() => void removeArticle(article.id)} title="移出合集" type="button"><X aria-hidden="true" size={15} /></button></div></article>)}{!selected.articles.length ? <div className="article-empty-inline">这个合集还没有文章。</div> : null}</div>
      </> : <div className="article-empty-state">选择或创建一个合集。</div>}</section>
    </div>}
    <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}
