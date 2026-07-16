import { requestJson } from "./auth-api";

export type CacheKeyType =
  "string" | "list" | "set" | "zset" | "hash" | "stream" | "none";
export type CacheKeyCategory =
  "refresh-session" | "user-sessions" | "login-failure" | "business-cache";

export interface CacheOverview {
  connected: true;
  redisVersion: string;
  uptimeSeconds: number;
  connectedClients: number;
  keyCount: number;
  usedMemoryBytes: number;
  peakMemoryBytes: number;
  maxMemoryBytes: number;
  memoryFragmentationRatio: number;
  totalCommandsProcessed: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  hitRate: number | null;
  expiredKeys: number;
  evictedKeys: number;
}

export interface CacheKeySummary {
  key: string;
  type: CacheKeyType;
  category: CacheKeyCategory;
  ttlSeconds: number;
  memoryBytes: number | null;
  canUpdateTtl: boolean;
}

export interface CacheKeyPage {
  cursor: string;
  nextCursor: string;
  done: boolean;
  keys: CacheKeySummary[];
}

export interface CacheKeyDetail extends CacheKeySummary {
  length: number | null;
  format:
    "text" | "json" | "set" | "hash" | "list" | "zset" | "stream" | "none";
  value: unknown;
  truncated: boolean;
}

export interface CacheDeleteResult {
  deletedKeys: number;
  revokedSessions: number;
  clearedLoginFailures: number;
}

function authorizationHeader(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export async function getCacheOverview(
  accessToken: string,
): Promise<CacheOverview> {
  return requestJson<CacheOverview>("/admin/cache/overview", {
    cache: "no-store",
    headers: authorizationHeader(accessToken),
  });
}

export async function listCacheKeys(
  accessToken: string,
  query: { cursor: string; count: number; search: string; type: string },
): Promise<CacheKeyPage> {
  const searchParams = new URLSearchParams({
    cursor: query.cursor,
    count: String(query.count),
  });
  if (query.search.trim()) {
    searchParams.set("search", query.search.trim());
  }
  if (query.type) {
    searchParams.set("type", query.type);
  }

  return requestJson<CacheKeyPage>(
    `/admin/cache/keys?${searchParams.toString()}`,
    {
      cache: "no-store",
      headers: authorizationHeader(accessToken),
    },
  );
}

export async function inspectCacheKey(
  accessToken: string,
  key: string,
): Promise<CacheKeyDetail> {
  return requestJson<CacheKeyDetail>("/admin/cache/inspect", {
    method: "POST",
    headers: authorizationHeader(accessToken),
    body: JSON.stringify({ key }),
  });
}

export async function deleteCacheKeys(
  accessToken: string,
  keys: string[],
): Promise<CacheDeleteResult> {
  return requestJson<CacheDeleteResult>("/admin/cache/delete", {
    method: "POST",
    headers: authorizationHeader(accessToken),
    body: JSON.stringify({ keys }),
  });
}

export async function updateCacheKeyTtl(
  accessToken: string,
  key: string,
  ttlSeconds: number,
): Promise<CacheKeySummary> {
  return requestJson<CacheKeySummary>("/admin/cache/ttl", {
    method: "PATCH",
    headers: authorizationHeader(accessToken),
    body: JSON.stringify({ key, ttlSeconds }),
  });
}
