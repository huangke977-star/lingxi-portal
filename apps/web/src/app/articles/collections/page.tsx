"use client";

import Link from "next/link";
import Image from "next/image";
import {
  FolderOpen,
  FolderPlus,
  ImagePlus,
  Pencil,
  Plus,
  Rss,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { ArticleInfiniteFooter } from "@/components/article-infinite-scroll";
import { AppToast } from "@/components/app-toast";
import { ContentArticleManager } from "@/components/content-article-manager";
import { formatArticleDate } from "@/components/article-ui";
import { GlassSelect } from "@/components/glass-select";
import { listMyArticles, type Article } from "@/lib/article-api";
import { getMe, isAuthExpiredError, resolveApiUrl, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  addCollectionArticle,
  createCollection,
  deleteCollection,
  listMyCollections,
  listVisibleCollections,
  removeCollectionArticle,
  reorderCollectionArticles,
  subscribeCollection,
  type ArticleCollection,
  unsubscribeCollection,
  updateCollection,
  uploadCollectionCover,
} from "@/lib/discovery-api";

type CollectionView = "mine" | "browse";
type CollectionPage = Awaited<ReturnType<typeof listVisibleCollections>>;
const emptyBrowse: CollectionPage = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 12,
  totalPages: 1,
};
const COLLECTION_VISIBILITY_OPTIONS = [
  { label: "公开", value: "public" },
  { label: "登录可见", value: "authenticated" },
  { label: "仅自己", value: "private" },
] as const;

export default function ArticleCollectionsPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [view, setView] = useState<CollectionView>("browse");
  const [collections, setCollections] = useState<ArticleCollection[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] =
    useState<ArticleCollection["visibility"]>("public");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newVisibility, setNewVisibility] = useState<ArticleCollection["visibility"]>("public");
  const [newCoverPath, setNewCoverPath] = useState("");
  const [newCoverFile, setNewCoverFile] = useState<File | null>(null);
  const [newSelectedArticles, setNewSelectedArticles] = useState<Article[]>([]);
  const [editCoverFile, setEditCoverFile] = useState<File | null>(null);
  const [coverPath, setCoverPath] = useState("");
  const [browseQuery, setBrowseQuery] = useState("");
  const [browse, setBrowse] = useState<CollectionPage>(emptyBrowse);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadedBrowse, setHasLoadedBrowse] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [browseActionId, setBrowseActionId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = collections.find((item) => item.id === selectedId) ?? null;
  const newCoverPreview = useFilePreview(newCoverFile);
  const editCoverPreview = useFilePreview(editCoverFile);

  function selectCollection(next: ArticleCollection | null) {
    setSelectedId(next?.id ?? null);
    setName(next?.name ?? "");
    setDescription(next?.description ?? "");
    setVisibility(next?.visibility ?? "public");
    setCoverPath(next?.coverPath ?? "");
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login?from=%2Farticles%2Fcollections");
      return;
    }
    Promise.all([
      getMe(token),
      listMyCollections(token),
      loadAllMyPublishedArticles(token),
    ])
      .then(([currentUser, collectionResult, articleResult]) => {
        setUser(currentUser);
        setCollections(collectionResult.items);
        setArticles(articleResult);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "合集加载失败。",
        );
      })
      .finally(() => setIsLoading(false));
  }, [router]);

  useEffect(() => {
    if (view !== "browse") return;
    const token = readAccessToken();
    if (!token) return;
    let active = true;
    const timer = window.setTimeout(() => {
      listVisibleCollections(token, {
        q: browseQuery.trim(),
        page: 1,
        pageSize: 12,
      })
        .then((result) => {
          if (active) setBrowse(result);
        })
        .catch((loadError) => {
          if (active) setError(
            loadError instanceof Error
              ? loadError.message
              : "可见合集加载失败。",
          );
        })
        .finally(() => {
          if (active) setHasLoadedBrowse(true);
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [browseQuery, view]);

  const loadMore = useCallback(() => {
    const token = readAccessToken();
    if (!token || isLoadingMore || browse.page >= browse.totalPages) return;
    setIsLoadingMore(true);
    listVisibleCollections(token, {
      q: browseQuery.trim(),
      page: browse.page + 1,
      pageSize: 12,
    })
      .then((next) =>
        setBrowse((current) => ({
          ...next,
          items: [
            ...current.items,
            ...next.items.filter(
              (item) =>
                !current.items.some((existing) => existing.id === item.id),
            ),
          ],
        })),
      )
      .catch((loadError) =>
        setError(
          loadError instanceof Error ? loadError.message : "更多合集加载失败。",
        ),
      )
      .finally(() => setIsLoadingMore(false));
  }, [browse.page, browse.totalPages, browseQuery, isLoadingMore]);

  async function create(event: FormEvent) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !newName.trim()) return;
    setIsSaving(true);
    try {
      const created = await createCollection(token, {
        name: newName.trim(),
        description: newDescription.trim(),
        coverPath: newCoverPath.trim() || undefined,
        visibility: newVisibility,
        articleIds: newSelectedArticles.map((article) => article.id),
      });
      let next = created;
      if (newCoverFile) {
        try {
          next = await uploadCollectionCover(token, created.id, newCoverFile);
        } catch (uploadError) {
          setCollections((current) => [...current, created]);
          setNewName("");
          setNewDescription("");
          setNewVisibility("public");
          setNewCoverPath("");
          setNewCoverFile(null);
          setNewSelectedArticles([]);
          setIsCreateOpen(false);
          setError(uploadError instanceof Error ? `合集已创建，但封面上传失败：${uploadError.message}` : "合集已创建，但封面上传失败。");
          return;
        }
      }
      setCollections((current) => [...current, next]);
      setNewName("");
      setNewDescription("");
      setNewVisibility("public");
      setNewCoverPath("");
      setNewCoverFile(null);
      setNewSelectedArticles([]);
      setIsCreateOpen(false);
      setNotice(newCoverFile ? "合集已创建，封面已上传。" : "合集已创建。");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "合集创建失败。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function save() {
    const token = readAccessToken();
    if (!token || !selected) return;
    setIsSaving(true);
    try {
      let updated = await updateCollection(token, selected.id, {
        name: name.trim(),
        description: description.trim(),
        coverPath: editCoverFile ? selected.coverPath ?? "" : coverPath.trim(),
        visibility,
      });
      if (editCoverFile) updated = await uploadCollectionCover(token, selected.id, editCoverFile);
      replaceCollection(updated);
      selectCollection(updated);
      setEditCoverFile(null);
      setIsEditOpen(false);
      setNotice("合集设置已保存。");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "合集保存失败。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function removeCollection() {
    const token = readAccessToken();
    if (
      !token ||
      !selected ||
      !window.confirm(`删除合集“${selected.name}”吗？文章本身不会删除。`)
    )
      return;
    try {
      await deleteCollection(token, selected.id);
      const remaining = collections.filter((item) => item.id !== selected.id);
      setCollections(remaining);
      selectCollection(null);
      setEditCoverFile(null);
      setIsEditOpen(false);
      setNotice("合集已删除，文章内容未受影响。");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "合集删除失败。",
      );
    }
  }

  async function toggleArticle(articleId: number, included: boolean) {
    const token = readAccessToken();
    if (!token || !selected) return;
    try {
      replaceCollection(
        included
          ? await removeCollectionArticle(token, selected.id, articleId)
          : await addCollectionArticle(token, selected.id, articleId),
      );
      setNotice(included ? "文章已移出合集。" : "文章已加入合集。");
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "合集文章更新失败。",
      );
    }
  }

  async function reorderArticles(ids: number[]) {
    const token = readAccessToken();
    if (!token || !selected) return;
    const previous = selected;
    const articleById = new Map(
      selected.articles.map((article) => [article.id, article]),
    );
    replaceCollection({
      ...selected,
      articles: ids.flatMap((id) => articleById.get(id) ?? []),
      articleCount: ids.length,
    });
    try {
      replaceCollection(
        await reorderCollectionArticles(token, selected.id, ids),
      );
    } catch (actionError) {
      replaceCollection(previous);
      setError(
        actionError instanceof Error ? actionError.message : "合集排序失败。",
      );
    }
  }

  async function toggleNewArticle(articleId: number, included: boolean) {
    setNewSelectedArticles((current) => included
      ? current.filter((article) => article.id !== articleId)
      : [...current, ...articles.filter((article) => article.id === articleId)]);
  }

  async function reorderNewArticles(ids: number[]) {
    setNewSelectedArticles((current) => {
      const articleById = new Map(current.map((article) => [article.id, article]));
      return ids.flatMap((id) => articleById.get(id) ?? []);
    });
  }

  function replaceCollection(next: ArticleCollection) {
    setCollections((current) =>
      current.map((item) => (item.id === next.id ? next : item)),
    );
  }

  function openCollectionEditor(collection: ArticleCollection) {
    selectCollection(collection);
    setEditCoverFile(null);
    setIsEditOpen(true);
  }

  async function toggleBrowseSubscription(collection: ArticleCollection) {
    const token = readAccessToken();
    if (!token) return;
    setBrowseActionId(collection.id);
    try {
      const result = collection.subscribed ? await unsubscribeCollection(token, collection.id) : await subscribeCollection(token, collection.id);
      setBrowse((current) => ({
        ...current,
        items: current.items.map((item) => item.id === collection.id ? { ...item, subscribed: result.subscribed, subscriberCount: result.subscriberCount } : item),
      }));
      setNotice(result.subscribed ? "已订阅合集。" : "已取消合集订阅。");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "合集订阅操作失败。");
    } finally {
      setBrowseActionId(null);
    }
  }

  return (
    <section className="page-shell collection-manager-page">
      <ArticleCenterNav active="collections" isLoggedIn user={user} />
      <div className="collection-page-toolbar">
        <nav aria-label="合集页面" className="collection-page-tabs article-center-secondary-tabs">
          <button
            className={view === "browse" ? "active" : undefined}
            onClick={() => setView("browse")}
            type="button"
          >
            浏览合集
          </button>
          <button
            className={view === "mine" ? "active" : undefined}
            onClick={() => setView("mine")}
            type="button"
          >
            我的合集
          </button>
        </nav>
        {view === "browse" ? (
          <label className="collection-browse-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label="搜索合集"
              onChange={(event) => setBrowseQuery(event.target.value)}
              placeholder="搜索合集、说明、昵称或用户名"
              value={browseQuery}
            />
          </label>
        ) : (
          <button className="collection-create-action" onClick={() => setIsCreateOpen(true)} type="button"><FolderPlus aria-hidden="true" size={16} />创建合集</button>
        )}
      </div>

      {view === "browse" ? (
        <BrowseCollections
          browse={browse}
          hasLoaded={hasLoadedBrowse}
          actingId={browseActionId}
          currentUserId={user?.id ?? null}
          onToggle={toggleBrowseSubscription}
        />
      ) : (
        <section className="collection-mine-view">
          {isLoading ? (
            <div className="article-empty-state">正在读取合集。</div>
          ) : collections.length ? <div className="collection-browse-grid collection-mine-grid">{collections.map((collection) => <article aria-label={`打开合集 ${collection.name}`} className="collection-browse-card collection-mine-card" key={collection.id} onClick={() => router.push(`/collections/${collection.id}`)} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) router.push(`/collections/${collection.id}`); }} role="link" tabIndex={0}>
            <span className="collection-browse-cover">{collection.coverPath ? <Image alt="" height={258} src={resolveApiUrl(collection.coverPath)} unoptimized width={344} /> : <FolderOpen aria-hidden="true" size={34} />}<small>{collection.articleCount} 篇</small></span>
            <span className="collection-browse-copy"><strong>{collection.name}</strong><small>{collection.description || "这个合集暂时没有说明。"}</small><em>更新于 {formatArticleDate(collection.updatedAt)}</em></span>
            <footer><span>{collectionVisibilityLabel(collection.visibility)} · {collection.subscriberCount} 人订阅</span><button aria-label={`编辑 ${collection.name}`} onClick={(event) => { event.stopPropagation(); openCollectionEditor(collection); }} onKeyDown={(event) => event.stopPropagation()} title="编辑合集" type="button"><Pencil aria-hidden="true" size={15} /></button></footer>
          </article>)}</div> : <div className="article-empty-state">还没有合集，先创建一个。</div>}
        </section>
      )}
      {view === "browse" && browse.items.length ? (
        <ArticleInfiniteFooter
          hasMore={browse.page < browse.totalPages}
          isLoading={isLoadingMore}
          onLoadMore={loadMore}
        />
      ) : null}
      {isCreateOpen ? <CollectionEditorDialog coverFile={newCoverFile} coverPath={newCoverPath} coverPreview={newCoverPreview} description={newDescription} isSaving={isSaving} name={newName} onClose={() => { if (!isSaving) { setIsCreateOpen(false); setNewName(""); setNewDescription(""); setNewVisibility("public"); setNewCoverPath(""); setNewCoverFile(null); setNewSelectedArticles([]); } }} onCoverFileChange={(file) => { if (file && file.size > 10 * 1024 * 1024) { setError("合集封面不能超过 10 MB。"); return; } setNewCoverFile(file); if (file) setNewCoverPath(""); }} onCoverPathChange={(value) => { setNewCoverPath(value); if (value) setNewCoverFile(null); }} onDescriptionChange={setNewDescription} onNameChange={setNewName} onSubmit={create} onVisibilityChange={setNewVisibility} submitLabel="创建合集" title="创建合集" visibility={newVisibility}><ContentArticleManager articles={articles} noun="合集" onReorder={reorderNewArticles} onToggle={toggleNewArticle} selectedArticles={newSelectedArticles} /></CollectionEditorDialog> : null}
      {isEditOpen && selected ? <CollectionEditorDialog coverFile={editCoverFile} coverPath={coverPath} coverPreview={editCoverPreview || (coverPath ? resolveApiUrl(coverPath) : "")} description={description} isSaving={isSaving} name={name} onClose={() => { if (!isSaving) { setIsEditOpen(false); setEditCoverFile(null); selectCollection(null); } }} onCoverFileChange={(file) => { if (file && file.size > 10 * 1024 * 1024) { setError("合集封面不能超过 10 MB。"); return; } setEditCoverFile(file); if (file) setCoverPath(""); }} onCoverPathChange={(value) => { setCoverPath(value); if (value) setEditCoverFile(null); }} onDelete={() => void removeCollection()} onDescriptionChange={setDescription} onNameChange={setName} onSubmit={(event) => { event.preventDefault(); void save(); }} onVisibilityChange={setVisibility} submitLabel="保存合集" title="编辑合集" visibility={visibility}><ContentArticleManager articles={articles} noun="合集" onReorder={reorderArticles} onToggle={toggleArticle} selectedArticles={selected.articles} /></CollectionEditorDialog> : null}
      <AppToast
        message={error || notice}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        tone={error ? "error" : "success"}
      />
    </section>
  );
}

function CollectionEditorDialog({
  children,
  coverFile,
  coverPath,
  coverPreview,
  description,
  isSaving,
  name,
  onClose,
  onCoverFileChange,
  onCoverPathChange,
  onDelete,
  onDescriptionChange,
  onNameChange,
  onSubmit,
  onVisibilityChange,
  submitLabel,
  title,
  visibility,
}: {
  children?: ReactNode;
  coverFile: File | null;
  coverPath: string;
  coverPreview: string;
  description: string;
  isSaving: boolean;
  name: string;
  onClose: () => void;
  onCoverFileChange: (file: File | null) => void;
  onCoverPathChange: (value: string) => void;
  onDelete?: () => void;
  onDescriptionChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onVisibilityChange: (value: ArticleCollection["visibility"]) => void;
  submitLabel: string;
  title: string;
  visibility: ArticleCollection["visibility"];
}) {
  if (typeof document === "undefined") return null;
  return createPortal(<div className="modal-backdrop modal-backdrop--light collection-editor-backdrop" role="presentation"><form aria-modal="true" className="chat-add-friend-dialog collection-editor-dialog" onSubmit={onSubmit} role="dialog">
    <header><span><FolderOpen aria-hidden="true" size={18} /><strong>{title}</strong></span><button aria-label="关闭" disabled={isSaving} onClick={onClose} type="button"><X aria-hidden="true" size={17} /></button></header>
    <main>
      <div className="collection-form-grid">
        <label><span>合集名称</span><input autoFocus maxLength={80} onChange={(event) => onNameChange(event.target.value)} required value={name} /></label>
        <label><span>可见范围</span><GlassSelect ariaLabel="合集可见范围" disabled={isSaving} onChange={onVisibilityChange} options={COLLECTION_VISIBILITY_OPTIONS} value={visibility} /></label>
        <label className="wide"><span>封面图片地址</span><input maxLength={512} onChange={(event) => onCoverPathChange(event.target.value)} placeholder="https://example.com/collection-cover.webp" value={coverPath} /></label>
        <label className="wide"><span>合集说明</span><textarea maxLength={300} onChange={(event) => onDescriptionChange(event.target.value)} rows={3} value={description} /></label>
      </div>
      <div className="collection-editor-cover-control">
        <div className="collection-cover-preview">{coverPreview ? <Image alt="合集封面预览" height={258} src={coverPreview} unoptimized width={344} /> : <FolderOpen aria-hidden="true" size={28} />}</div>
        <span><strong>{coverFile?.name || "本地封面"}</strong><small>支持 JPEG、PNG、WebP、AVIF，最大 10 MB；本地图片优先于图片地址。</small></span>
        <label title="选择本地封面"><ImagePlus aria-hidden="true" size={16} /><span>上传图片</span><input accept="image/jpeg,image/png,image/webp,image/avif" disabled={isSaving} onChange={(event) => { onCoverFileChange(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} type="file" /></label>
      </div>
      {children}
    </main>
    <footer>{onDelete ? <button className="danger" disabled={isSaving} onClick={onDelete} type="button"><Trash2 aria-hidden="true" size={15} />删除合集</button> : <span />}<button disabled={isSaving || !name.trim()} type="submit">{title === "创建合集" ? <Plus aria-hidden="true" size={15} /> : <Save aria-hidden="true" size={15} />}{isSaving ? "处理中" : submitLabel}</button></footer>
  </form></div>, document.body);
}

function useFilePreview(file: File | null): string {
  const preview = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return preview;
}

function collectionVisibilityLabel(visibility: ArticleCollection["visibility"]): string {
  if (visibility === "authenticated") return "登录可见";
  if (visibility === "private") return "仅自己";
  return "公开";
}

function BrowseCollections({
  actingId,
  browse,
  currentUserId,
  hasLoaded,
  onToggle,
}: {
  actingId: number | null;
  browse: CollectionPage;
  currentUserId: number | null;
  hasLoaded: boolean;
  onToggle: (collection: ArticleCollection) => void;
}) {
  return (
    <section className="collection-browse">
      {!hasLoaded ? null : browse.items.length ? (
        <div className="collection-browse-grid">
          {browse.items.map((collection) => (
            <article className="collection-browse-card" key={collection.id}>
              <Link href={`/collections/${collection.id}`}>
                <span className="collection-browse-cover">
                  {collection.coverPath ? <Image alt="" height={258} src={resolveApiUrl(collection.coverPath)} unoptimized width={344} /> : <FolderOpen aria-hidden="true" size={34} />}
                  <small>{collection.articleCount} 篇</small>
                </span>
                <span className="collection-browse-copy">
                  <strong>{collection.name}</strong>
                  <small>{collection.description || "这个合集暂时没有说明。"}</small>
                  <em>{collection.owner.nickname}</em>
                </span>
              </Link>
              <footer><span>{collection.subscriberCount} 人订阅</span>{collection.owner.id === currentUserId ? null : collection.subscribed ? <button aria-label={`取消订阅 ${collection.name}`} className="active collection-subscribe-cancel" disabled={actingId === collection.id} onClick={() => onToggle(collection)} title="取消订阅" type="button"><Rss aria-hidden="true" size={15} /></button> : <button aria-label={`订阅 ${collection.name}`} disabled={actingId === collection.id} onClick={() => onToggle(collection)} title="订阅" type="button"><Rss aria-hidden="true" size={15} /></button>}</footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="article-empty-state">没有找到当前账号可见的合集。</div>
      )}
    </section>
  );
}

async function loadAllMyPublishedArticles(token: string): Promise<Article[]> {
  const first = await listMyArticles(token, {
    page: 1,
    pageSize: 50,
    status: "published",
    sort: "latest",
  });
  if (first.totalPages <= 1) return first.items;
  const rest = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) =>
      listMyArticles(token, {
        page: index + 2,
        pageSize: 50,
        status: "published",
        sort: "latest",
      }),
    ),
  );
  return [first, ...rest].flatMap((page) => page.items);
}
