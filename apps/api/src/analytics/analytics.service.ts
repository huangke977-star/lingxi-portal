import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { OperationJobStatus, Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { AdminAnalyticsResponse, AnalyticsRankingItem, AnalyticsTrendPoint } from "./analytics.types";

interface CountRow { value: bigint | number | string; }
interface RankingRow { entityKey: string | number; label: string; secondary: string; score: bigint | number | string; metadata?: string | null; }

const AGGREGATION_INTERVAL_MS = 60 * 60 * 1000;
const rankingCategories = ["author", "article", "search", "subscription_growth", "anonymous_topic"] as const;

@Injectable()
export class AnalyticsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsService.name);
  private timer: NodeJS.Timeout | null = null;
  private rebuilding = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.runAggregationInBackground(), AGGREGATION_INTERVAL_MS);
    this.timer.unref();
    setTimeout(() => void this.runAggregationInBackground(), 10_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async getAdminAnalytics(range: 7 | 30 | 90): Promise<AdminAnalyticsResponse> {
    const dateKeys = this.dateRange(range);
    const start = this.metricDate(dateKeys[0]);
    const [metrics, rankingRows] = await Promise.all([
      this.prisma.dailyOperationMetric.findMany({ where: { metricDate: { gte: start } }, orderBy: { metricDate: "asc" } }),
      this.prisma.dailyOperationRanking.findMany({
        where: { metricDate: { gte: start }, category: { in: [...rankingCategories] } },
        orderBy: [{ metricDate: "desc" }, { score: "desc" }, { id: "asc" }],
      }),
    ]);
    const byDate = new Map(metrics.map((item) => [this.dateKey(item.metricDate), item]));
    const trend = dateKeys.map((date): AnalyticsTrendPoint => {
      const item = byDate.get(date);
      return {
        date,
        newUsers: item?.newUsers ?? 0,
        activeUsers: item?.activeUsers ?? 0,
        articles: item?.publishedArticles ?? 0,
        comments: item?.comments ?? 0,
        messages: item?.messages ?? 0,
        views: item?.articleViews ?? 0,
        likes: item?.likes ?? 0,
        favorites: item?.favorites ?? 0,
        subscriptions: item?.subscriptions ?? 0,
        reports: (item?.articleReports ?? 0) + (item?.groupReports ?? 0),
        disabledUsers: item?.disabledUsers ?? 0,
        loginRisks: item?.loginRisks ?? 0,
        failedJobs: item?.failedJobs ?? 0,
        anonymousTopics: item?.anonymousTopics ?? 0,
        anonymousMessages: item?.anonymousMessages ?? 0,
        anonymousLikes: item?.anonymousLikes ?? 0,
        anonymousFavorites: item?.anonymousFavorites ?? 0,
        notifications: item?.notifications ?? 0,
        notificationReads: item?.notificationReads ?? 0,
        notificationOpens: item?.notificationOpens ?? 0,
      };
    });
    const summary = trend.reduce<Omit<AnalyticsTrendPoint, "date">>((total, point) => ({
      newUsers: total.newUsers + point.newUsers,
      activeUsers: total.activeUsers + point.activeUsers,
      articles: total.articles + point.articles,
      messages: total.messages + point.messages,
      views: total.views + point.views,
      likes: total.likes + point.likes,
      favorites: total.favorites + point.favorites,
      comments: total.comments + point.comments,
      subscriptions: total.subscriptions + point.subscriptions,
      reports: total.reports + point.reports,
      disabledUsers: total.disabledUsers + point.disabledUsers,
      loginRisks: total.loginRisks + point.loginRisks,
      failedJobs: total.failedJobs + point.failedJobs,
      anonymousTopics: total.anonymousTopics + point.anonymousTopics,
      anonymousMessages: total.anonymousMessages + point.anonymousMessages,
      anonymousLikes: total.anonymousLikes + point.anonymousLikes,
      anonymousFavorites: total.anonymousFavorites + point.anonymousFavorites,
      notifications: total.notifications + point.notifications,
      notificationReads: total.notificationReads + point.notificationReads,
      notificationOpens: total.notificationOpens + point.notificationOpens,
    }), { newUsers: 0, activeUsers: 0, articles: 0, comments: 0, messages: 0, views: 0, likes: 0, favorites: 0, subscriptions: 0, reports: 0, disabledUsers: 0, loginRisks: 0, failedJobs: 0, anonymousTopics: 0, anonymousMessages: 0, anonymousLikes: 0, anonymousFavorites: 0, notifications: 0, notificationReads: 0, notificationOpens: 0 });
    const rankings = Object.fromEntries(rankingCategories.map((category) => {
      const byEntity = new Map<string, AnalyticsRankingItem>();
      for (const row of rankingRows) {
        if (row.category !== category) continue;
        const key = String(row.entityKey);
        const existing = byEntity.get(key);
        if (existing) {
          // Search scores are cumulative snapshots; the other categories are daily values.
          if (category !== "search") existing.score += row.score;
          continue;
        }
        byEntity.set(key, {
          key,
          label: row.label,
          secondary: row.secondary,
          score: row.score,
          metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : null,
        });
      }
      return [category, [...byEntity.values()]
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label, "zh-CN"))
        .slice(0, 8)];
    })) as Record<(typeof rankingCategories)[number], AnalyticsRankingItem[]>;
    const response: AdminAnalyticsResponse = {
      range,
      generatedAt: new Date().toISOString(),
      latestAggregateAt: metrics.at(-1)?.generatedAt.toISOString() ?? null,
      summary,
      notificationConversion: {
        readRate: this.rate(summary.notificationReads, summary.notifications),
        openRate: this.rate(summary.notificationOpens, summary.notifications),
      },
      trend,
      rankings: {
        authors: rankings.author,
        articles: rankings.article,
        searches: rankings.search,
        subscriptionGrowth: rankings.subscription_growth,
        anonymousTopics: rankings.anonymous_topic,
      },
      definitions: this.metricDefinitions(),
    };
    return response;
  }

  async rebuildRange(range: 7 | 30 | 90, triggeredById?: number): Promise<{ success: true; days: number; completedAt: string }> {
    if (this.rebuilding) return { success: true, days: 0, completedAt: new Date().toISOString() };
    this.rebuilding = true;
    let jobId: number | null = null;
    try {
      const job = await this.prisma.operationJobRun.create({ data: { jobType: "daily_analytics", detail: `补算最近 ${range} 天，触发人 ${triggeredById ?? "system"}` } });
      jobId = job.id;
      for (const date of this.dateRange(range)) await this.aggregateDate(date);
      const completedAt = new Date();
      await this.prisma.operationJobRun.update({ where: { id: jobId }, data: { status: OperationJobStatus.completed, completedAt, detail: `已完成 ${range} 天运营聚合` } });
      await this.clearAnalyticsCache();
      return { success: true, days: range, completedAt: completedAt.toISOString() };
    } catch (error) {
      if (jobId !== null) {
        await this.prisma.operationJobRun.update({ where: { id: jobId }, data: { status: OperationJobStatus.failed, completedAt: new Date(), error: this.errorMessage(error) } }).catch(() => undefined);
      }
      throw error;
    } finally {
      this.rebuilding = false;
    }
  }

  private async ensureRecentAggregates(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    let jobId: number | null = null;
    try {
      const job = await this.prisma.operationJobRun.create({
        data: { jobType: "daily_analytics", detail: "自动刷新最近 2 个自然日" },
      });
      jobId = job.id;
      for (const date of this.dateRange(2)) await this.aggregateDate(date);
      await this.prisma.operationJobRun.update({
        where: { id: jobId },
        data: { status: OperationJobStatus.completed, completedAt: new Date(), detail: "已自动刷新最近 2 个自然日" },
      });
      await this.clearAnalyticsCache();
    } catch (error) {
      this.logger.warn(`Automatic analytics aggregation failed: ${this.errorMessage(error)}`);
      if (jobId !== null) {
        await this.prisma.operationJobRun.update({
          where: { id: jobId },
          data: { status: OperationJobStatus.failed, completedAt: new Date(), error: this.errorMessage(error) },
        }).catch(() => undefined);
      }
      // The failed run is persisted and retried at the next hourly cycle.
    } finally {
      this.rebuilding = false;
    }
  }

  private async runAggregationInBackground(): Promise<void> {
    await this.ensureRecentAggregates().catch((error) => {
      this.logger.warn(`Analytics background task failed: ${this.errorMessage(error)}`);
    });
  }

  private async aggregateDate(dateKey: string): Promise<void> {
    const { start, end } = this.utcBounds(dateKey);
    const count = (table: Prisma.Sql, column: Prisma.Sql = Prisma.sql`created_at`) => this.count(Prisma.sql`SELECT COUNT(*) AS value FROM ${table} WHERE ${column} >= ${start} AND ${column} < ${end}`);
    // Anonymous interaction metrics follow the existing net-relation definition used by article likes and favorites.
    const [newUsers, articles, comments, messages, views, likes, favorites, subscriptions, articleReports, groupReports, disabledUsers, loginRisks, failedMailJobs, failedStorageJobs, failedMediaJobs, failedOperationJobs, anonymousTopics, anonymousMessages, anonymousLikes, anonymousFavorites, notifications, notificationReads, notificationOpens, activeRows] = await Promise.all([
      count(Prisma.raw("users")),
      count(Prisma.raw("articles"), Prisma.sql`published_at`),
      count(Prisma.raw("article_comments")),
      count(Prisma.raw("chat_messages")),
      count(Prisma.raw("article_views")),
      count(Prisma.raw("article_likes")),
      count(Prisma.raw("article_favorites")),
      count(Prisma.raw("user_subscriptions")),
      count(Prisma.raw("article_comment_reports")),
      count(Prisma.raw("chat_group_message_reports")),
      this.count(Prisma.sql`SELECT COUNT(*) AS value FROM users WHERE status = 'disabled' AND updated_at >= ${start} AND updated_at < ${end}`),
      this.count(Prisma.sql`SELECT COUNT(*) AS value FROM login_security_events WHERE risk_level IN ('medium', 'high') AND created_at >= ${start} AND created_at < ${end}`),
      this.count(Prisma.sql`SELECT COUNT(*) AS value FROM mail_jobs WHERE status = 'failed' AND updated_at >= ${start} AND updated_at < ${end}`),
      this.count(Prisma.sql`SELECT COUNT(*) AS value FROM storage_scans WHERE status = 'failed' AND created_at >= ${start} AND created_at < ${end}`),
      this.count(Prisma.sql`SELECT COUNT(*) AS value FROM media_backup_jobs WHERE status IN ('partial', 'failed') AND created_at >= ${start} AND created_at < ${end}`),
      this.count(Prisma.sql`SELECT COUNT(*) AS value FROM operation_job_runs WHERE job_type <> 'daily_analytics' AND status = 'failed' AND created_at >= ${start} AND created_at < ${end}`),
      count(Prisma.raw("anonymous_topics")),
      count(Prisma.raw("anonymous_topic_messages")),
      this.count(Prisma.sql`SELECT COUNT(*) AS value FROM anonymous_topic_reactions WHERE value = 'up' AND created_at >= ${start} AND created_at < ${end}`),
      count(Prisma.raw("anonymous_topic_favorites")),
      count(Prisma.raw("user_notifications")),
      count(Prisma.raw("user_notifications"), Prisma.sql`read_at`),
      count(Prisma.raw("user_notifications"), Prisma.sql`opened_at`),
      this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT COUNT(DISTINCT user_id) AS value FROM (
          SELECT id AS user_id FROM users WHERE last_login_at >= ${start} AND last_login_at < ${end}
          UNION SELECT user_id FROM article_views WHERE user_id IS NOT NULL AND created_at >= ${start} AND created_at < ${end}
          UNION SELECT author_id AS user_id FROM article_comments WHERE created_at >= ${start} AND created_at < ${end}
          UNION SELECT sender_id AS user_id FROM chat_messages WHERE created_at >= ${start} AND created_at < ${end}
        ) AS active_users
      `),
    ]);
    const metricDate = this.metricDate(dateKey);
    const data = {
      newUsers,
      activeUsers: Number(activeRows[0]?.value ?? 0),
      publishedArticles: articles,
      comments,
      messages,
      articleViews: views,
      likes,
      favorites,
      subscriptions,
      articleReports,
      groupReports,
      disabledUsers,
      loginRisks,
      failedJobs: failedMailJobs + failedStorageJobs + failedMediaJobs + failedOperationJobs,
      anonymousTopics,
      anonymousMessages,
      anonymousLikes,
      anonymousFavorites,
      notifications,
      notificationReads,
      notificationOpens,
      generatedAt: new Date(),
    };
    await this.prisma.dailyOperationMetric.upsert({ where: { metricDate }, create: { metricDate, ...data }, update: data });
    const rankings = await this.collectRankings(start, end);
    await this.prisma.$transaction([
      this.prisma.dailyOperationRanking.deleteMany({ where: { metricDate } }),
      ...rankings.map((item) => this.prisma.dailyOperationRanking.create({ data: { metricDate, ...item } })),
    ]);
  }

  private async collectRankings(start: Date, end: Date) {
    const [authors, articles, searches, subscriptionGrowth, anonymousTopics] = await Promise.all([
      this.prisma.$queryRaw<RankingRow[]>(Prisma.sql`
        SELECT CAST(u.id AS CHAR) entityKey, u.nickname label, CONCAT('@', u.username) secondary,
          COUNT(DISTINCT a.id) * 5 + COALESCE(SUM(a.view_count + a.like_count * 3 + a.favorite_count * 3 + a.comment_count * 4), 0) score
        FROM users u JOIN articles a ON a.author_id = u.id
        WHERE a.status = 'published' AND a.published_at >= ${start} AND a.published_at < ${end}
        GROUP BY u.id, u.nickname, u.username ORDER BY score DESC LIMIT 10
      `),
      this.prisma.$queryRaw<RankingRow[]>(Prisma.sql`
        SELECT CAST(a.id AS CHAR) entityKey, a.title label, CONCAT('@', u.username) secondary,
          (a.view_count + a.like_count * 3 + a.favorite_count * 3 + a.comment_count * 4) score,
          JSON_OBJECT('slug', a.slug) metadata
        FROM articles a JOIN users u ON u.id = a.author_id
        WHERE a.status = 'published' AND a.published_at >= ${start} AND a.published_at < ${end}
        ORDER BY score DESC LIMIT 10
      `),
      this.prisma.$queryRaw<RankingRow[]>(Prisma.sql`
        SELECT normalized_key entityKey, keyword label, '累计搜索' secondary, search_count score
        FROM search_keyword_stats WHERE last_searched_at < ${end}
        ORDER BY search_count DESC, last_searched_at DESC LIMIT 10
      `),
      this.prisma.$queryRaw<RankingRow[]>(Prisma.sql`
        SELECT CAST(u.id AS CHAR) entityKey, u.nickname label, CONCAT('@', u.username) secondary, COUNT(*) score
        FROM user_subscriptions s JOIN users u ON u.id = s.author_id
        WHERE s.created_at >= ${start} AND s.created_at < ${end}
        GROUP BY u.id, u.nickname, u.username ORDER BY score DESC LIMIT 10
      `),
      // Daily topic ranking uses activity created in the day, preventing a popular old topic from being counted again every day.
      this.prisma.$queryRaw<RankingRow[]>(Prisma.sql`
        SELECT CAST(t.id AS CHAR) entityKey, t.title label,
          CONCAT(t.message_count, ' 条讨论 · ', t.favorite_count, ' 次喜欢') secondary,
          (CASE WHEN t.created_at >= ${start} AND t.created_at < ${end} THEN 1 ELSE 0 END)
            + COALESCE(m.daily_messages, 0) * 2
            + COALESCE(l.daily_likes, 0) * 3
            + COALESCE(f.daily_favorites, 0) * 4 score,
          JSON_OBJECT('topicId', t.id) metadata
        FROM anonymous_topics t
        LEFT JOIN (
          SELECT topic_id, COUNT(*) daily_messages FROM anonymous_topic_messages
          WHERE created_at >= ${start} AND created_at < ${end} GROUP BY topic_id
        ) m ON m.topic_id = t.id
        LEFT JOIN (
          SELECT message.topic_id, COUNT(*) daily_likes
          FROM anonymous_topic_reactions reaction
          JOIN anonymous_topic_messages message ON message.id = reaction.message_id
          WHERE reaction.value = 'up' AND reaction.created_at >= ${start} AND reaction.created_at < ${end}
          GROUP BY message.topic_id
        ) l ON l.topic_id = t.id
        LEFT JOIN (
          SELECT topic_id, COUNT(*) daily_favorites FROM anonymous_topic_favorites
          WHERE created_at >= ${start} AND created_at < ${end} GROUP BY topic_id
        ) f ON f.topic_id = t.id
        WHERE t.is_hidden = false AND (
          (t.created_at >= ${start} AND t.created_at < ${end})
          OR COALESCE(m.daily_messages, 0) > 0
          OR COALESCE(l.daily_likes, 0) > 0
          OR COALESCE(f.daily_favorites, 0) > 0
        )
        ORDER BY score DESC, t.updated_at DESC LIMIT 10
      `),
    ]);
    return [
      ...this.mapRankings("author", authors),
      ...this.mapRankings("article", articles),
      ...this.mapRankings("search", searches),
      ...this.mapRankings("subscription_growth", subscriptionGrowth),
      ...this.mapRankings("anonymous_topic", anonymousTopics),
    ];
  }

  private mapRankings(category: string, rows: RankingRow[]) {
    return rows.map((row) => ({
      category,
      entityKey: String(row.entityKey),
      label: row.label,
      secondary: row.secondary ?? "",
      score: Number(row.score),
      metadata: row.metadata ? this.parseMetadata(row.metadata) : undefined,
    }));
  }

  private async count(query: Prisma.Sql): Promise<number> {
    const rows = await this.prisma.$queryRaw<CountRow[]>(query);
    return Number(rows[0]?.value ?? 0);
  }

  private parseMetadata(value: string): Prisma.InputJsonValue | undefined {
    try { return JSON.parse(value) as Prisma.InputJsonValue; } catch { return undefined; }
  }

  private utcBounds(dateKey: string): { start: Date; end: Date } {
    const localMidnight = Date.parse(`${dateKey}T00:00:00+08:00`);
    return { start: new Date(localMidnight), end: new Date(localMidnight + 86_400_000) };
  }

  private metricDate(dateKey: string): Date {
    return new Date(`${dateKey}T00:00:00.000Z`);
  }

  private async clearAnalyticsCache(): Promise<void> {
    try { await Promise.all([7, 30, 90].map((range) => this.redis.del(`analytics:admin:${range}`))); } catch { /* Redis is optional. */ }
  }

  private metricDefinitions(): AdminAnalyticsResponse["definitions"] {
    return [
      { key: "newUsers", label: "新增用户", definition: "当天完成注册并写入用户表的账号数量。" },
      { key: "activeUsers", label: "活跃用户", definition: "当天发生登录、文章阅读、评论或发送聊天消息的去重账号。" },
      { key: "articles", label: "发布文章", definition: "当天首次进入已发布状态的文章数量。" },
      { key: "comments", label: "评论", definition: "当天新建的文章评论和回复数量。" },
      { key: "messages", label: "聊天消息", definition: "当天发送的私聊、群聊和通知会话消息数量。" },
      { key: "views", label: "文章阅读", definition: "当天产生的文章阅读记录数量。" },
      { key: "likes", label: "点赞", definition: "当天新增的文章点赞记录数量。" },
      { key: "favorites", label: "收藏", definition: "当天新增的文章收藏记录数量。" },
      { key: "subscriptions", label: "订阅增长", definition: "当天新增的作者订阅关系数量。" },
      { key: "reports", label: "举报", definition: "当天新建的文章评论举报和群消息举报总数。" },
      { key: "disabledUsers", label: "封禁", definition: "当天被更新为停用状态的账号数量。" },
      { key: "loginRisks", label: "登录风险", definition: "当天记录的中风险和高风险登录安全事件。" },
      { key: "failedJobs", label: "异常任务", definition: "当天失败的邮件、存储扫描、媒体备份和运营后台任务总数。" },
      { key: "anonymousTopics", label: "匿名话题", definition: "当天新发起的匿名话题数量。" },
      { key: "anonymousMessages", label: "匿名发言", definition: "当天在匿名话题中发送的点评数量。" },
      { key: "anonymousLikes", label: "点评获赞", definition: "当天新增且当前仍有效的匿名点评点赞记录数量。" },
      { key: "anonymousFavorites", label: "话题喜欢", definition: "当天新增且当前仍有效的话题喜欢记录数量。" },
      { key: "notifications", label: "通知创建", definition: "当天创建的站内通知数量。" },
      { key: "notificationReads", label: "通知已读", definition: "当天被标记为已读的站内通知数量。" },
      { key: "notificationOpens", label: "通知打开", definition: "当天打开并进入关联内容的站内通知数量。" },
    ];
  }

  private rate(value: number, total: number): number {
    return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
  }

  private dateRange(range: number): string[] {
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000);
    today.setUTCHours(0, 0, 0, 0);
    return Array.from({ length: range }, (_, index) => {
      const date = new Date(today.getTime() - (range - 1 - index) * 86_400_000);
      return date.toISOString().slice(0, 10);
    });
  }

  private dateKey(value: Date | string): string {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  }
}
