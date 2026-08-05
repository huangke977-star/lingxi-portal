import { RedisService } from "../src/redis/redis.service";
import { LightweightMonitoringService } from "../src/system-status/lightweight-monitoring.service";

describe("lightweight monitoring rings (e2e)", () => {
  it("keeps slow requests and 5xx errors in bounded Redis-backed rings", async () => {
    process.env.NODE_ENV = "test";
    process.env.API_SLOW_REQUEST_THRESHOLD_MS = "800";
    const lists = new Map<string, string[]>();
    const redis = {
      pushCappedList: jest.fn(
        async (key: string, value: string, maximumLength: number) => {
          const items = lists.get(key) ?? [];
          items.unshift(value);
          items.length = Math.min(items.length, maximumLength);
          lists.set(key, items);
        },
      ),
      lrange: jest.fn(async (key: string) => lists.get(key) ?? []),
    } as unknown as RedisService;
    const service = new LightweightMonitoringService(redis);

    service.recordHttpRequest({
      method: "get",
      path: "/articles/:slug",
      statusCode: 200,
      durationMs: 920.44,
    });
    service.recordHttpRequest({
      method: "post",
      path: "/articles",
      statusCode: 503,
      durationMs: 12.25,
      message: "Database unavailable",
    });
    service.recordHttpRequest({
      method: "get",
      path: "/health",
      statusCode: 200,
      durationMs: 4,
    });

    const snapshot = await service.getSnapshot();

    expect(snapshot.slowRequestThresholdMs).toBe(800);
    expect(snapshot.slowRequests).toHaveLength(1);
    expect(snapshot.slowRequests[0]).toMatchObject({
      method: "GET",
      path: "/articles/:slug",
      durationMs: 920.4,
    });
    expect(snapshot.recentErrors).toHaveLength(1);
    expect(snapshot.recentErrors[0]).toMatchObject({
      statusCode: 503,
      message: "Database unavailable",
    });
    expect(snapshot.memoryTrend.length).toBeGreaterThan(0);
    expect(redis.pushCappedList).toHaveBeenCalled();
  });
});
