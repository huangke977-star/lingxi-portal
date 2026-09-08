import type { Article } from "./article-api";
import type { ArticleCollection, ArticleTopic } from "./discovery-api";
import { resolveApiUrl } from "./auth-api";
import { readAccessToken } from "./auth-storage";

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
  mediaSizeBytes: number;
  mediaUrls: string[];
  data: T;
}

export interface OfflineCacheInfo {
  entries: OfflineEntry[];
  usedBytes: number;
  maxBytes: number;
  quotaBytes: number | null;
}

const CACHE_NAME = "hlovet-offline-content-v1";
const MEDIA_CACHE_NAME = "hlovet-offline-media-v1";
const INDEX_KEY = "/__hlovet_offline_index__";
const MAX_MEDIA_ITEM_BYTES = 4 * 1024 * 1024;
const MAX_MEDIA_PER_ENTRY = 40;

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
    return normalizeEntry(entry);
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
    return Array.isArray(entries) ? entries.filter(isOfflineEntry).map(normalizeEntry) : [];
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
  mediaUrls?: string[];
}): Promise<OfflineEntry<T>> {
  if (!isOfflineCacheSupported()) throw new Error("当前浏览器不支持离线缓存。\nThis browser does not support offline storage.");
  const existingEntries = await listOfflineEntries();
  const media = await cacheMedia(input.mediaUrls ?? []);
  const baseEntry = {
    ...input,
    mediaUrls: media.map((item) => item.url),
    mediaSizeBytes: media.reduce((total, item) => total + item.sizeBytes, 0),
    cachedAt: new Date().toISOString(),
    stale: input.stale ?? false,
  };
  const serialized = JSON.stringify(baseEntry);
  const sizeBytes = new Blob([serialized]).size + baseEntry.mediaSizeBytes;
  if (sizeBytes > OFFLINE_CACHE_MAX_BYTES) {
    throw new Error("这项内容超过离线缓存大小限制。\nThis content exceeds the offline cache size limit.");
  }

  const entry: OfflineEntry<T> = { ...JSON.parse(serialized) as Omit<OfflineEntry<T>, "sizeBytes">, sizeBytes };
  const cache = await caches.open(CACHE_NAME);
  await cache.put(recordKey(entry.kind, entry.id), new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } }));

  const entries = [entry, ...existingEntries.filter((candidate) => candidate.kind !== entry.kind || candidate.id !== entry.id)];
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
  await removeOrphanedMedia(retained);
  notifyCacheChange();
  return entry;
}

export async function removeOfflineEntry(kind: OfflineEntryKind, id: string): Promise<void> {
  if (!isOfflineCacheSupported()) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.delete(recordKey(kind, id));
  const retained = (await listOfflineEntries()).filter((entry) => entry.kind !== kind || entry.id !== id);
  await writeIndex(cache, retained);
  await removeOrphanedMedia(retained);
  notifyCacheChange();
}

export async function clearOfflineCache(): Promise<void> {
  if (!isOfflineCacheSupported()) return;
  await caches.delete(CACHE_NAME);
  await caches.delete(MEDIA_CACHE_NAME);
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
  return { kind: "article" as const, id: article.slug, title: article.title, route: `/articles/${article.slug}`, updatedAt: article.updatedAt, data: article, mediaUrls: getOfflineArticleMediaUrls(article) };
}

export function offlineTopicEntry(topic: ArticleTopic) {
  return { kind: "topic" as const, id: topic.slug, title: topic.title, route: `/topics/${topic.slug}`, updatedAt: topic.updatedAt, data: topic, mediaUrls: getOfflineGroupMediaUrls(topic.coverPath, topic.articles) };
}

export function offlineCollectionEntry(collection: ArticleCollection) {
  return { kind: "collection" as const, id: String(collection.id), title: collection.name, route: `/collections/${collection.id}`, updatedAt: collection.updatedAt, data: collection, mediaUrls: getOfflineGroupMediaUrls(collection.coverPath, collection.articles) };
}

export function getOfflineArticleMediaUrls(article: Article): string[] {
  const sources = [article.coverPath, ...article.images, article.content, ...article.contentSegments.map((segment) => segment.content ?? "")];
  return collectMediaUrls(sources);
}

export async function getOfflineMediaBlob(value: string): Promise<Blob | null> {
  if (!isOfflineCacheSupported()) return null;
  const url = normalizeMediaUrl(value);
  if (!url) return null;
  const cache = await caches.open(MEDIA_CACHE_NAME);
  const response = await cache.match(url);
  return response ? response.blob() : null;
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

function normalizeEntry<T extends OfflineEntryData>(entry: OfflineEntry<T>): OfflineEntry<T> {
  return {
    ...entry,
    mediaUrls: Array.isArray(entry.mediaUrls) ? entry.mediaUrls : [],
    mediaSizeBytes: typeof entry.mediaSizeBytes === "number" ? entry.mediaSizeBytes : 0,
    stale: entry.stale || isStale(entry.cachedAt),
  };
}

function getOfflineGroupMediaUrls(coverPath: string | null, articles: Array<{ coverPath: string | null }>): string[] {
  return collectMediaUrls([coverPath, ...articles.map((article) => article.coverPath)]);
}

function collectMediaUrls(sources: Array<string | null | undefined>): string[] {
  const values = new Set<string>();
  const add = (value: string | undefined) => {
    const url = normalizeMediaUrl(value);
    if (url) values.add(url);
  };
  for (const source of sources) {
    if (!source) continue;
    if (looksLikeMediaUrl(source)) add(source);
    for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) add(match[1]);
    for (const match of source.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) add(match[1]);
    for (const match of source.matchAll(/\[[^\]]*\]\(((?:https?:\/\/[^\s)]+)?\/(?:api\/)?articles\/attachments\/\d+\/(?:download|thumbnail)[^\s)]*)\)/gi)) add(match[1]);
  }
  return Array.from(values).slice(0, MAX_MEDIA_PER_ENTRY);
}

function looksLikeMediaUrl(value: string): boolean {
  const trimmed = value.trim();
  return !/\s/.test(trimmed) && (/^(?:https?:\/\/|data:image\/)/i.test(trimmed) || /^\/(?:api\/)?(?:uploads|media|articles\/attachments)\//i.test(trimmed));
}

function normalizeMediaUrl(value: string | undefined): string | null {
  if (!value || !isOfflineCacheSupported()) return null;
  try {
    const url = new URL(resolveApiUrl(value), window.location.origin);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

async function cacheMedia(values: string[]): Promise<Array<{ url: string; sizeBytes: number }>> {
  const cache = await caches.open(MEDIA_CACHE_NAME);
  const token = readAccessToken();
  const uniqueValues = Array.from(new Set(values)).slice(0, MAX_MEDIA_PER_ENTRY);
  const results = await Promise.all(uniqueValues.map(async (value) => {
    const url = normalizeMediaUrl(value);
    if (!url) return null;
    try {
      const cached = await cache.match(url);
      if (cached) {
        const sizeBytes = (await cached.clone().blob()).size;
        return sizeBytes <= MAX_MEDIA_ITEM_BYTES ? { url, sizeBytes } : null;
      }
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(url, { credentials: "include", headers, cache: "no-store" });
      if (!response.ok) return null;
      const sizeBytes = (await response.clone().blob()).size;
      if (sizeBytes > MAX_MEDIA_ITEM_BYTES) return null;
      await cache.put(url, response.clone());
      return { url, sizeBytes };
    } catch {
      return null;
    }
  }));
  return results.filter((item): item is { url: string; sizeBytes: number } => Boolean(item));
}

async function removeOrphanedMedia(entries: OfflineEntry[]): Promise<void> {
  const referenced = new Set(entries.flatMap((entry) => entry.mediaUrls ?? []));
  const cache = await caches.open(MEDIA_CACHE_NAME);
  const requests = await cache.keys();
  await Promise.all(requests.filter((request) => !referenced.has(request.url)).map((request) => cache.delete(request)));
}

function notifyCacheChange(): void {
  window.dispatchEvent(new Event(OFFLINE_CACHE_CHANGE_EVENT));
}

function isStale(cachedAt: string): boolean {
  const timestamp = Date.parse(cachedAt);
  return !Number.isFinite(timestamp) || Date.now() - timestamp > OFFLINE_CACHE_STALE_AFTER_MS;
}
