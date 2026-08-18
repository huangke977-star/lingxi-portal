"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { ExternalLink, ImagePlus, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ChangeEvent, useEffect, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AppToast } from "@/components/app-toast";
import { ContentArticleManager } from "@/components/content-article-manager";
import { listAdminArticles, type Article } from "@/lib/article-api";
import { listRoles } from "@/lib/admin-api";
import {
  getMe,
  isAuthExpiredError,
  resolveApiUrl,
  type AuthRole,
  type AuthUser,
} from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { isSiteManager } from "@/lib/user-permissions";
import {
  addTopicArticle,
  createTopic,
  deleteTopic,
  listAdminTopics,
  removeTopicArticle,
  reorderTopicArticles,
  type ArticleTopic,
  updateTopic,
  uploadTopicCover,
} from "@/lib/discovery-api";

const blankTopic = {
  title: "",
  slug: "",
  description: "",
  coverPath: "",
  visibility: "public" as ArticleTopic["visibility"],
  status: "active" as ArticleTopic["status"],
  sortOrder: 0,
  roleCodes: [] as string[],
};

export default function TopicManagementPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [topics, setTopics] = useState<ArticleTopic[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState(blankTopic);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = topics.find((topic) => topic.id === selectedId) ?? null;

  function selectTopic(next: ArticleTopic | null) {
    setSelectedId(next?.id ?? null);
    setDraft(
      next
        ? {
            title: next.title,
            slug: next.slug,
            description: next.description,
            coverPath: next.coverPath ?? "",
            visibility: next.visibility,
            status: next.status,
            sortOrder: next.sortOrder,
            roleCodes: next.roleCodes,
          }
        : blankTopic,
    );
  }

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login?from=%2Fadmin%2Ftopics");
      return;
    }
    getMe(token)
      .then(async (currentUser) => {
        if (!isSiteManager(currentUser))
          throw new Error("需要管理员权限。");
        const [topicResult, articleResult, roleResult] = await Promise.all([
          listAdminTopics(token),
          loadAllPublishedArticles(token),
          listRoles(),
        ]);
        const first = topicResult.items[0] ?? null;
        setUser(currentUser);
        setTopics(topicResult.items);
        setArticles(articleResult);
        setRoles(roleResult);
        selectTopic(first);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : "专题管理加载失败。",
        );
      })
      .finally(() => setIsLoading(false));
  }, [router]);

  async function save() {
    const token = readAccessToken();
    if (!token || !draft.title.trim()) return;
    setIsSaving(true);
    try {
      const saved = selected
        ? await updateTopic(token, selected.id, draft)
        : await createTopic(token, draft);
      setTopics((current) =>
        selected
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved],
      );
      selectTopic(saved);
      setNotice(
        selected
          ? "专题设置已保存。"
          : "专题已创建，现在可以上传封面和选择文章。",
      );
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "专题保存失败。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function remove() {
    const token = readAccessToken();
    if (
      !token ||
      !selected ||
      !window.confirm(`删除专题“${selected.title}”吗？文章本身不会删除。`)
    )
      return;
    try {
      await deleteTopic(token, selected.id);
      const remaining = topics.filter((item) => item.id !== selected.id);
      setTopics(remaining);
      selectTopic(remaining[0] ?? null);
      setNotice("专题已删除，文章内容未受影响。");
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : "专题删除失败。",
      );
    }
  }

  async function uploadCover(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    const token = readAccessToken();
    if (!file || !token || !selected) return;
    if (file.size > 10 * 1024 * 1024) {
      setError("专题封面不能超过 10 MB。");
      return;
    }
    setIsUploading(true);
    try {
      const updated = await uploadTopicCover(token, selected.id, file);
      replace(updated);
      setDraft((current) => ({
        ...current,
        coverPath: updated.coverPath ?? "",
      }));
      setNotice("专题封面已上传并立即生效。");
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "专题封面上传失败。",
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function toggleArticle(articleId: number, included: boolean) {
    const token = readAccessToken();
    if (!token || !selected) return;
    try {
      replace(
        included
          ? await removeTopicArticle(token, selected.id, articleId)
          : await addTopicArticle(token, selected.id, articleId),
      );
      setNotice(included ? "文章已移出专题。" : "文章已加入专题。");
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : "专题文章更新失败。",
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
    replace({
      ...selected,
      articles: ids.flatMap((id) => articleById.get(id) ?? []),
      articleCount: ids.length,
    });
    try {
      replace(await reorderTopicArticles(token, selected.id, ids));
    } catch (actionError) {
      replace(previous);
      setError(
        actionError instanceof Error ? actionError.message : "专题排序失败。",
      );
    }
  }

  function replace(topic: ArticleTopic) {
    setTopics((current) =>
      current.map((item) => (item.id === topic.id ? topic : item)),
    );
  }

  function toggleRole(code: string) {
    setDraft((current) => ({
      ...current,
      roleCodes: current.roleCodes.includes(code)
        ? current.roleCodes.filter((item) => item !== code)
        : [...current.roleCodes, code],
    }));
  }

  return (
    <section className="page-shell topic-management-page">
      <ArticleCenterNav active="manage" isLoggedIn user={user} />
      <div className="topics-toolbar">
        <span>专题管理</span>
        <button onClick={() => selectTopic(null)} type="button">
          <Plus aria-hidden="true" size={16} />
          新建专题
        </button>
      </div>
      {isLoading ? (
        <div className="article-empty-state">正在读取专题管理。</div>
      ) : (
        <div className="topic-manager-layout">
          <aside className="topic-manager-list">
            {topics.map((topic) => (
              <button
                className={topic.id === selectedId ? "active" : undefined}
                key={topic.id}
                onClick={() => selectTopic(topic)}
                type="button"
              >
                <span>
                  <strong>{topic.title}</strong>
                  <small>
                    {topic.articleCount} 篇 ·{" "}
                    {topic.status === "active" ? "已启用" : "已停用"}
                  </small>
                </span>
                <em>
                  {topic.visibility === "public"
                    ? "公开"
                    : topic.visibility === "authenticated"
                      ? "登录可见"
                      : "指定角色"}
                </em>
              </button>
            ))}
            {!topics.length ? (
              <div className="article-empty-inline">还没有专题。</div>
            ) : null}
          </aside>
          <section className="topic-inspector">
            <header>
              <strong>{selected ? selected.title : "新建专题"}</strong>
              <span className="inspector-header-actions">
                {selected ? (
                  <Link href={`/topics/${selected.slug}`}>
                    <ExternalLink aria-hidden="true" size={15} />
                    查看
                  </Link>
                ) : null}
                <button
                  disabled={isSaving || !draft.title.trim()}
                  onClick={() => void save()}
                  type="button"
                >
                  <Save aria-hidden="true" size={15} />
                  {isSaving ? "保存中" : "保存"}
                </button>
                {selected ? (
                  <button
                    className="danger"
                    onClick={() => void remove()}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                    删除
                  </button>
                ) : null}
              </span>
            </header>
            <div className="topic-form-grid">
              <label>
                <span>专题名称</span>
                <input
                  maxLength={80}
                  onChange={(event) =>
                    setDraft({ ...draft, title: event.target.value })
                  }
                  value={draft.title}
                />
              </label>
              <label>
                <span>路径标识</span>
                <input
                  maxLength={120}
                  onChange={(event) =>
                    setDraft({ ...draft, slug: event.target.value })
                  }
                  placeholder="留空自动生成"
                  value={draft.slug}
                />
              </label>
              <label>
                <span>可见范围</span>
                <select
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      visibility: event.target
                        .value as ArticleTopic["visibility"],
                    })
                  }
                  value={draft.visibility}
                >
                  <option value="public">公开</option>
                  <option value="authenticated">登录可见</option>
                  <option value="role_restricted">指定角色</option>
                </select>
              </label>
              <label>
                <span>状态</span>
                <select
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      status: event.target.value as ArticleTopic["status"],
                    })
                  }
                  value={draft.status}
                >
                  <option value="active">启用</option>
                  <option value="disabled">停用</option>
                </select>
              </label>
              <label>
                <span>排序</span>
                <input
                  min={0}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      sortOrder: Number(event.target.value),
                    })
                  }
                  type="number"
                  value={draft.sortOrder}
                />
              </label>
              <label className="wide">
                <span>封面图片地址</span>
                <input
                  maxLength={512}
                  onChange={(event) =>
                    setDraft({ ...draft, coverPath: event.target.value })
                  }
                  placeholder="https://example.com/cover.webp"
                  value={draft.coverPath}
                />
              </label>
              <label className="wide">
                <span>专题说明</span>
                <textarea
                  maxLength={500}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                  rows={3}
                  value={draft.description}
                />
              </label>
            </div>
            <div className="topic-cover-control">
              <div className="topic-cover-preview">
                {draft.coverPath ? (
                  <img
                    alt="专题封面预览"
                    src={resolveApiUrl(draft.coverPath)}
                  />
                ) : (
                  <span>{draft.title.trim().slice(0, 2) || "封面"}</span>
                )}
              </div>
              <span>
                <strong>本地封面</strong>
                <small>
                  {selected
                    ? "支持 JPEG、PNG、WebP、AVIF，最大 10 MB；上传后立即生效。"
                    : "先保存专题，再上传本地封面。"}
                </small>
              </span>
              <label className={selected && !isUploading ? "" : "disabled"}>
                <ImagePlus aria-hidden="true" size={16} />
                {isUploading ? "上传中" : "上传图片"}
                <input
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  disabled={!selected || isUploading}
                  onChange={(event) => void uploadCover(event)}
                  type="file"
                />
              </label>
            </div>
            {draft.visibility === "role_restricted" ? (
              <div className="topic-role-grid">
                {roles.map((role) => (
                  <label key={role.code}>
                    <input
                      checked={draft.roleCodes.includes(role.code)}
                      onChange={() => toggleRole(role.code)}
                      type="checkbox"
                    />
                    {role.name}
                  </label>
                ))}
              </div>
            ) : null}
            {selected ? (
              <ContentArticleManager
                articles={articles}
                noun="专题"
                onReorder={reorderArticles}
                onToggle={toggleArticle}
                selectedArticles={selected.articles}
              />
            ) : (
              <div className="article-empty-inline">
                保存专题后即可选择文章。
              </div>
            )}
          </section>
        </div>
      )}
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

async function loadAllPublishedArticles(token: string): Promise<Article[]> {
  const first = await listAdminArticles(token, {
    page: 1,
    pageSize: 50,
    status: "published",
    sort: "latest",
  });
  if (first.totalPages <= 1) return first.items;
  const rest = await Promise.all(
    Array.from({ length: first.totalPages - 1 }, (_, index) =>
      listAdminArticles(token, {
        page: index + 2,
        pageSize: 50,
        status: "published",
        sort: "latest",
      }),
    ),
  );
  return [first, ...rest].flatMap((page) => page.items);
}
