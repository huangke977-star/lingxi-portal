"use client";

import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { House, Search, Star, Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { useLanguage } from "@/components/language-provider";
import { PortalEntryVisual } from "@/components/portal-entry-visual";
import { isAuthExpiredError } from "@/lib/auth-api";
import { AUTH_STATE_CHANGE_EVENT, clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { getPortalPreferences, listPortalContent, updatePortalPreferences, type PortalCategory, type PortalEntry, type PortalPreferences } from "@/lib/portal-api";
import type { TranslationKey } from "@/lib/i18n";

interface ToolRecord {
  category: PortalCategory;
  entry: PortalEntry;
}

type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;

export function ToolsCenter() {
  const { locale, t } = useLanguage();
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
        if (active) setError(loadError instanceof Error ? loadError.message : t("tools.reading"));
      } finally { if (active) setIsLoading(false); }
    }
    void load();
    window.addEventListener(AUTH_STATE_CHANGE_EVENT, load);
    return () => { active = false; window.removeEventListener(AUTH_STATE_CHANGE_EVENT, load); };
  }, [t]);

  const records = useMemo<ToolRecord[]>(() => categories.flatMap((category) => category.entries.map((entry) => ({ category, entry }))), [categories]);
  const savedRecords = useMemo(() => orderRecords(records, preferences.toolEntryIds), [records, preferences.toolEntryIds]);
  const filteredRecords = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return records;
    return records.filter(({ category, entry }) => `${entry.title} ${kindLabel(category.kind, t)} ${category.name} ${entry.description ?? ""} ${entry.url ?? ""}`.toLocaleLowerCase().includes(normalized));
  }, [query, records, t]);

  async function save(next: PortalPreferences) {
    if (!token) { setError(t("tools.saveLogin")); return; }
    const previous = preferences;
    setPreferences(next);
    setIsSaving(true);
    try { setPreferences(await updatePortalPreferences(token, next)); }
    catch (saveError) { setPreferences(previous); setError(saveError instanceof Error ? saveError.message : t("tools.saveFailed")); }
    finally { setIsSaving(false); }
  }

  function toggleSaved(entryId: number) {
    const saved = preferences.toolEntryIds;
    const nextIds = saved.includes(entryId) ? saved.filter((id) => id !== entryId) : [...saved, entryId];
    if (nextIds.length > 30) { setError(t("tools.commonLimit")); return; }
    void save({ ...preferences, toolEntryIds: nextIds });
  }

  function toggleHomeShortcut(entryId: number) {
    const shortcuts = preferences.homeEntryIds;
    const nextIds = shortcuts.includes(entryId) ? shortcuts.filter((id) => id !== entryId) : [...shortcuts, entryId];
    if (nextIds.length > 12) { setError(t("tools.homeLimit")); return; }
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
    <header className="p8-page-heading"><div>{locale === "zh-CN" ? <span className="section-label">{t("tools.section")}</span> : null}<h1>{t("tools.title")}</h1></div><span className="p8-heading-note">{token ? t("tools.savedNote") : t("tools.loginNote")}</span></header>
    <label className="p8-tool-search"><Search aria-hidden="true" size={17} /><input aria-label={t("tools.searchPlaceholder")} onChange={(event) => setQuery(event.target.value)} placeholder={t("tools.searchPlaceholder")} value={query} /><span>{filteredRecords.length}</span></label>
    {isLoading ? <div className="status-row compact-status-row"><span className="status">{t("tools.reading")}</span></div> : <div className="p8-tools-layout">
      <section className="p8-surface p8-saved-tools"><div className="p8-section-heading"><div><Star aria-hidden="true" size={17} /><h2>{t("tools.myCommon")}</h2></div><small>{isSaving ? t("tools.saving") : `${savedRecords.length}/30`}</small></div>
        {savedRecords.length ? <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd} sensors={sensors}><SortableContext items={savedRecords.map(({ entry }) => entry.id)} strategy={verticalListSortingStrategy}><div className="p8-saved-tool-list">{savedRecords.map((record) => <SortableTool key={record.entry.id} onToggle={toggleSaved} record={record} t={t} />)}</div></SortableContext></DndContext> : <p className="p8-empty">{t("tools.emptySaved")}</p>}
      </section>
      <section className="p8-surface p8-all-tools"><div className="p8-section-heading"><div><Wrench aria-hidden="true" size={17} /><h2>{t("tools.allEntries")}</h2></div><small>{t("tools.permissionNote")}</small></div>
        {filteredRecords.length ? <div className="p8-all-tools-grid">{filteredRecords.map((record) => <ToolCard isHomeShortcut={preferences.homeEntryIds.includes(record.entry.id)} isSaved={preferences.toolEntryIds.includes(record.entry.id)} key={record.entry.id} onToggleHomeShortcut={toggleHomeShortcut} onToggleSaved={toggleSaved} record={record} t={t} />)}</div> : <p className="p8-empty">{t("tools.emptyResult")}</p>}
      </section>
    </div>}
    <AppToast message={error} onDismiss={() => setError("")} tone="error" />
  </section>;
}

function SortableTool({ record, onToggle, t }: { record: ToolRecord; onToggle: (id: number) => void; t: Translator }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: record.entry.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return <div className="p8-saved-tool" ref={setNodeRef} style={style}><button aria-label={t("tools.drag", { title: record.entry.title })} className="p8-drag-handle" {...attributes} {...listeners} type="button">::</button><ToolLink record={record} t={t} /><button aria-label={`${t("tools.removeCommon")} ${record.entry.title}`} className="p8-star-button saved" onClick={() => onToggle(record.entry.id)} title={t("tools.removeCommon")} type="button"><Star aria-hidden="true" size={16} fill="currentColor" /></button></div>;
}

function ToolCard({ record, isHomeShortcut, isSaved, onToggleHomeShortcut, onToggleSaved, t }: { record: ToolRecord; isHomeShortcut: boolean; isSaved: boolean; onToggleHomeShortcut: (id: number) => void; onToggleSaved: (id: number) => void; t: Translator }) {
  return <article className="p8-tool-card"><ToolLink record={record} showDescription={false} t={t} /><div className="p8-tool-actions"><button aria-label={isHomeShortcut ? `${t("tools.removeHome")} ${record.entry.title}` : `${t("tools.addHome")} ${record.entry.title}`} className={`p8-home-shortcut-button${isHomeShortcut ? " selected" : ""}`} onClick={() => onToggleHomeShortcut(record.entry.id)} title={isHomeShortcut ? t("tools.removeHome") : t("tools.addHome")} type="button"><House aria-hidden="true" size={15} fill={isHomeShortcut ? "currentColor" : "none"} /></button><button aria-label={isSaved ? `${t("tools.removeCommon")} ${record.entry.title}` : `${t("tools.addCommon")} ${record.entry.title}`} className={`p8-star-button${isSaved ? " saved" : ""}`} onClick={() => onToggleSaved(record.entry.id)} title={isSaved ? t("tools.removeCommon") : t("tools.addCommon")} type="button"><Star aria-hidden="true" size={16} fill={isSaved ? "currentColor" : "none"} /></button></div><small>{kindLabel(record.category.kind, t)} · {record.category.name} · {record.entry.description || portalHost(record.entry.url, t)}</small></article>;
}

function ToolLink({ record, showDescription = true, t }: { record: ToolRecord; showDescription?: boolean; t: Translator }) {
  const content = <><PortalEntryVisual entry={record.entry} /><span><strong>{record.entry.title}</strong>{showDescription ? <small>{record.entry.description || portalHost(record.entry.url, t)}</small> : null}</span></>;
  return record.entry.url ? <a className="p8-tool-link" href={record.entry.url} rel={record.entry.openInNewTab ? "noreferrer" : undefined} target={record.entry.openInNewTab ? "_blank" : undefined}>{content}</a> : <div className="p8-tool-link muted">{content}</div>;
}

function orderRecords(records: ToolRecord[], ids: number[]) {
  const byId = new Map(records.map((record) => [record.entry.id, record]));
  return ids.flatMap((id) => { const record = byId.get(id); return record ? [record] : []; });
}

function portalHost(url: string | null, t: Translator) { if (!url) return t("tools.notConfigured"); if (url.startsWith("/")) return t("tools.internalEntry"); try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return t("tools.linkEntry"); } }
function kindLabel(kind: PortalCategory["kind"], t: Translator) { return ({ navigation: t("tools.navigation"), tool: t("tools.tool"), server: t("tools.server") } as Record<string, string>)[kind] ?? t("tools.entry"); }
