"use client";

import { Archive, BellRing, Check, ChevronDown, Eye, LoaderCircle, Pencil, Plus, Save, Search, Send, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { listRoles } from "@/lib/admin-api";
import {
  AnnouncementAudience,
  AnnouncementDetail,
  AnnouncementInput,
  AnnouncementPage,
  AnnouncementStatus,
  archiveAnnouncement,
  createAnnouncement,
  deleteAnnouncement,
  getAdminAnnouncement,
  listAdminAnnouncements,
  publishAnnouncement,
  updateAnnouncement,
} from "@/lib/announcements-api";
import { AuthRole, AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { growthLevelLabel } from "@/lib/system-labels";
import { isSiteManager } from "@/lib/user-permissions";

type StatusFilter = "all" | AnnouncementStatus;
type EditorState = { id: number | null; status: AnnouncementStatus; input: AnnouncementInput };

const statusLabels: Record<AnnouncementStatus, string> = {
  draft: "草稿",
  scheduled: "待发布",
  published: "已发布",
  expired: "已下线",
  archived: "已归档",
};

const emptyInput: AnnouncementInput = {
  title: "",
  summary: "",
  content: "",
  audience: "public",
  publishMode: "immediate",
  isPinned: false,
  pinOrder: 0,
  pushEnabled: true,
  scheduledAt: null,
  expiresAt: null,
  roleCodes: [],
};

export default function AnnouncementAdminPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [token, setToken] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [data, setData] = useState<AnnouncementPage | null>(null);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (accessToken: string, currentPage: number, currentSearch: string, currentStatus: StatusFilter) => {
    setIsLoading(true);
    try {
      setData(await listAdminAnnouncements(accessToken, { page: currentPage, pageSize: 12, search: currentSearch, ...(currentStatus !== "all" ? { status: currentStatus } : {}) }));
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace(localizedPath("/", locale));
        return;
      }
      setError(loadError instanceof Error ? loadError.message : phrase("公告列表读取失败。", "Could not load announcements."));
    } finally {
      setIsLoading(false);
    }
  }, [locale, phrase, router]);

  useEffect(() => {
    const accessToken = readAccessToken();
    if (!accessToken) {
      router.replace(`${localizedPath("/login", locale)}?from=${encodeURIComponent(localizedPath("/admin/announcements", locale))}`);
      return;
    }
    Promise.all([getMe(accessToken), listRoles()])
      .then(([currentUser, nextRoles]) => {
        if (!isSiteManager(currentUser)) {
          router.replace(localizedPath("/", locale));
          return;
        }
        setToken(accessToken);
        setUser(currentUser);
        setRoles(nextRoles);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }
        setError(loadError instanceof Error ? loadError.message : phrase("公告管理初始化失败。", "Could not initialize announcement management."));
      });
  }, [locale, phrase, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setSearch(searchDraft.trim()); }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    if (!token) return;
    const timer = window.setTimeout(() => void load(token, page, search, status), 0);
    return () => window.clearTimeout(timer);
  }, [load, page, search, status, token]);

  async function edit(id: number) {
    if (!token) return;
    setBusyId(id);
    try {
      const item = await getAdminAnnouncement(token, id);
      setEditor({ id, status: item.status, input: toInput(item) });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : phrase("公告详情读取失败。", "Could not load announcement details."));
    } finally {
      setBusyId(0);
    }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !editor) return;
    setIsSaving(true);
    try {
      const input = normalizeInput(editor.input);
      const saved = editor.id ? await updateAnnouncement(token, editor.id, input) : await createAnnouncement(token, input);
      setEditor({ id: saved.id, status: saved.status, input: toInput(saved) });
      await load(token, page, search, status);
      setNotice(editor.status === "scheduled" ? phrase("定时公告已保存为草稿，请重新发布。", "Scheduled announcement saved as a draft. Publish it again when ready.") : phrase("公告草稿已保存。", "Announcement draft saved."));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : phrase("公告保存失败。", "Could not save announcement."));
    } finally {
      setIsSaving(false);
    }
  }

  async function publishFromEditor() {
    if (!token || !editor || isSaving) return;
    setIsSaving(true);
    try {
      const input = normalizeInput(editor.input);
      const saved = editor.id ? await updateAnnouncement(token, editor.id, input) : await createAnnouncement(token, input);
      const published = await publishAnnouncement(token, saved.id);
      setEditor(null);
      await load(token, page, search, status);
      setNotice(published.status === "scheduled" ? phrase("公告已安排定时发布。", "Announcement scheduled.") : phrase("公告已发布。", "Announcement published."));
    } catch (publishError) {
      setError(publishError instanceof Error ? publishError.message : phrase("公告发布失败。", "Could not publish announcement."));
    } finally {
      setIsSaving(false);
    }
  }

  async function run(id: number, action: () => Promise<unknown>, success: string) {
    if (!token) return;
    setBusyId(id);
    try {
      await action();
      await load(token, page, search, status);
      setNotice(success);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : phrase("公告操作失败。", "Announcement action failed."));
    } finally {
      setBusyId(0);
    }
  }

  const filterOptions = useMemo(() => ["all", ...Object.keys(statusLabels)] as StatusFilter[], []);
  return <section className="page-shell announcement-admin-page">
    <div className="announcement-admin-toolbar">
      <nav aria-label={phrase("公告状态", "Announcement status")}>{filterOptions.map((value) => <button className={status === value ? "active" : undefined} key={value} onClick={() => { setPage(1); setStatus(value); }} type="button">{value === "all" ? phrase("全部", "All") : statusLabel(value, phrase)}</button>)}</nav>
      <label><Search aria-hidden="true" size={15} /><input aria-label={phrase("搜索公告", "Search announcements")} onChange={(event) => setSearchDraft(event.target.value)} placeholder={phrase("搜索标题或内容", "Search title or content")} value={searchDraft} />{searchDraft ? <button aria-label={phrase("清空搜索", "Clear search")} onClick={() => setSearchDraft("")} type="button"><X aria-hidden="true" size={13} /></button> : null}</label>
      <button className="announcement-create" onClick={() => setEditor({ id: null, status: "draft", input: { ...emptyInput } })} type="button"><Plus aria-hidden="true" size={14} />{phrase("新建公告", "New announcement")}</button>
    </div>
    {isLoading ? <div className="article-empty-state"><LoaderCircle aria-hidden="true" className="spin" size={22} />{phrase("正在读取公告。", "Loading announcements.")}</div> : <div className="announcement-admin-list">{data?.items.map((item) => {
      const canEdit = item.status !== "published";
      const canDelete = user?.isSuperAdmin || item.status === "draft";
      const publishBlocked = !isPublishable(item);
      return <article key={item.id}>
        <span className={`announcement-status ${item.status}`}>{statusLabel(item.status, phrase)}</span>
        <div><header><strong>{item.title}</strong>{item.isPinned ? <b>{phrase(`置顶 ${item.pinOrder}`, `Pinned ${item.pinOrder}`)}</b> : null}</header><p>{item.summary || item.title}</p><small>{audienceLabel(item.audience, phrase)}{item.roleCodes.length ? ` · ${item.roleCodes.join(", ")}` : ""} · {publishModeLabel(item.publishMode, phrase)} · {publishTimeLabel(item, locale, phrase)} · {expiryTimeLabel(item.expiresAt, locale, phrase)}</small></div>
        <span className="announcement-admin-stats"><span><Eye aria-hidden="true" size={13} />{item.viewCount}</span><span><Check aria-hidden="true" size={13} />{item.confirmedCount}/{item.recipientCount}</span></span>
        <footer>
          {canEdit ? <button aria-label={phrase("编辑公告", "Edit announcement")} disabled={busyId === item.id} onClick={() => void edit(item.id)} title={phrase("编辑", "Edit")} type="button"><Pencil aria-hidden="true" size={15} /></button> : null}
          {item.status !== "published" && item.status !== "scheduled" ? <button aria-label={phrase("发布公告", "Publish announcement")} disabled={busyId === item.id || publishBlocked} onClick={() => void run(item.id, () => publishAnnouncement(token, item.id), item.publishMode === "scheduled" ? phrase("公告已安排定时发布。", "Announcement scheduled.") : phrase("公告已发布。", "Announcement published."))} title={publishBlocked ? publishBlockReason(item, phrase) : phrase("发布", "Publish")} type="button"><Send aria-hidden="true" size={15} /></button> : null}
          {item.status === "published" ? <button aria-label={phrase("归档公告", "Archive announcement")} disabled={busyId === item.id} onClick={() => void run(item.id, () => archiveAnnouncement(token, item.id), phrase("公告已归档。", "Announcement archived."))} title={phrase("归档", "Archive")} type="button"><Archive aria-hidden="true" size={15} /></button> : null}
          {canDelete ? <button aria-label={phrase("删除公告", "Delete announcement")} className="danger" disabled={busyId === item.id} onClick={() => void run(item.id, () => deleteAnnouncement(token, item.id), phrase("公告已删除。", "Announcement deleted."))} title={phrase("删除", "Delete")} type="button"><Trash2 aria-hidden="true" size={15} /></button> : null}
        </footer>
      </article>;
    })}</div>}
    {!isLoading && data && !data.items.length ? <div className="article-empty-state">{phrase("当前没有匹配的公告。", "No matching announcements.")}</div> : null}
    {data && data.totalPages > 1 ? <nav className="admin-pagination" aria-label={phrase("公告管理分页", "Announcement management pagination")}><span>{phrase(`第 ${data.page} / ${data.totalPages} 页`, `Page ${data.page} of ${data.totalPages}`)}</span><div><button disabled={data.page <= 1} onClick={() => setPage((current) => current - 1)} type="button">{phrase("上一页", "Previous")}</button><button disabled={data.page >= data.totalPages} onClick={() => setPage((current) => current + 1)} type="button">{phrase("下一页", "Next")}</button></div></nav> : null}
    {editor ? <AnnouncementEditor editor={editor} roles={roles} isSaving={isSaving} setEditor={setEditor} onPublish={publishFromEditor} onSubmit={saveDraft} /> : null}
    <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function AnnouncementSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: ReadonlyArray<{ label: string; value: string }>; value: string }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, []);

  return <div className="announcement-editor-select" ref={rootRef}>
    <button aria-expanded={isOpen} aria-haspopup="listbox" aria-label={label} className="announcement-editor-select-trigger" onClick={() => setIsOpen((current) => !current)} type="button"><span>{selected.label}</span><ChevronDown aria-hidden="true" size={15} /></button>
    {isOpen ? <div aria-label={label} className="announcement-editor-select-menu" role="listbox">{options.map((option) => <button aria-selected={option.value === value} key={option.value} onClick={() => { onChange(option.value); setIsOpen(false); }} role="option" type="button">{option.label}</button>)}</div> : null}
  </div>;
}

function AnnouncementEditor({ editor, roles, isSaving, setEditor, onPublish, onSubmit }: { editor: EditorState; roles: AuthRole[]; isSaving: boolean; setEditor: (value: EditorState | null) => void; onPublish: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const { locale, phrase } = useLanguage();
  const input = editor.input;
  const setInput = (next: Partial<AnnouncementInput>) => setEditor({ ...editor, input: { ...input, ...next } });
  const publishBlocked = !isPublishable(input);
  return <div className="announcement-editor-backdrop" role="presentation"><form aria-modal="true" className="announcement-editor" onSubmit={onSubmit} role="dialog">
    <header><span><BellRing aria-hidden="true" size={18} /><strong>{editor.id ? phrase("编辑公告", "Edit announcement") : phrase("新建公告", "New announcement")}</strong></span><button aria-label={phrase("关闭公告编辑", "Close announcement editor")} disabled={isSaving} onClick={() => setEditor(null)} type="button"><X aria-hidden="true" size={17} /></button></header>
    <div className="announcement-editor-body">
      <label><span>{phrase("标题", "Title")}</span><input maxLength={120} onChange={(event) => setInput({ title: event.target.value })} required value={input.title} /></label>
      <label><span>{phrase("摘要", "Summary")}</span><input maxLength={300} onChange={(event) => setInput({ summary: event.target.value })} value={input.summary} /></label>
      <label className="wide"><span>{phrase("内容", "Content")}</span><textarea maxLength={20000} onChange={(event) => setInput({ content: event.target.value })} required rows={10} value={input.content} /></label>
      <div className="announcement-editor-select-field"><span>{phrase("投放范围", "Audience")}</span><AnnouncementSelect label={phrase("投放范围", "Audience")} onChange={(value) => setInput({ audience: value as AnnouncementAudience })} options={[{ label: phrase("所有访客", "All visitors"), value: "public" }, { label: phrase("登录用户", "Signed-in users"), value: "authenticated" }, { label: phrase("指定角色", "Selected roles"), value: "role_restricted" }]} value={input.audience} /></div>
      <div className="announcement-editor-select-field"><span>{phrase("发布方式", "Publishing")}</span><AnnouncementSelect label={phrase("发布方式", "Publishing")} onChange={(value) => setInput({ publishMode: value as AnnouncementInput["publishMode"] })} options={[{ label: phrase("立即发布", "Publish now"), value: "immediate" }, { label: phrase("定时发布", "Schedule publishing"), value: "scheduled" }]} value={input.publishMode} /></div>
      {input.publishMode === "scheduled" ? <label><span>{phrase("发布时间", "Publish time")}</span><input onChange={(event) => setInput({ scheduledAt: event.target.value || null })} required step={60} type="datetime-local" value={input.scheduledAt ?? ""} /></label> : null}
      <label><span>{phrase("自动下线", "Auto-expire")}</span><input onChange={(event) => setInput({ expiresAt: event.target.value || null })} step={60} type="datetime-local" value={input.expiresAt ?? ""} /></label>
      <label><span>{phrase("置顶顺序", "Pin order")}</span><input disabled={!input.isPinned} min={0} onChange={(event) => setInput({ pinOrder: Number(event.target.value) })} type="number" value={input.pinOrder} /></label>
      <div className="announcement-editor-options"><button aria-pressed={input.isPinned} onClick={() => setInput({ isPinned: !input.isPinned })} type="button"><i>{input.isPinned ? <Check aria-hidden="true" size={11} /> : null}</i>{phrase("置顶公告", "Pin announcement")}</button><button aria-pressed={input.pushEnabled} onClick={() => setInput({ pushEnabled: !input.pushEnabled })} type="button"><i>{input.pushEnabled ? <Check aria-hidden="true" size={11} /> : null}</i>{phrase("浏览器推送", "Browser push")}</button></div>
      {input.audience === "role_restricted" ? <fieldset className="wide"><legend>{phrase("可见角色", "Visible roles")}</legend><div>{roles.map((role) => <button aria-pressed={input.roleCodes.includes(role.code)} key={role.code} onClick={() => setInput({ roleCodes: input.roleCodes.includes(role.code) ? input.roleCodes.filter((code) => code !== role.code) : [...input.roleCodes, role.code] })} type="button"><i>{input.roleCodes.includes(role.code) ? <Check aria-hidden="true" size={11} /> : null}</i>{growthLevelLabel(role.code, locale, role.name)}</button>)}</div></fieldset> : null}
    </div>
    <footer><button aria-label={phrase("保存草稿", "Save draft")} disabled={isSaving} title={isSaving ? phrase("保存中", "Saving") : phrase("保存草稿", "Save draft")} type="submit">{isSaving ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <Save aria-hidden="true" size={16} />}</button><button aria-label={input.publishMode === "scheduled" ? phrase("定时发布", "Schedule publishing") : phrase("发布公告", "Publish announcement")} disabled={isSaving || publishBlocked} onClick={onPublish} title={publishBlocked ? publishBlockReason(input, phrase) : input.publishMode === "scheduled" ? phrase("定时发布", "Schedule publishing") : phrase("发布公告", "Publish announcement")} type="button"><Send aria-hidden="true" size={16} /></button></footer>
  </form></div>;
}

function toInput(item: AnnouncementDetail): AnnouncementInput {
  return { title: item.title, summary: item.summary, content: item.content, audience: item.audience, publishMode: item.publishMode, isPinned: item.isPinned, pinOrder: item.pinOrder, pushEnabled: item.pushEnabled, scheduledAt: toLocalDateTime(item.scheduledAt), expiresAt: toLocalDateTime(item.expiresAt), roleCodes: item.roleCodes };
}

function normalizeInput(input: AnnouncementInput): AnnouncementInput {
  return { ...input, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null, expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null, roleCodes: input.audience === "role_restricted" ? input.roleCodes : [] };
}

function isPublishable(input: Pick<AnnouncementInput, "publishMode" | "scheduledAt" | "expiresAt">): boolean {
  const now = new Date();
  const publishAt = input.publishMode === "scheduled" ? parseTime(input.scheduledAt) : now;
  const expiresAt = parseTime(input.expiresAt);
  return Boolean(publishAt && publishAt > (input.publishMode === "scheduled" ? now : new Date(0)) && (!expiresAt || expiresAt > publishAt));
}

function statusLabel(status: AnnouncementStatus, phrase: (chinese: string, english: string) => string): string {
  return status === "draft" ? phrase("草稿", "Draft") : status === "scheduled" ? phrase("待发布", "Scheduled") : status === "published" ? phrase("已发布", "Published") : status === "expired" ? phrase("已下线", "Expired") : phrase("已归档", "Archived");
}

function audienceLabel(audience: AnnouncementAudience, phrase: (chinese: string, english: string) => string): string {
  return audience === "public" ? phrase("所有访客", "All visitors") : audience === "authenticated" ? phrase("登录用户", "Signed-in users") : phrase("指定角色", "Selected roles");
}

function publishBlockReason(input: Pick<AnnouncementInput, "publishMode" | "scheduledAt" | "expiresAt">, phrase: (chinese: string, english: string) => string): string {
  const scheduledAt = parseTime(input.scheduledAt);
  const expiresAt = parseTime(input.expiresAt);
  if (input.publishMode === "scheduled" && (!scheduledAt || scheduledAt <= new Date())) return phrase("定时发布时间必须晚于当前时间", "Scheduled publish time must be in the future");
  const publishAt = input.publishMode === "scheduled" ? scheduledAt : new Date();
  return expiresAt && publishAt && expiresAt <= publishAt ? phrase("自动下线时间必须晚于发布时间", "Auto-expiry must be after publish time") : phrase("当前公告无法发布", "This announcement cannot be published");
}

function publishModeLabel(mode: AnnouncementInput["publishMode"], phrase: (chinese: string, english: string) => string): string {
  return mode === "scheduled" ? phrase("定时发布", "Scheduled") : phrase("立即发布", "Immediate");
}

function publishTimeLabel(item: Pick<AnnouncementDetail, "status" | "scheduledAt" | "publishedAt">, locale: "zh-CN" | "en-US", phrase: (chinese: string, english: string) => string): string {
  if (item.status === "scheduled") return phrase(`发布时间 ${formatTime(item.scheduledAt, locale, phrase)}`, `Publishes ${formatTime(item.scheduledAt, locale, phrase)}`);
  return phrase(`发布时间 ${formatTime(item.publishedAt, locale, phrase)}`, `Published ${formatTime(item.publishedAt, locale, phrase)}`);
}

function expiryTimeLabel(value: string | null, locale: "zh-CN" | "en-US", phrase: (chinese: string, english: string) => string): string {
  return value ? phrase(`下线时间 ${formatTime(value, locale, phrase)}`, `Expires ${formatTime(value, locale, phrase)}`) : phrase("不自动下线", "No auto-expiry");
}

function parseTime(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toLocalDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatTime(value: string | null, locale: "zh-CN" | "en-US", phrase: (chinese: string, english: string) => string): string {
  if (!value) return phrase("未设置", "Not set");
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
