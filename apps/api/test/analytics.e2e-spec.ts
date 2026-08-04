import { AnalyticsService } from "../src/analytics/analytics.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";

describe("admin analytics", () => {
  it("fills missing dates and sums each trend series", async () => {
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const prisma = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ date: today, value: 2n }])
        .mockResolvedValueOnce([{ date: today, value: 1n }])
        .mockResolvedValueOnce([{ date: today, value: 8n }])
        .mockResolvedValueOnce([{ date: today, value: 3n }])
        .mockResolvedValueOnce([{ date: today, value: 4n }])
        .mockResolvedValueOnce([{ date: today, value: 5n }])
        .mockResolvedValueOnce([{ date: today, value: 6n }]),
    };
    const redis = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };
    const service = new AnalyticsService(
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );

    const result = await service.getAdminAnalytics(7);

    expect(result.trend).toHaveLength(7);
    expect(result.trend.at(-1)).toMatchObject({ date: today, users: 2, articles: 1, views: 8 });
    expect(result.summary).toEqual({ users: 2, articles: 1, views: 8, likes: 3, favorites: 4, comments: 5, subscriptions: 6 });
    expect(redis.set).toHaveBeenCalledWith("analytics:admin:7", expect.any(String), 300);
  });
});
