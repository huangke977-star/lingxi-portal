import { RedisKeyType } from "../redis/redis.service";

export type CacheKeyCategory =
  "refresh-session" | "user-sessions" | "login-failure" | "business-cache";

export interface CacheOverviewResponse {
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
  type: RedisKeyType;
  category: CacheKeyCategory;
  ttlSeconds: number;
  memoryBytes: number | null;
  canUpdateTtl: boolean;
}

export interface CacheKeyPageResponse {
  cursor: string;
  nextCursor: string;
  done: boolean;
  keys: CacheKeySummary[];
}

export interface CacheKeyDetailResponse extends CacheKeySummary {
  length: number | null;
  format:
    "text" | "json" | "set" | "hash" | "list" | "zset" | "stream" | "none";
  value: unknown;
  truncated: boolean;
}

export interface CacheDeleteResponse {
  deletedKeys: number;
  revokedSessions: number;
  clearedLoginFailures: number;
}
