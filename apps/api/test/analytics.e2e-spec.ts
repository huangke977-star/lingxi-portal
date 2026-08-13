import { AnalyticsService } from "../src/analytics/analytics.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";

describe("admin analytics", () => {
  it("fills missing dates from daily aggregates and returns de-duplicated rankings", async () => {
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const metricDate = new Date(`${today}T00:00:00.000Z`);
    const generatedAt = new Date(`${today}T01:00:00.000Z`);
    const prisma = {
      dailyOperationMetric: {
        findMany: jest.fn(async () => [{
          metricDate,
          generatedAt,
          newUsers: 2,
          activeUsers: 5,
          publishedArticles: 1,
          comments: 3,
          messages: 8,
          articleViews: 13,
          likes: 4,
          favorites: 2,
          subscriptions: 3,
          articleReports: 1,
          groupReports: 2,
          disabledUsers: 1,
          loginRisks: 2,
          failedJobs: 1,
        }]),
      },
      dailyOperationRanking: {
        findMany: jest.fn(async () => [
          { id: 2, category: "article", entityKey: "article-1", label: "文章一", secondary: "@author", score: 30, metadata: { slug: "article-1" } },
          { id: 1, category: "author", entityKey: "7", label: "作者", secondary: "@author", score: 20, metadata: null },
          { id: 3, category: "author", entityKey: "7", label: "作者", secondary: "@author", score: 10, metadata: null },
          { id: 4, category: "search", entityKey: "redis", label: "Redis", secondary: "累计搜索", score: 8, metadata: null },
          { id: 5, category: "search", entityKey: "redis", label: "Redis", secondary: "累计搜索", score: 5, metadata: null },
        ]),
      },
    };
    const service = new AnalyticsService(
      prisma as unknown as PrismaService,
      { del: jest.fn(async () => 1) } as unknown as RedisService,
    );

    const result = await service.getAdminAnalytics(7);

    expect(result.trend).toHaveLength(7);
    expect(result.trend.at(-1)).toMatchObject({
      date: today,
      newUsers: 2,
      activeUsers: 5,
      articles: 1,
      messages: 8,
      reports: 3,
    });
    expect(result.summary).toMatchObject({ newUsers: 2, activeUsers: 5, articles: 1, messages: 8, reports: 3 });
    expect(result.latestAggregateAt).toBe(generatedAt.toISOString());
    expect(result.rankings.authors).toEqual([expect.objectContaining({ key: "7", score: 30 })]);
    expect(result.rankings.searches).toEqual([expect.objectContaining({ key: "redis", score: 8 })]);
    expect(result.rankings.articles[0]).toMatchObject({ key: "article-1", metadata: { slug: "article-1" } });
    expect(result.definitions.map((item) => item.key).sort()).toEqual([
      "activeUsers",
      "articles",
      "comments",
      "disabledUsers",
      "failedJobs",
      "favorites",
      "likes",
      "loginRisks",
      "messages",
      "newUsers",
      "reports",
      "subscriptions",
      "views",
    ]);
  });
});
