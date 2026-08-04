import { Injectable } from "@nestjs/common";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { AdminAnalyticsResponse, AnalyticsTrendPoint } from "./analytics.types";

interface DailyCountRow {
  date: Date | string;
  value: bigint | number | string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getAdminAnalytics(range: 7 | 30 | 90): Promise<AdminAnalyticsResponse> {
    const cacheKey = `analytics:admin:${range}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as AdminAnalyticsResponse;
    } catch {
      // Analytics can be calculated directly when Redis is unavailable.
    }

    const startAt = this.chinaRangeStart(range);
    const [users, articles, views, likes, favorites, comments, subscriptions] = await Promise.all([
      this.prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
        SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS date, COUNT(*) AS value
        FROM users WHERE created_at >= ${startAt}
        GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR))
      `),
      this.prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
        SELECT DATE(DATE_ADD(published_at, INTERVAL 8 HOUR)) AS date, COUNT(*) AS value
        FROM articles WHERE published_at >= ${startAt}
        GROUP BY DATE(DATE_ADD(published_at, INTERVAL 8 HOUR))
      `),
      this.prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
        SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS date, COUNT(*) AS value
        FROM article_views WHERE created_at >= ${startAt}
        GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR))
      `),
      this.prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
        SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS date, COUNT(*) AS value
        FROM article_likes WHERE created_at >= ${startAt}
        GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR))
      `),
      this.prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
        SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS date, COUNT(*) AS value
        FROM article_favorites WHERE created_at >= ${startAt}
        GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR))
      `),
      this.prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
        SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS date, COUNT(*) AS value
        FROM article_comments WHERE created_at >= ${startAt}
        GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR))
      `),
      this.prisma.$queryRaw<DailyCountRow[]>(Prisma.sql`
        SELECT DATE(DATE_ADD(created_at, INTERVAL 8 HOUR)) AS date, COUNT(*) AS value
        FROM user_subscriptions WHERE created_at >= ${startAt}
        GROUP BY DATE(DATE_ADD(created_at, INTERVAL 8 HOUR))
      `),
    ]);

    const maps = [users, articles, views, likes, favorites, comments, subscriptions]
      .map((rows) => this.toDateMap(rows));
    const trend = this.dateRange(range).map((date) => ({
      date,
      users: maps[0].get(date) ?? 0,
      articles: maps[1].get(date) ?? 0,
      views: maps[2].get(date) ?? 0,
      likes: maps[3].get(date) ?? 0,
      favorites: maps[4].get(date) ?? 0,
      comments: maps[5].get(date) ?? 0,
      subscriptions: maps[6].get(date) ?? 0,
    }));
    const summary = trend.reduce<Omit<AnalyticsTrendPoint, "date">>((total, point) => ({
      users: total.users + point.users,
      articles: total.articles + point.articles,
      views: total.views + point.views,
      likes: total.likes + point.likes,
      favorites: total.favorites + point.favorites,
      comments: total.comments + point.comments,
      subscriptions: total.subscriptions + point.subscriptions,
    }), { users: 0, articles: 0, views: 0, likes: 0, favorites: 0, comments: 0, subscriptions: 0 });
    const response: AdminAnalyticsResponse = {
      range,
      generatedAt: new Date().toISOString(),
      summary,
      trend,
    };
    try {
      await this.redis.set(cacheKey, JSON.stringify(response), 300);
    } catch {
      // Cache writes are optional because the response has already been calculated.
    }
    return response;
  }

  private toDateMap(rows: DailyCountRow[]): Map<string, number> {
    return new Map(rows.map((row) => [this.dateKey(row.date), Number(row.value)]));
  }

  private dateRange(range: number): string[] {
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000);
    today.setUTCHours(0, 0, 0, 0);
    return Array.from({ length: range }, (_, index) => {
      const date = new Date(today.getTime() - (range - 1 - index) * 86_400_000);
      return date.toISOString().slice(0, 10);
    });
  }

  private chinaRangeStart(range: number): Date {
    const chinaToday = new Date(Date.now() + 8 * 60 * 60 * 1000);
    chinaToday.setUTCHours(0, 0, 0, 0);
    return new Date(chinaToday.getTime() - 8 * 60 * 60 * 1000 - (range - 1) * 86_400_000);
  }

  private dateKey(value: Date | string): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }
}
