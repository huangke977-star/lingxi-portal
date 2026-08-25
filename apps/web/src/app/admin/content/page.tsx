/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { FilePlus2, FolderPlus, Pencil, Star, Trash2 } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { listRoles } from "@/lib/admin-api";
import { AuthRole, AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { growthLevelLabel } from "@/lib/system-labels";
import { isSiteManager } from "@/lib/user-permissions";
import {
  createPortalCategory,
  createPortalEntry,
  deletePortalCategory,
  deletePortalEntry,
  listPortalAdminContent,
  PortalCategory,
  PortalCategoryInput,
  PortalCategoryKind,
  PortalEntry,
  PortalEntryInput,
  PortalRecordStatus,
  PortalVisibility,
  portalEntryMarker,
  updatePortalCategory,
  updatePortalEntry,
} from "@/lib/portal-api";

const KIND_LABEL: Record<PortalCategoryKind, string> = {
  navigation: "导航",
  tool: "工具",
  server: "服务器入口",
  custom_page: "自定义页面（预留）",
};

const VISIBILITY_LABEL: Record<PortalVisibility, string> = {
  public: "公开",
  authenticated: "登录可见",
  role_restricted: "指定角色",
};

type InlinePhrase = (chinese: string, english: string) => string;

function categoryKindLabel(kind: PortalCategoryKind, phrase: InlinePhrase) {
  const labels: Record<PortalCategoryKind, [string, string]> = {
    navigation: ["导航", "Navigation"],
    tool: ["工具", "Tool"],
    server: ["服务器入口", "Server access"],
    custom_page: ["自定义页面（预留）", "Custom page (reserved)"],
  };
  const [chinese, english] = labels[kind];
  return phrase(chinese, english);
}

function visibilityLabel(visibility: PortalVisibility, phrase: InlinePhrase) {
  const labels: Record<PortalVisibility, [string, string]> = {
    public: ["公开", "Public"],
    authenticated: ["登录可见", "Signed-in users"],
    role_restricted: ["指定角色", "Selected roles"],
  };
  const [chinese, english] = labels[visibility];
  return phrase(chinese, english);
}

type KindFilter = "all" | PortalCategoryKind;

interface CategoryDialogState {
  id: number | null;
  draft: PortalCategoryInput;
}

interface EntryDialogState {
  id: number | null;
  draft: PortalEntryInput;
}

const emptyCategoryDraft: PortalCategoryInput = {
  kind: "navigation",
  name: "",
  description: "",
  sortOrder: 0,
  status: "active",
};

export default function ContentManagementPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [categories, setCategories] = useState<PortalCategory[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(
    null,
  );
  const [categoryDialog, setCategoryDialog] =
    useState<CategoryDialogState | null>(null);
  const [entryDialog, setEntryDialog] = useState<EntryDialogState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let isMounted = true;
    const token = readAccessToken();
    if (!token) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    const verifiedToken = token;

    async function loadWorkspace() {
      setError("");
      try {
        const me = await getMe(verifiedToken);
        if (!isMounted) return;
        setCurrentUser(me);
        setAccessToken(verifiedToken);
        if (!canAccessContentManagement(me)) return;

        const [content, nextRoles] = await Promise.all([
          listPortalAdminContent(verifiedToken),
          listRoles(),
        ]);
        if (!isMounted) return;
        setCategories(content.categories);
        setRoles(nextRoles);
        setSelectedCategoryId(content.categories[0]?.id ?? null);
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : phrase("无法读取门户内容。", "Could not load portal content."),
          );
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadWorkspace();
    return () => {
      isMounted = false;
    };
  }, [locale, phrase, router]);

  const manageableCategories = useMemo(
    () =>
      categories.filter(
        (category) => category.kind !== "server" || currentUser?.isSuperAdmin,
      ),
    [categories, currentUser],
  );
  const filteredCategories = useMemo(
    () =>
      kindFilter === "all"
        ? manageableCategories
        : manageableCategories.filter(
            (category) => category.kind === kindFilter,
          ),
    [kindFilter, manageableCategories],
  );
  const selectedCategory =
    filteredCategories.find((category) => category.id === selectedCategoryId) ??
    filteredCategories[0] ??
    null;
  const canManageServerEntries = currentUser?.isSuperAdmin ?? false;
  const availableKinds = (
    Object.entries(KIND_LABEL) as Array<[PortalCategoryKind, string]>
  ).filter(([kind]) => kind !== "server" || canManageServerEntries);

  async function refreshContent(token = accessToken) {
    if (!token) return;
    const content = await listPortalAdminContent(token);
    setCategories(content.categories);
    if (
      selectedCategoryId !== null &&
      !content.categories.some((category) => category.id === selectedCategoryId)
    ) {
      setSelectedCategoryId(content.categories[0]?.id ?? null);
    }
  }

  function openCreateCategory() {
    setCategoryDialog({
      id: null,
      draft: {
        ...emptyCategoryDraft,
        kind: kindFilter === "all" ? "navigation" : kindFilter,
      },
    });
  }

  function openEditCategory(category: PortalCategory) {
    setCategoryDialog({
      id: category.id,
      draft: {
        kind: category.kind,
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
        status: category.status,
      },
    });
  }

  function openCreateEntry() {
    const category =
      selectedCategory ?? filteredCategories[0] ?? manageableCategories[0];
    if (!category) {
      setError(phrase("请先创建一个分类。", "Create a category first."));
      return;
    }
    setEntryDialog({
      id: null,
      draft: emptyEntryDraft(category),
    });
  }

  function openEditEntry(entry: PortalEntry) {
    setEntryDialog({
      id: entry.id,
      draft: {
        categoryId: entry.categoryId,
        title: entry.title,
        description: entry.description,
        url: entry.url,
        iconPath: entry.iconPath,
        openInNewTab: entry.openInNewTab,
        visibility: entry.visibility,
        sortOrder: entry.sortOrder,
        status: entry.status,
        isFeatured: entry.isFeatured,
        featuredSortOrder: entry.featuredSortOrder,
        roleCodes: entry.allowedRoles.map((role) => role.code),
      },
    });
  }

  async function handleCategorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !categoryDialog) return;
    if (!categoryDialog.draft.name.trim()) {
      setError(phrase("分类名称不能为空。", "Category name cannot be empty."));
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const saved = categoryDialog.id
        ? await updatePortalCategory(
            accessToken,
            categoryDialog.id,
            categoryDialog.draft,
          )
        : await createPortalCategory(accessToken, categoryDialog.draft);
      await refreshContent(accessToken);
      setSelectedCategoryId(saved.id);
      setCategoryDialog(null);
      setNotice(categoryDialog.id ? phrase("分类已更新。", "Category updated.") : phrase("分类已创建。", "Category created."));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : phrase("分类保存失败。", "Could not save category."),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleEntrySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !entryDialog) return;
    const category = manageableCategories.find(
      (item) => item.id === entryDialog.draft.categoryId,
    );
    if (!category) {
      setError(phrase("请选择有效分类。", "Choose a valid category."));
      return;
    }
    if (!entryDialog.draft.title.trim()) {
      setError(phrase("条目标题不能为空。", "Entry title cannot be empty."));
      return;
    }
    if (
      category.kind !== "server" &&
      entryDialog.draft.visibility === "role_restricted" &&
      entryDialog.draft.roleCodes.length === 0
    ) {
      setError(phrase("指定角色可见时至少选择一个角色。", "Choose at least one role for restricted visibility."));
      return;
    }

    const normalizedDraft: PortalEntryInput = {
      ...entryDialog.draft,
      url: entryDialog.draft.url?.trim() || null,
      iconPath: entryDialog.draft.iconPath?.trim() || null,
      visibility:
        category.kind === "server"
          ? "authenticated"
          : entryDialog.draft.visibility,
      roleCodes: category.kind === "server" ? [] : entryDialog.draft.roleCodes,
    };

    setIsSaving(true);
    setError("");
    try {
      await (entryDialog.id
        ? updatePortalEntry(accessToken, entryDialog.id, normalizedDraft)
        : createPortalEntry(accessToken, normalizedDraft));
      await refreshContent(accessToken);
      setSelectedCategoryId(normalizedDraft.categoryId);
      setEntryDialog(null);
      setNotice(entryDialog.id ? phrase("条目已更新。", "Entry updated.") : phrase("条目已创建。", "Entry created."));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : phrase("条目保存失败。", "Could not save entry."),
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteCategory(category: PortalCategory) {
    if (!accessToken) return;
    if (category.entries.length > 0) {
      setError(phrase("请先删除该分类下的全部条目。", "Delete every entry in this category first."));
      return;
    }
    if (!window.confirm(phrase(`确定删除分类“${category.name}”吗？`, `Delete category “${category.name}”?`))) return;

    setBusyKey(`category-${category.id}`);
    setError("");
    try {
      await deletePortalCategory(accessToken, category.id);
      await refreshContent(accessToken);
      setNotice(phrase("分类已删除。", "Category deleted."));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : phrase("分类删除失败。", "Could not delete category."),
      );
    } finally {
      setBusyKey("");
    }
  }

  async function handleDeleteEntry(entry: PortalEntry) {
    if (!accessToken) return;
    if (!window.confirm(phrase(`确定删除条目“${entry.title}”吗？`, `Delete entry “${entry.title}”?`))) return;

    setBusyKey(`entry-${entry.id}`);
    setError("");
    try {
      await deletePortalEntry(accessToken, entry.id);
      await refreshContent(accessToken);
      setNotice(phrase("条目已删除。", "Entry deleted."));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : phrase("条目删除失败。", "Could not delete entry."),
      );
    } finally {
      setBusyKey("");
    }
  }

  if (isLoading) return <AdminPageLoading className="portal-admin-shell" loadingLabel={phrase("正在读取门户内容", "Loading portal content")} title={phrase("内容管理", "Content management")} />;

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase("无法进入内容管理", "Could not open content management")}</h1>
        <p>{error || phrase("请重新登录后访问。", "Sign in again to continue.")}</p>
        <Link className="text-action primary" href={localizedPath("/login", locale)}>
          {phrase("返回登录", "Back to sign in")}
        </Link>
      </section>
    );
  }

  if (!canAccessContentManagement(currentUser)) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase("无权访问", "Access denied")}</h1>
        <p>{phrase("该页面仅管理员和超级管理员可以访问。", "Only administrators and super administrators can access this page.")}</p>
      </section>
    );
  }

  return (
    <section className="page-shell admin-shell portal-admin-shell">
      <AdminPageHeader title={phrase("内容管理", "Content management")} actions={<><button aria-label={phrase("新建分类", "New category")} className="admin-header-icon-action" onClick={openCreateCategory} title={phrase("新建分类", "New category")} type="button"><FolderPlus aria-hidden="true" size={16} /></button><button aria-label={phrase("新建条目", "New entry")} className="admin-header-icon-action" onClick={openCreateEntry} title={phrase("新建条目", "New entry")} type="button"><FilePlus2 aria-hidden="true" size={16} /></button></>} />
      <div className="portal-admin-toolbar">
        <div aria-label={phrase("内容类型", "Content type")} className="portal-kind-tabs" role="tablist">
          {(["all", ...availableKinds.map(([kind]) => kind)] as KindFilter[]).map(
            (kind) => (
              <button
                aria-selected={kindFilter === kind}
                className={kindFilter === kind ? "active" : undefined}
                key={kind}
                onClick={() => setKindFilter(kind)}
                role="tab"
                type="button"
              >
                {kind === "all" ? phrase("全部", "All") : categoryKindLabel(kind, phrase)}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="portal-admin-layout">
        <aside className="portal-category-admin-panel">
          <div className="portal-admin-panel-heading">
            <div>
              <span className="section-label">{phrase("分类", "CATEGORIES")}</span>
              <h2>{phrase(`${filteredCategories.length} 个分类`, `${filteredCategories.length} categories`)}</h2>
            </div>
          </div>
          <div className="portal-category-admin-list">
            {filteredCategories.map((category) => (
              <div
                className={`portal-category-admin-row${selectedCategory?.id === category.id ? " active" : ""}`}
                key={category.id}
              >
                <button
                  className="portal-category-select"
                  onClick={() => setSelectedCategoryId(category.id)}
                  type="button"
                >
                  <span>{categoryKindLabel(category.kind, phrase)}</span>
                  <strong>{category.name}</strong>
                  <small>
                    {phrase(`${category.entries.length} 项`, `${category.entries.length} entries`)} · {" "}
                    {category.status === "active" ? phrase("启用", "Active") : phrase("停用", "Disabled")}
                  </small>
                </button>
                <div className="portal-row-actions">
                  <button
                    aria-label={phrase(`编辑分类 ${category.name}`, `Edit category ${category.name}`)}
                    onClick={() => openEditCategory(category)}
                    title={phrase("编辑分类", "Edit category")}
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label={phrase(`删除分类 ${category.name}`, `Delete category ${category.name}`)}
                    disabled={busyKey === `category-${category.id}`}
                    onClick={() => void handleDeleteCategory(category)}
                    title={phrase("删除分类", "Delete category")}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </div>
              </div>
            ))}
            {!filteredCategories.length ? (
              <p className="portal-admin-empty">{phrase("当前类型还没有分类。", "There are no categories of this type.")}</p>
            ) : null}
          </div>
        </aside>

        <section className="portal-entry-admin-panel">
          <div className="portal-admin-panel-heading">
            <div>
              <span className="section-label">{phrase("条目", "ENTRIES")}</span>
              <h2>{selectedCategory?.name ?? phrase("请选择分类", "Choose a category")}</h2>
            </div>
            {selectedCategory?.kind === "server" ? (
              <span className="portal-server-rule">{phrase("仅超级管理员可见", "Super administrators only")}</span>
            ) : null}
          </div>

          {selectedCategory?.entries.length ? (
            <div className="portal-entry-admin-list">
              {selectedCategory.entries.map((entry) => (
                <article className="portal-entry-admin-row" key={entry.id}>
                  <AdminEntryIcon entry={entry} />
                  <div className="portal-entry-admin-copy">
                    <strong>{entry.title}</strong>
                    <p>{entry.description || phrase("暂无说明", "No description")}</p>
                    <div>
                      <span>{visibilityLabel(entry.visibility, phrase)}</span>
                      <span>{entry.status === "active" ? phrase("启用", "Active") : phrase("停用", "Disabled")}</span>
                      <span>{phrase(`排序 ${entry.sortOrder}`, `Order ${entry.sortOrder}`)}</span>
                      {entry.isFeatured ? <span>{phrase(`首页推荐 ${entry.featuredSortOrder}`, `Homepage feature ${entry.featuredSortOrder}`)}</span> : null}
                    </div>
                  </div>
                  <div className="portal-row-actions">
                    <button
                      aria-label={phrase(`编辑条目 ${entry.title}`, `Edit entry ${entry.title}`)}
                      onClick={() => openEditEntry(entry)}
                      title={phrase("编辑条目", "Edit entry")}
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={16} />
                    </button>
                    <button
                      aria-label={phrase(`删除条目 ${entry.title}`, `Delete entry ${entry.title}`)}
                      disabled={busyKey === `entry-${entry.id}`}
                      onClick={() => void handleDeleteEntry(entry)}
                      title={phrase("删除条目", "Delete entry")}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="portal-admin-empty large">
              <strong>{phrase("当前分类还没有条目", "This category has no entries")}</strong>
              <p>{phrase("使用右上角的新建条目添加内容。", "Use New entry in the top right to add content.")}</p>
            </div>
          )}
        </section>
      </div>

      <AppToast
        duration={error ? 4200 : 2600}
        message={error || notice}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        tone={error ? "error" : "success"}
      />

      {categoryDialog ? (
        <CategoryDialog
          dialog={categoryDialog}
          isSaving={isSaving}
          kinds={availableKinds}
          onChange={(draft) => setCategoryDialog({ ...categoryDialog, draft })}
          onClose={() => setCategoryDialog(null)}
          onSubmit={handleCategorySubmit}
        />
      ) : null}

      {entryDialog ? (
        <EntryDialog
          categories={manageableCategories}
          dialog={entryDialog}
          isSaving={isSaving}
          onChange={(draft) => setEntryDialog({ ...entryDialog, draft })}
          onClose={() => setEntryDialog(null)}
          onSubmit={handleEntrySubmit}
          roles={roles}
        />
      ) : null}
    </section>
  );
}

function AdminEntryIcon({ entry }: { entry: PortalEntry }) {
  const iconPath = entry.iconPath?.trim() || null;
  const [failedIconPath, setFailedIconPath] = useState<string | null>(null);
  const showConfiguredIcon = Boolean(
    iconPath && failedIconPath !== iconPath,
  );

  return (
    <span
      aria-hidden="true"
      className={`portal-entry-admin-icon${showConfiguredIcon ? " has-image" : " is-fallback"}`}
    >
      {showConfiguredIcon ? (
        <img
          alt=""
          onError={() => setFailedIconPath(iconPath)}
          src={iconPath ?? ""}
        />
      ) : (
        portalEntryMarker(entry.title)
      )}
    </span>
  );
}

function CategoryDialog({
  dialog,
  isSaving,
  kinds,
  onChange,
  onClose,
  onSubmit,
}: {
  dialog: CategoryDialogState;
  isSaving: boolean;
  kinds: Array<[PortalCategoryKind, string]>;
  onChange: (draft: PortalCategoryInput) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { phrase } = useLanguage();
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        aria-modal="true"
        className="modal-panel portal-content-modal"
        role="dialog"
      >
        <div className="modal-heading">
          <span className="eyebrow">Category</span>
          <h2>{dialog.id ? phrase("编辑分类", "Edit category") : phrase("新建分类", "New category")}</h2>
        </div>
        <form className="form-stack modal-form" onSubmit={onSubmit}>
          <label>
            {phrase("类型", "Type")}
            <GlassSelect
              ariaLabel={phrase("类型", "Type")}
              disabled={isSaving}
              onChange={(value) =>
                onChange({
                  ...dialog.draft,
                  kind: value as PortalCategoryKind,
                })
              }
              options={kinds.map(([kind]) => ({ value: kind, label: categoryKindLabel(kind, phrase) }))}
              value={dialog.draft.kind}
            />
          </label>
          <label>
            {phrase("分类名称", "Category name")}
            <input
              disabled={isSaving}
              maxLength={80}
              onChange={(event) =>
                onChange({ ...dialog.draft, name: event.target.value })
              }
              required
              value={dialog.draft.name}
            />
          </label>
          <label>
            {phrase("分类说明", "Category description")}
            <textarea
              disabled={isSaving}
              maxLength={255}
              onChange={(event) =>
                onChange({ ...dialog.draft, description: event.target.value })
              }
              rows={3}
              value={dialog.draft.description}
            />
          </label>
          <div className="portal-form-columns">
            <label>
              {phrase("排序", "Order")}
              <input
                disabled={isSaving}
                onChange={(event) =>
                  onChange({
                    ...dialog.draft,
                    sortOrder: Number(event.target.value),
                  })
                }
                type="number"
                value={dialog.draft.sortOrder}
              />
            </label>
            <label>
              {phrase("状态", "Status")}
              <GlassSelect
                ariaLabel={phrase("状态", "Status")}
                disabled={isSaving}
                onChange={(value) =>
                  onChange({
                    ...dialog.draft,
                    status: value as PortalRecordStatus,
                  })
                }
                options={[{ value: "active", label: phrase("启用", "Active") }, { value: "disabled", label: phrase("停用", "Disabled") }]}
                value={dialog.draft.status}
              />
            </label>
          </div>
          <div className="actions">
            <button className="button" disabled={isSaving} type="submit">
              {isSaving ? phrase("保存中", "Saving") : phrase("保存", "Save")}
            </button>
            <button
              className="button secondary"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              {phrase("取消", "Cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EntryDialog({
  categories,
  dialog,
  isSaving,
  onChange,
  onClose,
  onSubmit,
  roles,
}: {
  categories: PortalCategory[];
  dialog: EntryDialogState;
  isSaving: boolean;
  onChange: (draft: PortalEntryInput) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  roles: AuthRole[];
}) {
  const { locale, phrase } = useLanguage();
  const category = categories.find(
    (item) => item.id === dialog.draft.categoryId,
  );
  const isServer = category?.kind === "server";

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        aria-modal="true"
        className="modal-panel portal-content-modal wide"
        role="dialog"
      >
        <div className="modal-heading">
          <span className="eyebrow">Entry</span>
          <h2>{dialog.id ? phrase("编辑条目", "Edit entry") : phrase("新建条目", "New entry")}</h2>
        </div>
        <form className="form-stack modal-form" onSubmit={onSubmit}>
          <label>
            {phrase("所属分类", "Category")}
            <GlassSelect
              ariaLabel={phrase("所属分类", "Category")}
              disabled={isSaving}
              onChange={(value) => {
                const categoryId = Number(value);
                const nextCategory = categories.find(
                  (item) => item.id === categoryId,
                );
                onChange({
                  ...dialog.draft,
                  categoryId,
                  visibility:
                    nextCategory?.kind === "server"
                      ? "authenticated"
                      : dialog.draft.visibility,
                  roleCodes:
                    nextCategory?.kind === "server"
                      ? []
                      : dialog.draft.roleCodes,
                });
              }}
              options={categories.map((item) => ({ value: String(item.id), label: `${categoryKindLabel(item.kind, phrase)} · ${item.name}` }))}
              value={String(dialog.draft.categoryId)}
            />
          </label>
          <div className="portal-form-columns">
            <label>
              {phrase("标题", "Title")}
              <input
                disabled={isSaving}
                maxLength={100}
                onChange={(event) =>
                  onChange({ ...dialog.draft, title: event.target.value })
                }
                required
                value={dialog.draft.title}
              />
            </label>
            <label>
              {phrase("排序", "Order")}
              <input
                disabled={isSaving}
                onChange={(event) =>
                  onChange({
                    ...dialog.draft,
                    sortOrder: Number(event.target.value),
                  })
                }
                type="number"
                value={dialog.draft.sortOrder}
              />
            </label>
          </div>
          <label>
            {phrase("说明", "Description")}
            <textarea
              disabled={isSaving}
              maxLength={300}
              onChange={(event) =>
                onChange({ ...dialog.draft, description: event.target.value })
              }
              rows={3}
              value={dialog.draft.description}
            />
          </label>
          <label>
            {phrase("链接地址", "Link")}
            <input
              disabled={isSaving}
              onChange={(event) =>
                onChange({ ...dialog.draft, url: event.target.value })
              }
              placeholder={phrase("https://example.com 或 /站内路径", "https://example.com or an internal path")}
              value={dialog.draft.url ?? ""}
            />
          </label>
          <label>
            {phrase("图标地址", "Icon URL")}
            <input
              disabled={isSaving}
              onChange={(event) =>
                onChange({ ...dialog.draft, iconPath: event.target.value })
              }
              placeholder={phrase("/logo.png 或 https://example.com/icon.png", "/logo.png or https://example.com/icon.png")}
              value={dialog.draft.iconPath ?? ""}
            />
          </label>
          <div className="portal-form-columns">
            <label>
              {phrase("可见范围", "Visibility")}
              {isServer ? (
                <input disabled value={phrase("仅超级管理员可见", "Super administrators only")} />
              ) : (
                <GlassSelect
                  ariaLabel={phrase("可见范围", "Visibility")}
                  disabled={isSaving}
                  onChange={(value) =>
                    onChange({
                      ...dialog.draft,
                      visibility: value as PortalVisibility,
                    })
                  }
                  options={Object.keys(VISIBILITY_LABEL).map((value) => ({ value, label: visibilityLabel(value as PortalVisibility, phrase) }))}
                  value={dialog.draft.visibility}
                />
              )}
            </label>
            <label>
              {phrase("状态", "Status")}
              <GlassSelect
                ariaLabel={phrase("状态", "Status")}
                disabled={isSaving}
                onChange={(value) =>
                  onChange({
                    ...dialog.draft,
                    status: value as PortalRecordStatus,
                  })
                }
                options={[{ value: "active", label: phrase("启用", "Active") }, { value: "disabled", label: phrase("停用", "Disabled") }]}
                value={dialog.draft.status}
              />
            </label>
          </div>

          {!isServer && dialog.draft.visibility === "role_restricted" ? (
            <fieldset className="portal-role-fieldset">
              <legend>{phrase("允许查看的角色", "Roles allowed to view")}</legend>
              <div className="portal-role-grid">
                {roles.map((role) => (
                  <label key={role.code}>
                    <input
                      checked={dialog.draft.roleCodes.includes(role.code)}
                      disabled={isSaving}
                      onChange={(event) =>
                        onChange({
                          ...dialog.draft,
                          roleCodes: event.target.checked
                            ? [...dialog.draft.roleCodes, role.code]
                            : dialog.draft.roleCodes.filter(
                                (code) => code !== role.code,
                              ),
                        })
                      }
                      type="checkbox"
                    />
                    <span>{growthLevelLabel(role.code, locale, role.name)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          <div className={`portal-entry-options${isServer ? " server-only" : ""}`}>
            <label className="portal-checkbox-row">
              <input
                checked={dialog.draft.openInNewTab}
                disabled={isSaving || !dialog.draft.url}
                onChange={(event) =>
                  onChange({
                    ...dialog.draft,
                    openInNewTab: event.target.checked,
                  })
                }
                type="checkbox"
              />
              <span>{phrase("在新标签页打开", "Open in new tab")}</span>
            </label>
            {!isServer ? (
              <>
                <label className="portal-checkbox-row">
                  <input
                    checked={dialog.draft.isFeatured}
                    disabled={isSaving}
                    onChange={(event) =>
                      onChange({ ...dialog.draft, isFeatured: event.target.checked })
                    }
                    type="checkbox"
                  />
                  <span><Star aria-hidden="true" size={14} />{phrase("首页推荐", "Feature on homepage")}</span>
                </label>
                <label className="portal-featured-sort">
                  {phrase("推荐排序", "Feature order")}
                  <input
                    disabled={isSaving || !dialog.draft.isFeatured}
                    onChange={(event) =>
                      onChange({
                        ...dialog.draft,
                        featuredSortOrder: Number(event.target.value),
                      })
                    }
                    type="number"
                    value={dialog.draft.featuredSortOrder}
                  />
                </label>
              </>
            ) : null}
          </div>
          <div className="actions">
            <button className="button" disabled={isSaving} type="submit">
              {isSaving ? phrase("保存中", "Saving") : phrase("保存", "Save")}
            </button>
            <button
              className="button secondary"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              {phrase("取消", "Cancel")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function emptyEntryDraft(category: PortalCategory): PortalEntryInput {
  return {
    categoryId: category.id,
    title: "",
    description: "",
    url: null,
    iconPath: null,
    openInNewTab: true,
    visibility: category.kind === "server" ? "authenticated" : "public",
    sortOrder: 0,
    status: "active",
    isFeatured: false,
    featuredSortOrder: 0,
    roleCodes: [],
  };
}

function canAccessContentManagement(user: AuthUser): boolean {
  return isSiteManager(user);
}
