/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { listRoles } from "@/lib/admin-api";
import { AuthRole, AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
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
      router.replace("/login");
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
          router.replace("/");
          return;
        }
        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "无法读取门户内容。",
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
  }, [router]);

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
      setError("请先创建一个分类。");
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
        roleCodes: entry.allowedRoles.map((role) => role.code),
      },
    });
  }

  async function handleCategorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !categoryDialog) return;
    if (!categoryDialog.draft.name.trim()) {
      setError("分类名称不能为空。");
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
      setNotice(categoryDialog.id ? "分类已更新。" : "分类已创建。");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "分类保存失败。",
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
      setError("请选择有效分类。");
      return;
    }
    if (!entryDialog.draft.title.trim()) {
      setError("条目标题不能为空。");
      return;
    }
    if (
      category.kind !== "server" &&
      entryDialog.draft.visibility === "role_restricted" &&
      entryDialog.draft.roleCodes.length === 0
    ) {
      setError("指定角色可见时至少选择一个角色。");
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
      setNotice(entryDialog.id ? "条目已更新。" : "条目已创建。");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "条目保存失败。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteCategory(category: PortalCategory) {
    if (!accessToken) return;
    if (category.entries.length > 0) {
      setError("请先删除该分类下的全部条目。");
      return;
    }
    if (!window.confirm(`确定删除分类“${category.name}”吗？`)) return;

    setBusyKey(`category-${category.id}`);
    setError("");
    try {
      await deletePortalCategory(accessToken, category.id);
      await refreshContent(accessToken);
      setNotice("分类已删除。");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "分类删除失败。",
      );
    } finally {
      setBusyKey("");
    }
  }

  async function handleDeleteEntry(entry: PortalEntry) {
    if (!accessToken) return;
    if (!window.confirm(`确定删除条目“${entry.title}”吗？`)) return;

    setBusyKey(`entry-${entry.id}`);
    setError("");
    try {
      await deletePortalEntry(accessToken, entry.id);
      await refreshContent(accessToken);
      setNotice("条目已删除。");
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "条目删除失败。",
      );
    } finally {
      setBusyKey("");
    }
  }

  if (isLoading) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>内容管理</h1>
        <div className="status-row compact-status-row">
          <span className="status">正在读取门户内容</span>
        </div>
      </section>
    );
  }

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>无法进入内容管理</h1>
        <p>{error || "请重新登录后访问。"}</p>
        <Link className="text-action primary" href="/login">
          返回登录
        </Link>
      </section>
    );
  }

  if (!canAccessContentManagement(currentUser)) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>无权访问</h1>
        <p>该页面仅管理员和超级管理员可以访问。</p>
      </section>
    );
  }

  return (
    <section className="page-shell admin-shell portal-admin-shell">
      <div className="portal-admin-toolbar">
        <div aria-label="内容类型" className="portal-kind-tabs" role="tablist">
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
                {kind === "all" ? "全部" : KIND_LABEL[kind]}
              </button>
            ),
          )}
        </div>
        <div className="portal-admin-header-actions">
          <button className="text-action primary" onClick={openCreateCategory} type="button">
            <Plus aria-hidden="true" size={17} />新建分类
          </button>
          <button className="text-action primary" onClick={openCreateEntry} type="button">
            <Plus aria-hidden="true" size={17} />新建条目
          </button>
        </div>
      </div>

      <div className="portal-admin-layout">
        <aside className="portal-category-admin-panel">
          <div className="portal-admin-panel-heading">
            <div>
              <span className="section-label">分类</span>
              <h2>{filteredCategories.length} 个分类</h2>
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
                  <span>{KIND_LABEL[category.kind]}</span>
                  <strong>{category.name}</strong>
                  <small>
                    {category.entries.length} 项 ·{" "}
                    {category.status === "active" ? "启用" : "停用"}
                  </small>
                </button>
                <div className="portal-row-actions">
                  <button
                    aria-label={`编辑分类 ${category.name}`}
                    onClick={() => openEditCategory(category)}
                    title="编辑分类"
                    type="button"
                  >
                    <Pencil aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label={`删除分类 ${category.name}`}
                    disabled={busyKey === `category-${category.id}`}
                    onClick={() => void handleDeleteCategory(category)}
                    title="删除分类"
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </button>
                </div>
              </div>
            ))}
            {!filteredCategories.length ? (
              <p className="portal-admin-empty">当前类型还没有分类。</p>
            ) : null}
          </div>
        </aside>

        <section className="portal-entry-admin-panel">
          <div className="portal-admin-panel-heading">
            <div>
              <span className="section-label">条目</span>
              <h2>{selectedCategory?.name ?? "请选择分类"}</h2>
            </div>
            {selectedCategory?.kind === "server" ? (
              <span className="portal-server-rule">仅超级管理员可见</span>
            ) : null}
          </div>

          {selectedCategory?.entries.length ? (
            <div className="portal-entry-admin-list">
              {selectedCategory.entries.map((entry) => (
                <article className="portal-entry-admin-row" key={entry.id}>
                  <AdminEntryIcon entry={entry} />
                  <div className="portal-entry-admin-copy">
                    <strong>{entry.title}</strong>
                    <p>{entry.description || "暂无说明"}</p>
                    <div>
                      <span>{VISIBILITY_LABEL[entry.visibility]}</span>
                      <span>{entry.status === "active" ? "启用" : "停用"}</span>
                      <span>排序 {entry.sortOrder}</span>
                    </div>
                  </div>
                  <div className="portal-row-actions">
                    <button
                      aria-label={`编辑条目 ${entry.title}`}
                      onClick={() => openEditEntry(entry)}
                      title="编辑条目"
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={16} />
                    </button>
                    <button
                      aria-label={`删除条目 ${entry.title}`}
                      disabled={busyKey === `entry-${entry.id}`}
                      onClick={() => void handleDeleteEntry(entry)}
                      title="删除条目"
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
              <strong>当前分类还没有条目</strong>
              <p>使用右上角的新建条目添加内容。</p>
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
          <h2>{dialog.id ? "编辑分类" : "新建分类"}</h2>
        </div>
        <form className="form-stack modal-form" onSubmit={onSubmit}>
          <label>
            类型
            <select
              disabled={isSaving}
              onChange={(event) =>
                onChange({
                  ...dialog.draft,
                  kind: event.target.value as PortalCategoryKind,
                })
              }
              value={dialog.draft.kind}
            >
              {kinds.map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            分类名称
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
            分类说明
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
              排序
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
              状态
              <select
                disabled={isSaving}
                onChange={(event) =>
                  onChange({
                    ...dialog.draft,
                    status: event.target.value as PortalRecordStatus,
                  })
                }
                value={dialog.draft.status}
              >
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
          </div>
          <div className="actions">
            <button className="button" disabled={isSaving} type="submit">
              {isSaving ? "保存中" : "保存"}
            </button>
            <button
              className="button secondary"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              取消
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
          <h2>{dialog.id ? "编辑条目" : "新建条目"}</h2>
        </div>
        <form className="form-stack modal-form" onSubmit={onSubmit}>
          <label>
            所属分类
            <select
              disabled={isSaving}
              onChange={(event) => {
                const categoryId = Number(event.target.value);
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
              value={dialog.draft.categoryId}
            >
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {KIND_LABEL[item.kind]} · {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className="portal-form-columns">
            <label>
              标题
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
              排序
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
            说明
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
            链接地址
            <input
              disabled={isSaving}
              onChange={(event) =>
                onChange({ ...dialog.draft, url: event.target.value })
              }
              placeholder="https://example.com 或 /站内路径"
              value={dialog.draft.url ?? ""}
            />
          </label>
          <label>
            图标地址
            <input
              disabled={isSaving}
              onChange={(event) =>
                onChange({ ...dialog.draft, iconPath: event.target.value })
              }
              placeholder="/logo.png 或 https://example.com/icon.png"
              value={dialog.draft.iconPath ?? ""}
            />
          </label>
          <div className="portal-form-columns">
            <label>
              可见范围
              {isServer ? (
                <input disabled value="仅超级管理员可见" />
              ) : (
                <select
                  disabled={isSaving}
                  onChange={(event) =>
                    onChange({
                      ...dialog.draft,
                      visibility: event.target.value as PortalVisibility,
                    })
                  }
                  value={dialog.draft.visibility}
                >
                  {Object.entries(VISIBILITY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              状态
              <select
                disabled={isSaving}
                onChange={(event) =>
                  onChange({
                    ...dialog.draft,
                    status: event.target.value as PortalRecordStatus,
                  })
                }
                value={dialog.draft.status}
              >
                <option value="active">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
          </div>

          {!isServer && dialog.draft.visibility === "role_restricted" ? (
            <fieldset className="portal-role-fieldset">
              <legend>允许查看的角色</legend>
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
                    <span>{role.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

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
            <span>在新标签页打开</span>
          </label>
          <div className="actions">
            <button className="button" disabled={isSaving} type="submit">
              {isSaving ? "保存中" : "保存"}
            </button>
            <button
              className="button secondary"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              取消
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
    roleCodes: [],
  };
}

function canAccessContentManagement(user: AuthUser): boolean {
  return user.isSuperAdmin || user.role.level >= 90;
}
