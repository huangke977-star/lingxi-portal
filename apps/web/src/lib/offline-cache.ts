import type { Article } from "./article-api";
import type { ArticleCollection, ArticleTopic } from "./discovery-api";

export const OFFLINE_CACHE_CHANGE_EVENT = "hlovet:offline-cache-change";
export const OFFLINE_CACHE_MAX_ENTRIES = 30;
export const OFFLINE_CACHE_MAX_BYTES = 25 * 1024 * 1024;
export const OFFLINE_CACHE_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineEntryKind = "article" | "topic" | "collection";
export type OfflineEntryData = Article | ArticleTopic | ArticleCollection;

export interface OfflineEntry<T extends OfflineEntryData = OfflineEntryData> {
  kind: OfflineEntryKind;
  id: string;
  title: string;
  route: string;
  updatedAt: string;
  cachedAt: string;
  stale: boolean;
  sizeBytes: number;
  data: T;
}

export interface OfflineCacheInfo {
  entries: OfflineEntry[];
  usedBytes: number;
  maxBytes: number;
  quotaBytes: number | null;
}

const CACHE_NAME = "hlovet-offline-content-v1";
const INDEX_KEY = "/__hlovet_offline_index__";

export function isOfflineCacheSupported(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

export async function getOfflineEntry<T extends OfflineEntryData>(kind: OfflineEntryKind, id: string): Promise<OfflineEntry<T> | null> {
  if (!isOfflineCacheSupported()) return null;
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(recordKey(kind, id));
  if (!response) return null;
  try {
    const entry = await response.json() as OfflineEntry<T>;
    return { ...entry, stale: entry.stale || isStale(entry.cachedAt) };
  } catch {
    await cache.delete(recordKey(kind, id));
    return null;
  }
}

export async function listOfflineEntries(): Promise<OfflineEntry[]> {
  if (!isOfflineCacheSupported()) return [];
  const cache = await caches.open(CACHE_NAME);
  const response = await cache.match(INDEX_KEY);
  if (!response) return [];
  try {
    const entries = await response.json() as unknown;
    return Array.isArray(entries) ? entries.filter(isOfflineEntry).map((entry) => ({ ...entry, stale: entry.stale || isStale(entry.cachedAt) })) : [];
  } catch {
    return [];
  }
}

export async function saveOfflineEntry<T extends OfflineEntryData>(input: {
  kind: OfflineEntryKind;
  id: string;
  title: string;
  route: string;
  updatedAt: string;
  data: T;
  stale?: boolean;
}): Promise<OfflineEntry<T>> {
  if (!isOfflineCacheSupported()) throw new Error("当前浏览器不支持离线缓存。\nThis browser does not support offline storage.");
  const serialized = JSON.stringify({ ...input, cachedAt: new Date().toISOString(), stale: input.stale ?? false });
  const sizeBytes = new Blob([serialized]).size;
  if (sizeBytes > OFFLINE_CACHE_MAX_BYTES) {
    throw new Error("这项内容超过离线缓存大小限制。\nThis content exceeds the offline cache size limit.");
  }

  const entry: OfflineEntry<T> = { ...JSON.parse(serialized) as Omit<OfflineEntry<T>, "sizeBytes">, sizeBytes };
  const cache = await caches.open(CACHE_NAME);
  await cache.put(recordKey(entry.kind, entry.id), new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } }));

  const entries = [entry, ...(await listOfflineEntries()).filter((candidate) => candidate.kind !== entry.kind || candidate.id !== entry.id)];
  let total = 0;
  const retained: OfflineEntry[] = [];
  for (const candidate of entries) {
    if (retained.length >= OFFLINE_CACHE_MAX_ENTRIES || total + candidate.sizeBytes > OFFLINE_CACHE_MAX_BYTES) {
      await cache.delete(recordKey(candidate.kind, candidate.id));
      continue;
    }
    retained.push(candidate);
    total += candidate.sizeBytes;
  }
  await writeIndex(cache, retained);
  notifyCacheChange();
  return entry;
}

export async function removeOfflineEntry(kind: OfflineEntryKind, id: string): Promise<void> {
  if (!isOfflineCacheSupported()) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(recordKey(kind, id));
  await writeIndex(cache, (await listOfflineEntries()).filter((entry) => entry.kind !== kind || entry.id !== id));
  notifyCacheChange();
}

export async function clearOfflineCache(): Promise<void> {
  if (!isOfflineCacheSupported()) return;
  await caches.delete(CACHE_NAME);
  notifyCacheChange();
}

export async function markOfflineEntryStale(kind: OfflineEntryKind, id: string, stale: boolean): Promise<void> {
  const entry = await getOfflineEntry(kind, id);
  if (!entry || entry.stale === stale) return;
  const cache = await caches.open(CACHE_NAME);
  const updated = { ...entry, stale };
  await cache.put(recordKey(kind, id), new Response(JSON.stringify(updated), { headers: { "Content-Type": "application/json" } }));
  await writeIndex(cache, (await listOfflineEntries()).map((candidate) => candidate.kind === kind && candidate.id === id ? updated : candidate));
  notifyCacheChange();
}

export async function getOfflineCacheInfo(): Promise<OfflineCacheInfo> {
  const entries = await listOfflineEntries();
  let quotaBytes: number | null = null;
  if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
    quotaBytes = (await navigator.storage.estimate()).quota ?? null;
  }
  return { entries, usedBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0), maxBytes: OFFLINE_CACHE_MAX_BYTES, quotaBytes };
}

export function offlineArticleEntry(article: Article) {
  return { kind: "article" as const, id: article.slug, title: article.title, route: `/articles/${article.slug}`, updatedAt: article.updatedAt, data: article };
}

export function offlineTopicEntry(topic: ArticleTopic) {
  return { kind: "topic" as const, id: topic.slug, title: topic.title, route: `/topics/${topic.slug}`, updatedAt: topic.updatedAt, data: topic };
}

export function offlineCollectionEntry(collection: ArticleCollection) {
  return { kind: "collection" as const, id: String(collection.id), title: collection.name, route: `/collections/${collection.id}`, updatedAt: collection.updatedAt, data: collection };
}

function recordKey(kind: OfflineEntryKind, id: string): string {
  return `/__hlovet_offline__/${kind}/${encodeURIComponent(id)}`;
}

async function writeIndex(cache: Cache, entries: OfflineEntry[]): Promise<void> {
  await cache.put(INDEX_KEY, new Response(JSON.stringify(entries), { headers: { "Content-Type": "application/json" } }));
}

function isOfflineEntry(value: unknown): value is OfflineEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<OfflineEntry>;
  return (entry.kind === "article" || entry.kind === "topic" || entry.kind === "collection")
    && typeof entry.id === "string"
    && typeof entry.title === "string"
    && typeof entry.route === "string"
    && typeof entry.sizeBytes === "number"
    && Boolean(entry.data);
}

function notifyCacheChange(): void {
  window.dispatchEvent(new Event(OFFLINE_CACHE_CHANGE_EVENT));
}

function isStale(cachedAt: string): boolean {
  const timestamp = Date.parse(cachedAt);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > OFFLINE_CACHE_STALE_AFTER_MS;
}
