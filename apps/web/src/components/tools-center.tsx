"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { House, Search, Star, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { PortalEntryVisual } from "@/components/portal-entry-visual";
import { isAuthExpiredError } from "@/lib/auth-api";
import { AUTH_STATE_CHANGE_EVENT, clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getPortalPreferences, listPortalContent, updatePortalPreferences, type PortalCategory, type PortalEntry, type PortalPreferences } from "@/lib/portal-api";

interface ToolRecord {
  category: PortalCategory;
  entry: PortalEntry;
}

export function ToolsCenter() {
  const [categories, setCategories] = useState<PortalCategory[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [preferences, setPreferences] = useState<PortalPreferences>({ homeEntryIds: [], toolEntryIds: [] });
  const [query, setQuery] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useEffect(() => {
    let active = true;
    async function load() {
      setIsLoading(true);
      const nextToken = readAccessToken();
      try {
        const [content, savedPreferences] = await Promise.all([
          listPortalContent(["navigation", "tool", "server"], nextToken),
          nextToken ? getPortalPreferences(nextToken) : Promise.resolve({ homeEntryIds: [], toolEntryIds: [] }),
        ]);
        if (!active) return;
        setToken(nextToken);
        setCategories(content.categories);
        setPreferences(savedPreferences);
        setError("");
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) { clearAuthTokens(); setToken(null); }
        if (active) setError(loadError instanceof Error ? loadError.message : "无法读取工具中心。");
      } finally { if (active) setIsLoading(false); }
    }
    void load();
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, load);
    return () => { active = false; window.removeEventListener(AUTH_STATE_CHANGE_EVENT, load); };
  }, []);

  const records = useMemo<ToolRecord[]>(() => categories.flatMap((category) => category.entries.map((entry) => ({ category, entry }))), [categories]);
  const savedRecords = useMemo(() => orderRecords(records, preferences.toolEntryIds), [records, preferences.toolEntryIds]);
  const filteredRecords = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return records;
    return records.filter(({ category, entry }) => `${entry.title} ${kindLabel(category.kind)} ${category.name} ${entry.description ?? ""} ${entry.url ?? ""}`.toLocaleLowerCase().includes(normalized));
  }, [query, records]);

  async function save(next: PortalPreferences) {
    if (!token) { setError("登录后可以保存常用工具和排序。"); return; }
    const previous = preferences;
    setPreferences(next);
    setIsSaving(true);
    try { setPreferences(await updatePortalPreferences(token, next)); }
    catch (saveError) { setPreferences(previous); setError(saveError instanceof Error ? saveError.message : "常用工具保存失败。"); }
    finally { setIsSaving(false); }
  }

  function toggleSaved(entryId: number) {
    const saved = preferences.toolEntryIds;
    const nextIds = saved.includes(entryId) ? saved.filter((id) => id !== entryId) : [...saved, entryId];
    if (nextIds.length > 30) { setError("最多保存 30 个常用工具。"); return; }
    void save({ ...preferences, toolEntryIds: nextIds });
  }

  function toggleHomeShortcut(entryId: number) {
    const shortcuts = preferences.homeEntryIds;
    const nextIds = shortcuts.includes(entryId) ? shortcuts.filter((id) => id !== entryId) : [...shortcuts, entryId];
    if (nextIds.length > 12) { setError("首页快捷入口最多设置 12 个。"); return; }
    void save({ ...preferences, homeEntryIds: nextIds });
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const oldIndex = preferences.toolEntryIds.indexOf(Number(event.active.id));
    const newIndex = preferences.toolEntryIds.indexOf(Number(event.over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    void save({ ...preferences, toolEntryIds: arrayMove(preferences.toolEntryIds, oldIndex, newIndex) });
  }

  return <section className="p8-page p8-tools-page">
    <header className="p8-page-heading"><div><span className="section-label">TOOLS</span><h1>工具中心</h1></div><span className="p8-heading-note">{token ? "收藏并拖动排序，跨设备保持一致" : "登录后可保存常用工具"}</span></header>
    <label className="p8-tool-search"><Search aria-hidden="true" size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="搜索工具、导航、分类或说明" value={query} /><span>{filteredRecords.length}</span></label>
    {isLoading ? <div className="status-row compact-status-row"><span className="status">正在读取工具</span></div> : <div className="p8-tools-layout">
      <section className="p8-surface p8-saved-tools"><div className="p8-section-heading"><div><Star aria-hidden="true" size={17} /><h2>我的常用</h2></div><small>{isSaving ? "保存中" : `${savedRecords.length}/30`}</small></div>
        {savedRecords.length ? <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}><SortableContext items={savedRecords.map(({ entry }) => entry.id)} strategy={verticalListSortingStrategy}><div className="p8-saved-tool-list">{savedRecords.map((record) => <SortableTool key={record.entry.id} onToggle={toggleSaved} record={record} />)}</div></SortableContext></DndContext> : <p className="p8-empty">从右侧工具列表收藏常用入口，可拖动调整顺序。</p>}
      </section>
      <section className="p8-surface p8-all-tools"><div className="p8-section-heading"><div><Wrench aria-hidden="true" size={17} /><h2>全部入口</h2></div><small>按账号权限展示</small></div>
        {filteredRecords.length ? <div className="p8-all-tools-grid">{filteredRecords.map((record) => <ToolCard isHomeShortcut={preferences.homeEntryIds.includes(record.entry.id)} isSaved={preferences.toolEntryIds.includes(record.entry.id)} key={record.entry.id} onToggleHomeShortcut={toggleHomeShortcut} onToggleSaved={toggleSaved} record={record} />)}</div> : <p className="p8-empty">没有匹配的工具或导航。</p>}
      </section>
    </div>}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function SortableTool({ record, onToggle }: { record: ToolRecord; onToggle: (id: number) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: record.entry.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return <div className="p8-saved-tool" ref={setNodeRef} style={style}><button aria-label={`拖动排序 ${record.entry.title}`} className="p8-drag-handle" {...attributes} {...listeners} type="button">::</button><ToolLink record={record} /><button aria-label={`取消收藏 ${record.entry.title}`} className="p8-star-button saved" onClick={() => onToggle(record.entry.id)} title="取消收藏" type="button"><Star aria-hidden="true" size={16} fill="currentColor" /></button></div>;
}

function ToolCard({ record, isHomeShortcut, isSaved, onToggleHomeShortcut, onToggleSaved }: { record: ToolRecord; isHomeShortcut: boolean; isSaved: boolean; onToggleHomeShortcut: (id: number) => void; onToggleSaved: (id: number) => void }) {
  return <article className="p8-tool-card"><ToolLink record={record} showDescription={false} /><div className="p8-tool-actions"><button aria-label={isHomeShortcut ? `移出首页快捷入口 ${record.entry.title}` : `加入首页快捷入口 ${record.entry.title}`} className={`p8-home-shortcut-button${isHomeShortcut ? " selected" : ""}`} onClick={() => onToggleHomeShortcut(record.entry.id)} title={isHomeShortcut ? "移出首页快捷入口" : "加入首页快捷入口"} type="button"><House aria-hidden="true" size={15} fill={isHomeShortcut ? "currentColor" : "none"} /></button><button aria-label={isSaved ? `取消收藏 ${record.entry.title}` : `收藏 ${record.entry.title}`} className={`p8-star-button${isSaved ? " saved" : ""}`} onClick={() => onToggleSaved(record.entry.id)} title={isSaved ? "取消收藏" : "加入常用"} type="button"><Star aria-hidden="true" size={16} fill={isSaved ? "currentColor" : "none"} /></button></div><small>{kindLabel(record.category.kind)} · {record.category.name} · {record.entry.description || portalHost(record.entry.url)}</small></article>;
}

function ToolLink({ record, showDescription = true }: { record: ToolRecord; showDescription?: boolean }) {
  const content = <><PortalEntryVisual entry={record.entry} /><span><strong>{record.entry.title}</strong>{showDescription ? <small>{record.entry.description || portalHost(record.entry.url)}</small> : null}</span></>;
  return record.entry.url ? <a className="p8-tool-link" href={record.entry.url} rel={record.entry.openInNewTab ? "noreferrer" : undefined} target={record.entry.openInNewTab ? "_blank" : undefined}>{content}</a> : <div className="p8-tool-link muted">{content}</div>;
}

function orderRecords(records: ToolRecord[], ids: number[]) {
  const byId = new Map(records.map((record) => [record.entry.id, record]));
  return ids.flatMap((id) => { const record = byId.get(id); return record ? [record] : []; });
}

function portalHost(url: string | null) { if (!url) return "暂未配置链接"; if (url.startsWith("/")) return "站内入口"; try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "链接入口"; } }
function kindLabel(kind: PortalCategory["kind"]) { return ({ navigation: "导航", tool: "工具", server: "服务器" } as Record<string, string>)[kind] ?? "入口"; }
