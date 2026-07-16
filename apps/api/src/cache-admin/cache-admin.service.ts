import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { RedisKeyMetadata, RedisService } from "../redis/redis.service";
import {
  DeleteCacheKeysDto,
  InspectCacheKeyDto,
  ListCacheKeysQueryDto,
  UpdateCacheKeyTtlDto,
  UpdateCacheKeysTtlDto,
} from "./dto/cache-admin.dto";
import {
  CacheDeleteResponse,
  CacheKeyCategory,
  CacheKeyDetailResponse,
  CacheKeyPageResponse,
  CacheKeySummary,
  CacheOverviewResponse,
} from "./cache-admin.types";

const MAX_COLLECTION_ITEMS = 200;
const MAX_STRING_CHARACTERS = 65_536;
const MAX_EMPTY_SCAN_ATTEMPTS = 25;
const SENSITIVE_FIELD_PATTERN =
  /(password|passwd|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|credential)/i;

@Injectable()
export class CacheAdminService {
  constructor(private readonly redis: RedisService) {}

  async getOverview(): Promise<CacheOverviewResponse> {
    try {
      const [ping, info, keyCount] = await Promise.all([
        this.redis.ping(),
        this.redis.info(),
        this.redis.dbsize(),
      ]);
      if (ping !== "PONG") {
        throw new Error("Unexpected Redis ping response.");
      }

      const values = this.parseInfo(info);
      const keyspaceHits = this.numberValue(values, "keyspace_hits");
      const keyspaceMisses = this.numberValue(values, "keyspace_misses");
      const lookupCount = keyspaceHits + keyspaceMisses;

      return {
        connected: true,
        redisVersion: values.get("redis_version") ?? "unknown",
        uptimeSeconds: this.numberValue(values, "uptime_in_seconds"),
        connectedClients: this.numberValue(values, "connected_clients"),
        keyCount,
        usedMemoryBytes: this.numberValue(values, "used_memory"),
        peakMemoryBytes: this.numberValue(values, "used_memory_peak"),
        maxMemoryBytes: this.numberValue(values, "maxmemory"),
        memoryFragmentationRatio: this.numberValue(
          values,
          "mem_fragmentation_ratio",
        ),
        totalCommandsProcessed: this.numberValue(
          values,
          "total_commands_processed",
        ),
        keyspaceHits,
        keyspaceMisses,
        hitRate: lookupCount > 0 ? keyspaceHits / lookupCount : null,
        expiredKeys: this.numberValue(values, "expired_keys"),
        evictedKeys: this.numberValue(values, "evicted_keys"),
      };
    } catch {
      throw new ServiceUnavailableException("Redis cache is unavailable.");
    }
  }

  async listKeys(query: ListCacheKeysQueryDto): Promise<CacheKeyPageResponse> {
    const pattern = this.scanPattern(query);
    let scanCursor = query.cursor;
    let nextCursor = query.cursor;
    let summaries: CacheKeySummary[] = [];

    for (let attempt = 0; attempt < MAX_EMPTY_SCAN_ATTEMPTS; attempt += 1) {
      const [scannedCursor, keys] = await this.redis.scanKeys(
        scanCursor,
        pattern,
        query.count,
        query.type,
      );
      nextCursor = scannedCursor;
      const metadata = await this.redis.getKeyMetadata(keys);
      summaries = metadata
        .filter((item) => item.type !== "none")
        .filter(
          (item) =>
            !query.category ||
            this.categoryForKey(item.key) === query.category,
        )
        .map((item) => this.toSummary(item));

      if (summaries.length > 0 || nextCursor === "0") {
        break;
      }
      scanCursor = nextCursor;
    }

    return {
      cursor: query.cursor,
      nextCursor,
      done: nextCursor === "0",
      keys: summaries,
    };
  }

  async inspectKey(dto: InspectCacheKeyDto): Promise<CacheKeyDetailResponse> {
    const metadata = await this.requireKey(dto.key);
    const summary = this.toSummary(metadata);

    switch (metadata.type) {
      case "string":
        return this.inspectString(summary);
      case "set":
        return this.inspectSet(summary);
      case "hash":
        return this.inspectHash(summary);
      case "list":
        return this.inspectList(summary);
      case "zset":
        return this.inspectSortedSet(summary);
      case "stream":
        return this.inspectStream(summary);
      default:
        throw new NotFoundException("Cache key not found.");
    }
  }

  async deleteKeys(dto: DeleteCacheKeysDto): Promise<CacheDeleteResponse> {
    const processed = new Set<string>();
    const result: CacheDeleteResponse = {
      deletedKeys: 0,
      revokedSessions: 0,
      clearedLoginFailures: 0,
    };

    for (const key of new Set(dto.keys)) {
      if (processed.has(key)) {
        continue;
      }
      processed.add(key);

      const category = this.categoryForKey(key);
      if (category === "refresh-session") {
        const deleted = await this.deleteRefreshSession(key);
        result.deletedKeys += deleted;
        result.revokedSessions += deleted;
        continue;
      }

      if (category === "user-sessions") {
        const tokenIds = await this.redis.smembers(key);
        const refreshKeys = tokenIds.map(
          (tokenId) => `refresh_token:${tokenId}`,
        );
        refreshKeys.forEach((refreshKey) => processed.add(refreshKey));
        const revokedSessions = await this.redis.delMany(refreshKeys);
        const deletedSet = await this.redis.del(key);
        result.revokedSessions += revokedSessions;
        result.deletedKeys += revokedSessions + deletedSet;
        continue;
      }

      const deleted = await this.redis.del(key);
      result.deletedKeys += deleted;
      if (category === "login-failure") {
        result.clearedLoginFailures += deleted;
      }
    }

    return result;
  }

  async updateTtl(dto: UpdateCacheKeyTtlDto): Promise<CacheKeySummary> {
    if (this.categoryForKey(dto.key) !== "business-cache") {
      throw new BadRequestException(
        "Authentication cache TTL cannot be changed manually.",
      );
    }

    await this.requireKey(dto.key);
    const updated = await this.redis.expire(dto.key, dto.ttlSeconds);
    if (updated !== 1) {
      throw new NotFoundException("Cache key not found.");
    }

    return this.toSummary(await this.requireKey(dto.key));
  }

  async updateTtls(
    dto: UpdateCacheKeysTtlDto,
  ): Promise<CacheKeySummary[]> {
    const keys = [...new Set(dto.keys)];
    if (keys.some((key) => this.categoryForKey(key) !== "business-cache")) {
      throw new BadRequestException(
        "Authentication cache TTL cannot be changed manually.",
      );
    }

    await Promise.all(keys.map((key) => this.requireKey(key)));
    const updated = await Promise.all(
      keys.map((key) => this.redis.expire(key, dto.ttlSeconds)),
    );
    if (updated.some((result) => result !== 1)) {
      throw new NotFoundException("One or more cache keys were not found.");
    }

    return (await this.redis.getKeyMetadata(keys)).map((item) =>
      this.toSummary(item),
    );
  }

  private async inspectString(
    summary: CacheKeySummary,
  ): Promise<CacheKeyDetailResponse> {
    const rawValue = (await this.redis.get(summary.key)) ?? "";
    const characters = Array.from(rawValue);
    const truncated = characters.length > MAX_STRING_CHARACTERS;
    const visibleValue = truncated
      ? characters.slice(0, MAX_STRING_CHARACTERS).join("")
      : rawValue;

    try {
      const parsed = JSON.parse(visibleValue) as unknown;
      return {
        ...summary,
        length: characters.length,
        format: "json",
        value: this.redactValueForKey(summary, parsed),
        truncated,
      };
    } catch {
      return {
        ...summary,
        length: characters.length,
        format: "text",
        value: SENSITIVE_FIELD_PATTERN.test(summary.key)
          ? "[sensitive value hidden]"
          : visibleValue,
        truncated,
      };
    }
  }

  private async inspectSet(
    summary: CacheKeySummary,
  ): Promise<CacheKeyDetailResponse> {
    const [members, length] = await Promise.all([
      this.redis.smembers(summary.key),
      this.redis.scard(summary.key),
    ]);
    return {
      ...summary,
      length,
      format: "set",
      value: members
        .slice(0, MAX_COLLECTION_ITEMS)
        .map((member) => this.redactCollectionValue(member, summary)),
      truncated: length > MAX_COLLECTION_ITEMS,
    };
  }

  private async inspectHash(
    summary: CacheKeySummary,
  ): Promise<CacheKeyDetailResponse> {
    const [value, length] = await Promise.all([
      this.redis.hgetall(summary.key),
      this.redis.hlen(summary.key),
    ]);
    const visibleEntries = Object.entries(value).slice(0, MAX_COLLECTION_ITEMS);
    return {
      ...summary,
      length,
      format: "hash",
      value: this.redactValueForKey(
        summary,
        Object.fromEntries(visibleEntries),
      ),
      truncated: length > MAX_COLLECTION_ITEMS,
    };
  }

  private async inspectList(
    summary: CacheKeySummary,
  ): Promise<CacheKeyDetailResponse> {
    const [items, length] = await Promise.all([
      this.redis.lrange(summary.key, 0, MAX_COLLECTION_ITEMS - 1),
      this.redis.llen(summary.key),
    ]);
    return {
      ...summary,
      length,
      format: "list",
      value: items.map((item) => this.redactCollectionValue(item, summary)),
      truncated: length > MAX_COLLECTION_ITEMS,
    };
  }

  private async inspectSortedSet(
    summary: CacheKeySummary,
  ): Promise<CacheKeyDetailResponse> {
    const [entries, length] = await Promise.all([
      this.redis.zrangeWithScores(summary.key, 0, MAX_COLLECTION_ITEMS - 1),
      this.redis.zcard(summary.key),
    ]);
    const value: Array<{ member: unknown; score: number }> = [];
    for (let index = 0; index < entries.length; index += 2) {
      value.push({
        member: this.redactCollectionValue(entries[index] ?? "", summary),
        score: Number(entries[index + 1] ?? 0),
      });
    }
    return {
      ...summary,
      length,
      format: "zset",
      value,
      truncated: length > MAX_COLLECTION_ITEMS,
    };
  }

  private async inspectStream(
    summary: CacheKeySummary,
  ): Promise<CacheKeyDetailResponse> {
    const [entries, length] = await Promise.all([
      this.redis.streamRange(summary.key, MAX_COLLECTION_ITEMS),
      this.redis.xlen(summary.key),
    ]);
    return {
      ...summary,
      length,
      format: "stream",
      value: this.redactStreamEntries(entries, summary),
      truncated: length > MAX_COLLECTION_ITEMS,
    };
  }

  private async deleteRefreshSession(key: string): Promise<number> {
    const rawValue = await this.redis.get(key);
    const tokenId = key.slice("refresh_token:".length);
    const userId = this.readRefreshTokenUserId(rawValue);
    const deleted = await this.redis.del(key);
    if (deleted && userId !== null) {
      await this.redis.srem(`user_sessions:${userId}`, tokenId);
    }
    return deleted;
  }

  private readRefreshTokenUserId(value: string | null): number | null {
    if (!value) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as { userId?: unknown };
      return typeof parsed.userId === "number" &&
        Number.isInteger(parsed.userId)
        ? parsed.userId
        : null;
    } catch {
      return null;
    }
  }

  private async requireKey(key: string): Promise<RedisKeyMetadata> {
    const [metadata] = await this.redis.getKeyMetadata([key]);
    if (!metadata || metadata.type === "none") {
      throw new NotFoundException("Cache key not found.");
    }
    return metadata;
  }

  private toSummary(metadata: RedisKeyMetadata): CacheKeySummary {
    const category = this.categoryForKey(metadata.key);
    return {
      ...metadata,
      category,
      canUpdateTtl: category === "business-cache",
    };
  }

  private categoryForKey(key: string): CacheKeyCategory {
    if (key.startsWith("refresh_token:")) {
      return "refresh-session";
    }
    if (key.startsWith("user_sessions:")) {
      return "user-sessions";
    }
    if (key.startsWith("login_fail:")) {
      return "login-failure";
    }
    return "business-cache";
  }

  private redactCollectionValue(
    value: string,
    summary: CacheKeySummary,
    fieldName = "",
  ): unknown {
    if (this.shouldHideEntireValue(summary)) {
      return "[sensitive value hidden]";
    }
    try {
      return this.redactStructuredValue(
        JSON.parse(value) as unknown,
        fieldName,
      );
    } catch {
      if (SENSITIVE_FIELD_PATTERN.test(fieldName)) {
        return this.maskSensitiveValue(value, fieldName);
      }
      return value.length > MAX_STRING_CHARACTERS
        ? `${Array.from(value).slice(0, MAX_STRING_CHARACTERS).join("")}...`
        : value;
    }
  }

  private redactValueForKey(
    summary: CacheKeySummary,
    value: unknown,
  ): unknown {
    return this.shouldHideEntireValue(summary)
      ? "[sensitive value hidden]"
      : this.redactStructuredValue(value);
  }

  private redactStreamEntries(
    entries: unknown[],
    summary: CacheKeySummary,
  ): unknown[] | string {
    if (this.shouldHideEntireValue(summary)) {
      return "[sensitive value hidden]";
    }

    return entries.map((entry) => {
      if (!Array.isArray(entry) || !Array.isArray(entry[1])) {
        return this.redactStructuredValue(entry);
      }

      const fields = entry[1] as unknown[];
      const redactedFields = fields.map((value, index) => {
        if (index % 2 === 0) {
          return value;
        }
        const fieldName = String(fields[index - 1] ?? "");
        return typeof value === "string"
          ? this.redactCollectionValue(value, summary, fieldName)
          : this.redactStructuredValue(value, fieldName);
      });
      return [entry[0], redactedFields];
    });
  }

  private shouldHideEntireValue(summary: CacheKeySummary): boolean {
    return (
      summary.category === "business-cache" &&
      SENSITIVE_FIELD_PATTERN.test(summary.key)
    );
  }

  private redactStructuredValue(
    value: unknown,
    fieldName = "",
    depth = 0,
  ): unknown {
    if (depth > 12) {
      return "[maximum depth reached]";
    }
    if (SENSITIVE_FIELD_PATTERN.test(fieldName)) {
      return this.maskSensitiveValue(value, fieldName);
    }
    if (Array.isArray(value)) {
      return value
        .slice(0, MAX_COLLECTION_ITEMS)
        .map((item) => this.redactStructuredValue(item, "", depth + 1));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .slice(0, MAX_COLLECTION_ITEMS)
          .map(([key, item]) => [
            key,
            this.redactStructuredValue(item, key, depth + 1),
          ]),
      );
    }
    return value;
  }

  private maskSensitiveValue(value: unknown, fieldName: string): string {
    if (
      !/token.*hash|hash.*token/i.test(fieldName) ||
      typeof value !== "string" ||
      value.length < 12
    ) {
      return "[sensitive value hidden]";
    }
    return `${value.slice(0, 6)}...${value.slice(-4)}`;
  }

  private parseInfo(info: string): Map<string, string> {
    const values = new Map<string, string>();
    for (const line of info.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) {
        continue;
      }
      const separator = line.indexOf(":");
      if (separator > 0) {
        values.set(line.slice(0, separator), line.slice(separator + 1));
      }
    }
    return values;
  }

  private numberValue(values: Map<string, string>, key: string): number {
    const value = Number(values.get(key) ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  private escapeRedisGlob(value: string): string {
    return Array.from(value)
      .map((character) =>
        "\\*?[]".includes(character) ? `\\${character}` : character,
      )
      .join("");
  }

  private scanPattern(query: ListCacheKeysQueryDto): string {
    if (query.search) {
      return `*${this.escapeRedisGlob(query.search)}*`;
    }
    switch (query.category) {
      case "refresh-session":
        return "refresh_token:*";
      case "user-sessions":
        return "user_sessions:*";
      case "login-failure":
        return "login_fail:*";
      default:
        return "*";
    }
  }
}
