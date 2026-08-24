"use client";

import Image from "next/image";
import Link from "next/link";
import { Pencil, Plus, Rss, Search } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ArticleCenterNav } from "@/components/article-center-nav";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { TopicEditorDialog, type TopicEditorDraft } from "@/components/topic-editor-dialog";
import { listAdminArticles, type Article } from "@/lib/article-api";
import { listRoles } from "@/lib/admin-api";
import { getMe, isAuthExpiredError, resolveApiUrl, type AuthRole, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  addTopicArticle,
  createTopic,
  deleteTopic,
  listAdminTopics,
  listTopics,
  removeTopicArticle,
  reorderTopicArticles,
  subscribeTopic,
  type ArticleTopic,
  unsubscribeTopic,
  updateTopic,
  uploadTopicCover,
} from "@/lib/discovery-api";
import { isSiteManager } from "@/lib/user-permissions";
import { localizedPath } from "@/lib/i18n";

const blankTopic: TopicEditorDraft = {
  title: "",
  slug: "",
  description: "",
  coverPath: "",
  visibility: "public",
  status: "active",
  sortOrder: 0,
  roleCodes: [],
};

export default function TopicsPage() {
  const { locale, phrase, t } = useLanguage();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [topics, setTopics] = useState<ArticleTopic[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<TopicEditorDraft>(blankTopic);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [newSelectedArticles, setNewSelectedArticles] = useState<Article[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const coverPreview = useFilePreview(coverFile);
  const selected = topics.find((topic) => topic.id === selectedId) ?? null;
  const canManage = isSiteManager(user);
  const filteredTopics = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return topics;
    return topics.filter((topic) => `${topic.title} ${topic.description} ${topic.slug}`.toLocaleLowerCase().includes(keyword));
  }, [query, topics]);

  useEffect(() => {
    let active = true;
    async function load() {
      const token = readAccessToken();
      try {
        if (!token) {
          const result = await listTopics(null, { page: 1, pageSize: 50 });
          if (active) setTopics(result.items);
          return;
        }
        const currentUser = await getMe(token);
        if (!active) return;
        setUser(currentUser);
        if (isSiteManager(currentUser)) {
          const [topicResult, articleResult, roleResult] = await Promise.all([
            listAdminTopics(token),
            loadAllPublishedArticles(token),
            listRoles(),
          ]);
          if (!active) return;
          setTopics(topicResult.items);
          setArticles(articleResult);
          setRoles(roleResult);
        } else {
          const result = await listTopics(token, { page: 1, pageSize: 50 });
          if (active) setTopics(result.items);
        }
      } catch (loadError) {
        if (token && isAuthExpiredError(loadError)) {
          clearAuthTokens();
          if (active) setUser(null);
          try {
            const result = await listTopics(null, { page: 1, pageSize: 50 });
            if (active) setTopics(result.items);
          } catch (publicError) {
            if (active) setError(publicError instanceof Error ? publicError.message : phrase("专题加载失败。", "Could not load topics."));
          }
          return;
        }
        if (active) setError(loadError instanceof Error ? loadError.message : phrase("专题加载失败。", "Could not load topics."));
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [phrase]);

  function openCreate() {
    setSelectedId(null);
    setDraft(blankTopic);
    setCoverFile(null);
    setNewSelectedArticles([]);
    setEditorOpen(true);
  }

  function openEdit(topic: ArticleTopic) {
    setSelectedId(topic.id);
    setDraft({
      title: topic.title,
      slug: topic.slug,
      description: topic.description,
      coverPath: topic.coverPath ?? "",
      visibility: topic.visibility,
      status: topic.status,
      sortOrder: topic.sortOrder,
      roleCodes: topic.roleCodes,
    });
    setCoverFile(null);
    setNewSelectedArticles([]);
    setEditorOpen(true);
  }

  function closeEditor() {
    if (isSaving) return;
    setEditorOpen(false);
    setSelectedId(null);
    setCoverFile(null);
    setNewSelectedArticles([]);
  }

  function replaceTopic(next: ArticleTopic) {
    setTopics((current) => current.map((topic) => topic.id === next.id ? next : topic));
  }

  async function saveTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = readAccessToken();
    if (!token || !canManage || !draft.title.trim()) return;
    setIsSaving(true);
    try {
      const input = {
        ...draft,
        title: draft.title.trim(),
        slug: draft.slug.trim(),
        description: draft.description.trim(),
        coverPath: coverFile ? selected?.coverPath ?? "" : draft.coverPath.trim(),
      };
      let saved = selected
        ? await updateTopic(token, selected.id, input)
        : await createTopic(token, {
          ...input,
          articleIds: newSelectedArticles.map((article) => article.id),
        });
      if (coverFile) saved = await uploadTopicCover(token, saved.id, coverFile);
      setTopics((current) => selected
        ? current.map((topic) => topic.id === saved.id ? saved : topic)
        : [saved, ...current]);
      setEditorOpen(false);
      setSelectedId(null);
      setCoverFile(null);
      setNewSelectedArticles([]);
      setNotice(selected ? phrase("专题设置已保存。", "Topic settings saved.") : phrase("专题已创建。", "Topic created."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : selected ? phrase("专题保存失败。", "Could not save the topic.") : phrase("专题创建失败。", "Could not create the topic."));
    } finally {
      setIsSaving(false);
    }
  }

  async function removeSelectedTopic() {
    const token = readAccessToken();
    if (!token || !selected || !window.confirm(phrase(`删除专题“${selected.title}”吗？文章本身不会删除。`, `Delete topic “${selected.title}”? Its articles will not be deleted.`))) return;
    setIsSaving(true);
    try {
      await deleteTopic(token, selected.id);
      setTopics((current) => current.filter((topic) => topic.id !== selected.id));
      setEditorOpen(false);
      setSelectedId(null);
      setCoverFile(null);
      setNotice(phrase("专题已删除，文章内容未受影响。", "Topic deleted. Its articles were not changed."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("专题删除失败。", "Could not delete the topic."));
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleArticle(articleId: number, included: boolean) {
    if (!selected) {
      setNewSelectedArticles((current) => included
        ? current.filter((article) => article.id !== articleId)
        : [...current, ...articles.filter((article) => article.id === articleId)]);
      return;
    }
    const token = readAccessToken();
    if (!token) return;
    try {
      const updated = included
        ? await removeTopicArticle(token, selected.id, articleId)
        : await addTopicArticle(token, selected.id, articleId);
      replaceTopic(updated);
      setNotice(included ? phrase("文章已移出专题。", "Article removed from topic.") : phrase("文章已加入专题。", "Article added to topic."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("专题文章更新失败。", "Could not update topic articles."));
    }
  }

  async function reorderArticles(ids: number[]) {
    if (!selected) {
      setNewSelectedArticles((current) => {
        const articleById = new Map(current.map((article) => [article.id, article]));
        return ids.flatMap((id) => articleById.get(id) ?? []);
      });
      return;
    }
    const token = readAccessToken();
    if (!token) return;
    const previous = selected;
    const articleById = new Map(previous.articles.map((article) => [article.id, article]));
    replaceTopic({ ...previous, articles: ids.flatMap((id) => articleById.get(id) ?? []), articleCount: ids.length });
    try {
      replaceTopic(await reorderTopicArticles(token, previous.id, ids));
    } catch (actionError) {
      replaceTopic(previous);
      setError(actionError instanceof Error ? actionError.message : phrase("专题排序失败。", "Could not reorder topic articles."));
    }
  }

  async function toggleSubscription(topic: ArticleTopic) {
    const token = readAccessToken();
    if (!token || topic.status !== "active") return;
    setActingId(topic.id);
    try {
      const result = topic.subscribed ? await unsubscribeTopic(token, topic.id) : await subscribeTopic(token, topic.id);
      setTopics((current) => current.map((item) => item.id === topic.id ? { ...item, subscribed: result.subscribed, subscriberCount: result.subscriberCount } : item));
      setNotice(result.subscribed ? phrase("已订阅专题。", "Topic subscribed.") : phrase("已取消专题订阅。", "Topic unsubscribed."));
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("专题订阅操作失败。", "Could not update the topic subscription."));
    } finally {
      setActingId(null);
    }
  }

  return (
    <section className="page-shell topics-page">
      <ArticleCenterNav active="topics" isLoggedIn={Boolean(user)} user={user} />
      <div className="topics-toolbar">
        <span>{phrase(`${filteredTopics.length} 个${canManage ? "" : "可见"}专题`, `${filteredTopics.length} ${canManage ? "" : "visible "}topics`)}</span>
        <div>
          <label className="topics-search"><Search aria-hidden="true" size={15} /><input aria-label={phrase("搜索专题", "Search topics")} onChange={(event) => setQuery(event.target.value)} placeholder={phrase("搜索专题", "Search topics")} value={query} /></label>
          {canManage ? <button className="topic-create-action" onClick={openCreate} type="button"><Plus aria-hidden="true" size={16} />{phrase("创建专题", "Create topic")}</button> : null}
        </div>
      </div>
      {isLoading ? <div className="article-empty-state">{phrase("正在读取专题。", "Loading topics.")}</div> : filteredTopics.length ? (
        <div className="topic-list">
          {filteredTopics.map((topic) => {
            const cardContent = <>
                <span className="topic-card-cover">
                  {topic.coverPath ? <Image alt="" height={258} src={resolveApiUrl(topic.coverPath)} unoptimized width={344} /> : <strong>{topic.title.slice(0, 2)}</strong>}
                  <small>{phrase(`${topic.articleCount} 篇`, `${topic.articleCount} articles`)}</small>
                  {topic.status === "disabled" ? <em>{phrase("已停用", "Disabled")}</em> : null}
                </span>
                <span className="topic-card-body"><strong>{topic.title}</strong><small>{topic.description || phrase("暂时没有专题说明。", "No topic description yet.")}</small><em>{topic.articles.slice(0, 2).map((article) => article.title).join(" · ") || phrase("等待内容加入", "Waiting for articles")}</em></span>
              </>;
            return <article className={`topic-card${topic.status === "disabled" ? " disabled" : ""}`} key={topic.id}>
              {topic.status === "active" ? <Link aria-label={phrase(`查看专题 ${topic.title}`, `View topic ${topic.title}`)} className="topic-card-link" href={localizedPath(`/topics/${topic.slug}`, locale)}>{cardContent}</Link> : <div aria-disabled="true" className="topic-card-link" title={phrase("专题已停用，请使用编辑按钮管理", "This topic is disabled. Use edit to manage it.")}>{cardContent}</div>}
              <footer>
                <span>{phrase(`${topic.subscriberCount} 人订阅`, `${topic.subscriberCount} subscribers`)}</span>
                <span className="topic-card-actions">
                  {canManage ? <button aria-label={phrase(`编辑 ${topic.title}`, `Edit ${topic.title}`)} onClick={() => openEdit(topic)} title={phrase("编辑专题", "Edit topic")} type="button"><Pencil aria-hidden="true" size={15} /></button> : null}
                  {user && topic.status === "active" ? <button aria-label={topic.subscribed ? `${t("common.unsubscribe")} ${topic.title}` : `${t("common.subscribe")} ${topic.title}`} className={topic.subscribed ? "active" : undefined} disabled={actingId === topic.id} onClick={() => void toggleSubscription(topic)} title={topic.subscribed ? t("common.unsubscribe") : t("common.subscribe")} type="button"><Rss aria-hidden="true" size={15} /></button> : null}
                </span>
              </footer>
            </article>;
          })}
        </div>
      ) : <div className="article-empty-state">{phrase("没有找到匹配的专题。", "No matching topics.")}</div>}
      {editorOpen && canManage ? <TopicEditorDialog articles={articles} coverFile={coverFile} coverPreview={coverPreview} draft={draft} isEdit={Boolean(selected)} isSaving={isSaving} onChange={setDraft} onClose={closeEditor} onCoverFileChange={(file) => { if (file && file.size > 10 * 1024 * 1024) { setError(phrase("专题封面不能超过 10 MB。", "Topic cover must be at most 10 MB.")); return; } setCoverFile(file); if (file) setDraft((current) => ({ ...current, coverPath: "" })); }} onDelete={selected ? () => void removeSelectedTopic() : undefined} onReorderArticles={reorderArticles} onSubmit={saveTopic} onToggleArticle={toggleArticle} roles={roles} selectedArticles={selected?.articles ?? newSelectedArticles} /> : null}
      <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
    </section>
  );
}

function useFilePreview(file: File | null): string {
  const preview = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  return preview;
}

async function loadAllPublishedArticles(token: string): Promise<Article[]> {
  const first = await listAdminArticles(token, { page: 1, pageSize: 50, status: "published", sort: "latest" });
  if (first.totalPages <= 1) return first.items;
  const rest = await Promise.all(Array.from({ length: first.totalPages - 1 }, (_, index) => listAdminArticles(token, { page: index + 2, pageSize: 50, status: "published", sort: "latest" })));
  return [first, ...rest].flatMap((page) => page.items);
}
