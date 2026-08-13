"use client";

import { Archive, BellRing, Check, Eye, LoaderCircle, Pencil, Plus, Search, Send, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
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
import { AuthRole, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

type StatusFilter = "all" | AnnouncementStatus;

const statusLabels: Record<AnnouncementStatus, string> = {
  draft: "草稿",
  scheduled: "定时发布",
  published: "已发布",
  expired: "已下线",
  archived: "已归档",
};

const audienceLabels: Record<AnnouncementAudience, string> = {
  public: "所有访客",
  authenticated: "登录用户",
  role_restricted: "指定角色",
};

const emptyInput: AnnouncementInput = {
  title: "",
  summary: "",
  content: "",
  audience: "public",
  status: "draft",
  isPinned: false,
  pinOrder: 0,
  pushEnabled: true,
  scheduledAt: null,
  expiresAt: null,
  roleCodes: [],
};

export default function AnnouncementAdminPage() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [data, setData] = useState<AnnouncementPage | null>(null);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [editor, setEditor] = useState<{ id: number | null; input: AnnouncementInput } | null>(null);
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
        router.replace("/");
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "公告列表读取失败。");
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const accessToken = readAccessToken();
    if (!accessToken) {
      router.replace("/login?from=%2Fadmin%2Fannouncements");
      return;
    }
    Promise.all([getMe(accessToken), listRoles()])
      .then(([user, nextRoles]) => {
        if (!user.isSuperAdmin && user.role.level < 90) {
          router.replace("/");
          return;
        }
        setToken(accessToken);
        setRoles(nextRoles);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "公告管理初始化失败。");
      });
  }, [router]);

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
      setEditor({ id, input: toInput(item) });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "公告详情读取失败。");
    } finally {
      setBusyId(0);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !editor) return;
    setIsSaving(true);
    try {
      const input = normalizeInput(editor.input);
      const saved = editor.id ? await updateAnnouncement(token, editor.id, input) : await createAnnouncement(token, input);
      setEditor(null);
      await load(token, page, search, status);
      setNotice(saved.status === "published" ? "公告已保存并发布。" : saved.status === "scheduled" ? "公告已设置定时发布。" : "公告草稿已保存。");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "公告保存失败。");
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
      setError(actionError instanceof Error ? actionError.message : "公告操作失败。");
    } finally {
      setBusyId(0);
    }
  }

  const filterOptions = useMemo(() => ["all", ...Object.keys(statusLabels)] as StatusFilter[], []);
  return <section className="page-shell announcement-admin-page">
    <div className="announcement-admin-toolbar">
      <nav aria-label="公告状态">{filterOptions.map((value) => <button className={status === value ? "active" : undefined} key={value} onClick={() => { setPage(1); setStatus(value); }} type="button">{value === "all" ? "全部" : statusLabels[value]}</button>)}</nav>
      <label><Search aria-hidden="true" size={15} /><input aria-label="搜索公告" onChange={(event) => setSearchDraft(event.target.value)} placeholder="搜索标题或内容" value={searchDraft} />{searchDraft ? <button aria-label="清空搜索" onClick={() => setSearchDraft("")} type="button"><X aria-hidden="true" size={13} /></button> : null}</label>
      <button className="announcement-create" onClick={() => setEditor({ id: null, input: { ...emptyInput } })} type="button"><Plus aria-hidden="true" size={15} />新建公告</button>
    </div>
    {isLoading ? <div className="article-empty-state"><LoaderCircle aria-hidden="true" className="spin" size={22} />正在读取公告。</div> : <div className="announcement-admin-list">{data?.items.map((item) => <article key={item.id}>
      <span className={`announcement-status ${item.status}`}>{statusLabels[item.status]}</span>
      <div><header><strong>{item.title}</strong>{item.isPinned ? <b>置顶 {item.pinOrder}</b> : null}</header><p>{item.summary || item.title}</p><small>{audienceLabels[item.audience]}{item.roleCodes.length ? ` · ${item.roleCodes.join("、")}` : ""} · 更新于 {formatTime(item.updatedAt)}</small></div>
      <span className="announcement-admin-stats"><span><Eye aria-hidden="true" size={13} />{item.viewCount}</span><span><Check aria-hidden="true" size={13} />{item.confirmedCount}/{item.recipientCount}</span></span>
      <footer>
        <button aria-label="编辑公告" disabled={busyId === item.id || item.status === "expired"} onClick={() => void edit(item.id)} title="编辑" type="button"><Pencil aria-hidden="true" size={15} /></button>
        {item.status === "draft" || item.status === "scheduled" || item.status === "archived" ? <button aria-label="立即发布" disabled={busyId === item.id} onClick={() => void run(item.id, () => publishAnnouncement(token, item.id), "公告已发布。") } title="立即发布" type="button"><Send aria-hidden="true" size={15} /></button> : null}
        {item.status === "published" ? <button aria-label="归档公告" disabled={busyId === item.id} onClick={() => void run(item.id, () => archiveAnnouncement(token, item.id), "公告已归档。") } title="归档" type="button"><Archive aria-hidden="true" size={15} /></button> : null}
        {item.status !== "published" && item.status !== "expired" ? <button aria-label="删除公告" className="danger" disabled={busyId === item.id} onClick={() => void run(item.id, () => deleteAnnouncement(token, item.id), "公告已删除。") } title="删除" type="button"><Trash2 aria-hidden="true" size={15} /></button> : null}
      </footer>
    </article>)}</div>}
    {!isLoading && data && !data.items.length ? <div className="article-empty-state">当前没有匹配的公告。</div> : null}
    {data && data.totalPages > 1 ? <nav className="admin-pagination" aria-label="公告管理分页"><span>第 {data.page} / {data.totalPages} 页</span><div><button disabled={data.page <= 1} onClick={() => setPage((current) => current - 1)} type="button">上一页</button><button disabled={data.page >= data.totalPages} onClick={() => setPage((current) => current + 1)} type="button">下一页</button></div></nav> : null}
    {editor ? <AnnouncementEditor editor={editor} roles={roles} isSaving={isSaving} setEditor={setEditor} onSubmit={save} /> : null}
    <AppToast duration={error ? 4200 : 2600} message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function AnnouncementEditor({ editor, roles, isSaving, setEditor, onSubmit }: { editor: { id: number | null; input: AnnouncementInput }; roles: AuthRole[]; isSaving: boolean; setEditor: (value: { id: number | null; input: AnnouncementInput } | null) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const input = editor.input;
  const setInput = (next: Partial<AnnouncementInput>) => setEditor({ ...editor, input: { ...input, ...next } });
  return <div className="announcement-editor-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSaving) setEditor(null); }} role="presentation"><form aria-modal="true" className="announcement-editor" onSubmit={onSubmit} role="dialog">
    <header><span><BellRing aria-hidden="true" size={18} /><strong>{editor.id ? "编辑公告" : "新建公告"}</strong></span><button aria-label="关闭公告编辑" disabled={isSaving} onClick={() => setEditor(null)} type="button"><X aria-hidden="true" size={17} /></button></header>
    <div className="announcement-editor-body">
      <label><span>标题</span><input maxLength={120} onChange={(event) => setInput({ title: event.target.value })} required value={input.title} /></label>
      <label><span>摘要</span><input maxLength={300} onChange={(event) => setInput({ summary: event.target.value })} value={input.summary} /></label>
      <label className="wide"><span>内容</span><textarea maxLength={20000} onChange={(event) => setInput({ content: event.target.value })} required rows={10} value={input.content} /></label>
      <label><span>投放范围</span><select onChange={(event) => setInput({ audience: event.target.value as AnnouncementAudience })} value={input.audience}><option value="public">所有访客</option><option value="authenticated">登录用户</option><option value="role_restricted">指定角色</option></select></label>
      <label><span>保存方式</span><select onChange={(event) => setInput({ status: event.target.value as AnnouncementInput["status"] })} value={input.status}><option value="draft">保存草稿</option><option value="scheduled">定时发布</option><option value="published">立即发布</option><option value="archived">保存为归档</option></select></label>
      {input.status === "scheduled" ? <label><span>发布时间</span><input onChange={(event) => setInput({ scheduledAt: event.target.value || null })} required type="datetime-local" value={input.scheduledAt ?? ""} /></label> : null}
      <label><span>自动下线</span><input onChange={(event) => setInput({ expiresAt: event.target.value || null })} type="datetime-local" value={input.expiresAt ?? ""} /></label>
      <label><span>置顶顺序</span><input disabled={!input.isPinned} min={0} onChange={(event) => setInput({ pinOrder: Number(event.target.value) })} type="number" value={input.pinOrder} /></label>
      <div className="announcement-editor-options"><button aria-pressed={input.isPinned} onClick={() => setInput({ isPinned: !input.isPinned })} type="button"><i>{input.isPinned ? <Check aria-hidden="true" size={11} /> : null}</i>置顶公告</button><button aria-pressed={input.pushEnabled} onClick={() => setInput({ pushEnabled: !input.pushEnabled })} type="button"><i>{input.pushEnabled ? <Check aria-hidden="true" size={11} /> : null}</i>浏览器推送</button></div>
      {input.audience === "role_restricted" ? <fieldset className="wide"><legend>可见角色</legend><div>{roles.map((role) => <button aria-pressed={input.roleCodes.includes(role.code)} key={role.code} onClick={() => setInput({ roleCodes: input.roleCodes.includes(role.code) ? input.roleCodes.filter((code) => code !== role.code) : [...input.roleCodes, role.code] })} type="button"><i>{input.roleCodes.includes(role.code) ? <Check aria-hidden="true" size={11} /> : null}</i>{role.name}</button>)}</div></fieldset> : null}
    </div>
    <footer><button disabled={isSaving} onClick={() => setEditor(null)} type="button">取消</button><button disabled={isSaving} type="submit">{isSaving ? "保存中" : input.status === "published" ? "保存并发布" : input.status === "scheduled" ? "保存定时发布" : "保存"}</button></footer>
  </form></div>;
}

function toInput(item: AnnouncementDetail): AnnouncementInput {
  return { title: item.title, summary: item.summary, content: item.content, audience: item.audience, status: item.status === "expired" ? "archived" : item.status, isPinned: item.isPinned, pinOrder: item.pinOrder, pushEnabled: item.pushEnabled, scheduledAt: toLocalDateTime(item.scheduledAt), expiresAt: toLocalDateTime(item.expiresAt), roleCodes: item.roleCodes };
}

function normalizeInput(input: AnnouncementInput): AnnouncementInput {
  return { ...input, scheduledAt: input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null, expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null, roleCodes: input.audience === "role_restricted" ? input.roleCodes : [] };
}

function toLocalDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
