import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { statfs } from "node:fs/promises";
import { resolve } from "node:path";
import { RedisService } from "../redis/redis.service";
import type {
  DiskTrendPoint,
  HttpMonitoringEvent,
  LightweightMonitoringSnapshot,
  MemoryTrendPoint,
} from "./lightweight-monitoring.types";

const RESOURCE_SAMPLE_INTERVAL_MS = 60_000;
const RESOURCE_RETENTION_MINUTES = 24 * 60;
const RESOURCE_RETENTION_SECONDS = 48 * 60 * 60;
const RESOURCE_POINT_LIMIT = RESOURCE_RETENTION_MINUTES;
const HTTP_EVENT_LIMIT = 100;
const SLOW_REQUEST_KEY = "ops:monitoring:slow-requests";
const API_ERROR_KEY = "ops:monitoring:api-errors";
const MEMORY_TREND_KEY = "ops:monitoring:memory-trend";
const DISK_TREND_KEY = "ops:monitoring:disk-trend";

@Injectable()
export class LightweightMonitoringService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly slowRequestThresholdMs = this.numberSetting(
    "API_SLOW_REQUEST_THRESHOLD_MS",
    1_000,
    100,
    60_000,
  );
  private readonly slowRequests: HttpMonitoringEvent[] = [];
  private readonly recentErrors: HttpMonitoringEvent[] = [];
  private readonly memoryTrend: MemoryTrendPoint[] = [];
  private readonly diskTrend: DiskTrendPoint[] = [];
  private sampleTimer: NodeJS.Timeout | null = null;

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    void this.sampleResources();
    this.sampleTimer = setInterval(
      () => void this.sampleResources(),
      RESOURCE_SAMPLE_INTERVAL_MS,
    );
    this.sampleTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
  }

  recordHttpRequest(input: {
    method: string;
    path: string;
    statusCode: number;
    durationMs: number;
    message?: string | null;
  }): void {
    const event: HttpMonitoringEvent = {
      occurredAt: new Date().toISOString(),
      method: input.method.slice(0, 10).toUpperCase(),
      path: input.path.slice(0, 300),
      statusCode: input.statusCode,
      durationMs: Math.max(0, Math.round(input.durationMs * 10) / 10),
      message: input.message?.slice(0, 240) || null,
    };
    if (event.durationMs >= this.slowRequestThresholdMs) {
      this.pushMemory(this.slowRequests, event, HTTP_EVENT_LIMIT);
      this.persist(SLOW_REQUEST_KEY, event, HTTP_EVENT_LIMIT);
    }
    if (event.statusCode >= 500) {
      this.pushMemory(this.recentErrors, event, HTTP_EVENT_LIMIT);
      this.persist(API_ERROR_KEY, event, HTTP_EVENT_LIMIT);
    }
  }

  async getSnapshot(): Promise<LightweightMonitoringSnapshot> {
    if (!this.memoryTrend.length) await this.sampleResources();
    const [slowRequests, recentErrors, memoryTrend, diskTrend] =
      await Promise.all([
        this.readEvents(SLOW_REQUEST_KEY, this.slowRequests),
        this.readEvents(API_ERROR_KEY, this.recentErrors),
        this.readTrend(MEMORY_TREND_KEY, this.memoryTrend),
        this.readTrend(DISK_TREND_KEY, this.diskTrend),
      ]);
    return {
      retentionMinutes: RESOURCE_RETENTION_MINUTES,
      slowRequestThresholdMs: this.slowRequestThresholdMs,
      slowRequests,
      recentErrors,
      memoryTrend,
      diskTrend,
    };
  }

  async sampleResources(): Promise<void> {
    const memory = process.memoryUsage();
    const recordedAt = new Date().toISOString();
    const memoryPoint: MemoryTrendPoint = {
      recordedAt,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    };
    this.pushMemory(this.memoryTrend, memoryPoint, RESOURCE_POINT_LIMIT);
    this.persist(MEMORY_TREND_KEY, memoryPoint, RESOURCE_POINT_LIMIT);

    const diskPoint = await this.readDiskTrendPoint(recordedAt);
    if (!diskPoint) return;
    this.pushMemory(this.diskTrend, diskPoint, RESOURCE_POINT_LIMIT);
    this.persist(DISK_TREND_KEY, diskPoint, RESOURCE_POINT_LIMIT);
  }

  private async readDiskTrendPoint(
    recordedAt: string,
  ): Promise<DiskTrendPoint | null> {
    const candidates = [
      process.env.BACKGROUND_UPLOAD_DIR,
      process.env.ARTICLE_UPLOAD_DIR,
      process.cwd(),
    ].filter((value): value is string => Boolean(value?.trim()));
    for (const candidate of [
      ...new Set(candidates.map((value) => resolve(value))),
    ]) {
      try {
        const fileSystem = await statfs(candidate);
        const capacityBytes = fileSystem.blocks * fileSystem.bsize;
        const availableBytes = fileSystem.bavail * fileSystem.bsize;
        const usedBytes = Math.max(
          0,
          capacityBytes - fileSystem.bfree * fileSystem.bsize,
        );
        return {
          recordedAt,
          capacityBytes,
          usedBytes,
          availableBytes,
          usedPercent:
            capacityBytes > 0
              ? Math.round((usedBytes / capacityBytes) * 1_000) / 10
              : 0,
        };
      } catch {
        continue;
      }
    }
    return null;
  }

  private persist(
    key: string,
    value: HttpMonitoringEvent | MemoryTrendPoint | DiskTrendPoint,
    maximumLength: number,
  ): void {
    void this.redis
      .pushCappedList(
        key,
        JSON.stringify(value),
        maximumLength,
        RESOURCE_RETENTION_SECONDS,
      )
      .catch(() => undefined);
  }

  private async readEvents(
    key: string,
    fallback: HttpMonitoringEvent[],
  ): Promise<HttpMonitoringEvent[]> {
    const cutoff = Date.now() - RESOURCE_RETENTION_MINUTES * 60_000;
    return (
      await this.readList<HttpMonitoringEvent>(key, fallback, false)
    ).filter((event) => new Date(event.occurredAt).getTime() >= cutoff);
  }

  private async readTrend<T extends MemoryTrendPoint | DiskTrendPoint>(
    key: string,
    fallback: T[],
  ): Promise<T[]> {
    return this.readList<T>(key, fallback, true);
  }

  private async readList<T>(
    key: string,
    fallback: T[],
    chronological: boolean,
  ): Promise<T[]> {
    try {
      const values = await this.redis.lrange(key, 0, -1);
      const parsed = values
        .map((value) => this.parseValue<T>(value))
        .filter((value): value is T => value !== null);
      if (parsed.length) return chronological ? parsed.reverse() : parsed;
    } catch {
      // Redis is optional for monitoring reads; the process-local ring remains available.
    }
    return chronological ? [...fallback].reverse() : [...fallback];
  }

  private parseValue<T>(value: string): T | null {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private pushMemory<T>(items: T[], value: T, maximumLength: number): void {
    items.unshift(value);
    if (items.length > maximumLength) items.length = maximumLength;
  }

  private numberSetting(
    key: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const parsed = Number(process.env[key]);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
  }
}
