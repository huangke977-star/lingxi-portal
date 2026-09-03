import {
  BadRequestException,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import {
  ArticleStatus,
  ArticleTopicStatus,
  ArticleVisibility,
  MailJobType,
  PortalVisibility,
  Prisma,
  ProfileAccessLevel,
  SubscriptionDeliveryFrequency,
  SubscriptionEmailDeliveryStatus,
  UserStatus,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { MailService } from "../security/mail.service";
import { SecurityConfigurationService } from "../security/security-configuration.service";
import { SiteSettingsService } from "../site-settings/site-settings.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { UpdateSubscriptionEmailPreferenceDto } from "./dto/distribution.dto";
import { SubscriptionEmailDeliveryResponse, SubscriptionEmailSettingsResponse } from "./distribution.types";

type FeedFormat = "rss" | "atom";
type FeedScope =
  | { kind: "site"; path: string; title: string }
  | { kind: "author"; path: string; title: string; username: string }
  | { kind: "topic"; path: string; title: string; slug: string }
  | { kind: "collection"; path: string; title: string; id: number };

interface FeedArticle {
  id: number;
  title: string;
  summary: string;
  slug: string;
  publishedAt: Date | null;
  updatedAt: Date;
  author: { nickname: string; username: string };
}

@Injectable()
export class DistributionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DistributionService.name);
  private emailTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly mail: MailService,
    private readonly securityConfiguration: SecurityConfigurationService,
    private readonly siteSettings: SiteSettingsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.emailTimer = setInterval(() => void this.dispatchSubscriptionEmails().catch((error) => this.logger.warn(this.errorMessage(error))), 30 * 60 * 1000);
    this.emailTimer.unref();
    setTimeout(() => void this.dispatchSubscriptionEmails().catch((error) => this.logger.warn(this.errorMessage(error))), 5_000).unref();
  }

  onModuleDestroy(): void {
    if (this.emailTimer) clearInterval(this.emailTimer);
  }

  async renderFeed(scope: FeedScope, format: FeedFormat, ip: string): Promise<string> {
    await this.assertFeedRateLimit(ip, `${scope.kind}:${scope.kind === "author" ? scope.username : scope.kind === "topic" ? scope.slug : scope.kind === "collection" ? scope.id : "site"}`);
    const [resolvedScope, settings] = await Promise.all([this.resolveFeedScope(scope), this.siteSettings.getPublicSettings()]);
    const articles = await this.findFeedArticles(resolvedScope);
    const siteUrl = this.siteUrl();
    const feedUrl = this.absoluteUrl(resolvedScope.path);
    const titledScope = resolvedScope.kind === "site" ? { ...resolvedScope, title: settings.siteName } as FeedScope : resolvedScope;
    return format === "rss"
      ? this.renderRss(titledScope, articles, siteUrl, feedUrl)
      : this.renderAtom(titledScope, articles, siteUrl, feedUrl);
  }

  async getSitemapEntries(): Promise<Array<{ url: string; lastModified: string }>> {
    const siteUrl = this.siteUrl();
    const [articles, authors, topics, collections] = await Promise.all([
      this.prisma.article.findMany({
        where: { status: ArticleStatus.published, visibility: ArticleVisibility.public, author: { is: { status: UserStatus.active } } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.user.findMany({
        where: {
          status: UserStatus.active,
          OR: [
            { profileSettings: null },
            { profileSettings: { is: { profileAccess: ProfileAccessLevel.public, searchable: true } } },
          ],
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { username: true, updatedAt: true },
      }),
      this.prisma.articleTopic.findMany({
        where: { status: ArticleTopicStatus.active, visibility: "public" },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { slug: true, updatedAt: true },
      }),
      this.prisma.articleCollection.findMany({
        where: { visibility: ArticleVisibility.public, owner: { is: { status: UserStatus.active } } },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { id: true, updatedAt: true },
      }),
    ]);
    return [
      { url: siteUrl, lastModified: new Date().toISOString() },
      { url: this.absoluteUrl("/articles"), lastModified: new Date().toISOString() },
      { url: this.absoluteUrl("/topics"), lastModified: topics[0]?.updatedAt.toISOString() ?? new Date().toISOString() },
      { url: this.absoluteUrl("/articles/collections"), lastModified: collections[0]?.updatedAt.toISOString() ?? new Date().toISOString() },
      ...articles.map((article) => ({ url: this.absoluteUrl(`/articles/${encodeURIComponent(article.slug)}`), lastModified: article.updatedAt.toISOString() })),
      ...authors.map((author) => ({ url: this.absoluteUrl(`/users/${encodeURIComponent(author.username)}`), lastModified: author.updatedAt.toISOString() })),
      ...topics.map((topic) => ({ url: this.absoluteUrl(`/topics/${encodeURIComponent(topic.slug)}`), lastModified: topic.updatedAt.toISOString() })),
      ...collections.map((collection) => ({ url: this.absoluteUrl(`/collections/${collection.id}`), lastModified: collection.updatedAt.toISOString() })),
    ];
  }

  async getEmailSettings(user: AuthenticatedUser): Promise<SubscriptionEmailSettingsResponse> {
    const [preference, deliveries, configuration] = await Promise.all([
      this.ensureEmailPreference(user.id),
      this.prisma.subscriptionEmailDelivery.findMany({
        where: { userId: user.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
      this.securityConfiguration.getConfiguration(),
    ]);
    return {
      available: configuration.smtpEnabled,
      enabled: preference.enabled,
      unsubscribedAt: preference.unsubscribedAt?.toISOString() ?? null,
      deliveries: deliveries.map((delivery) => this.toDeliveryResponse(delivery)),
    };
  }

  async updateEmailSettings(user: AuthenticatedUser, dto: UpdateSubscriptionEmailPreferenceDto): Promise<SubscriptionEmailSettingsResponse> {
    await this.ensureEmailPreference(user.id);
    if (dto.enabled) {
      const configuration = await this.securityConfiguration.getConfiguration();
      if (!configuration.smtpEnabled) throw new BadRequestException("邮件日报暂未启用，请联系管理员配置 SMTP。");
    }
    await this.prisma.subscriptionEmailPreference.update({
      where: { userId: user.id },
      data: { enabled: dto.enabled, unsubscribedAt: dto.enabled ? null : new Date() },
    });
    return this.getEmailSettings(user);
  }

  async unsubscribeByToken(token: string): Promise<{ unsubscribed: true }> {
    const normalized = token.trim();
    if (!/^[a-f0-9]{64}$/i.test(normalized)) throw new NotFoundException("退订链接无效或已失效。");
    const result = await this.prisma.subscriptionEmailPreference.updateMany({
      where: { unsubscribeToken: normalized },
      data: { enabled: false, unsubscribedAt: new Date() },
    });
    if (!result.count) throw new NotFoundException("退订链接无效或已失效。");
    return { unsubscribed: true };
  }

  async getPublicArticleMetadata(slug: string) {
    const article = await this.prisma.article.findFirst({
      where: {
        slug: slug.trim(),
        status: ArticleStatus.published,
        visibility: ArticleVisibility.public,
        author: { is: { status: UserStatus.active } },
      },
      select: {
        title: true,
        slug: true,
        summary: true,
        coverPath: true,
        publishedAt: true,
        updatedAt: true,
        author: { select: { nickname: true, username: true } },
      },
    });
    if (!article) throw new NotFoundException("文章不存在或当前不可公开访问。");
    return {
      title: article.title,
      slug: article.slug,
      summary: article.summary || article.title,
      coverPath: article.coverPath,
      authorName: article.author.nickname || article.author.username,
      authorUsername: article.author.username,
      publishedAt: article.publishedAt?.toISOString() ?? null,
      updatedAt: article.updatedAt.toISOString(),
      language: "zh_CN",
    };
  }

  async dispatchSubscriptionEmails(): Promise<void> {
    const configuration = await this.securityConfiguration.getConfiguration();
    if (!configuration.smtpEnabled) return;
    const now = new Date();
    const china = this.chinaDateTimeParts(now);
    if (china.hour < 9) return;
    const dayKey = `${china.year}-${String(china.month).padStart(2, "0")}-${String(china.day).padStart(2, "0")}`;
    const startedAfter = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const preferences = await this.prisma.subscriptionEmailPreference.findMany({
      where: { enabled: true, user: { status: UserStatus.active } },
      include: { user: { select: { id: true, email: true, preferredLocale: true, role: { select: { code: true } } } } },
      take: 500,
    });
    for (const preference of preferences) {
      const articles = await this.findDigestArticles(preference.user.id, preference.user.role.code, startedAfter, now);
      if (!articles.length) continue;
      const articleIds = articles.map(({ id }) => id);
      const delivery = await this.prisma.subscriptionEmailDelivery.upsert({
        where: { userId_dayKey: { userId: preference.user.id, dayKey } },
        create: { userId: preference.user.id, dayKey, itemCount: articles.length, articleIds },
        update: { itemCount: articles.length, articleIds },
      });
      if (delivery.status === SubscriptionEmailDeliveryStatus.sent || delivery.attempts >= 3) continue;
      const claimed = await this.prisma.subscriptionEmailDelivery.updateMany({
        where: { id: delivery.id, status: { in: [SubscriptionEmailDeliveryStatus.pending, SubscriptionEmailDeliveryStatus.failed] }, attempts: { lt: 3 } },
        data: { status: SubscriptionEmailDeliveryStatus.sending, attempts: { increment: 1 }, lastError: null },
      });
      if (!claimed.count) continue;
      try {
        const english = preference.user.preferredLocale === "en-US";
        const subject = english ? `Your subscription digest for ${dayKey}` : `订阅日报 ${dayKey}`;
        const text = this.renderDigestText(articles, english, dayKey);
        const html = this.renderDigestHtml(articles, english, dayKey, preference.unsubscribeToken);
        await this.mail.send({
          type: MailJobType.subscription_digest,
          recipient: preference.user.email,
          subject,
          text,
          html,
          userId: preference.user.id,
          metadata: { dayKey, articleIds },
        });
        await this.prisma.subscriptionEmailDelivery.update({ where: { id: delivery.id }, data: { status: SubscriptionEmailDeliveryStatus.sent, sentAt: new Date(), lastError: null } });
      } catch (error) {
        await this.prisma.subscriptionEmailDelivery.update({ where: { id: delivery.id }, data: { status: SubscriptionEmailDeliveryStatus.failed, lastError: this.errorMessage(error).slice(0, 1000) } });
      }
    }
  }

  private async findFeedArticles(scope: FeedScope): Promise<FeedArticle[]> {
    let where: Prisma.ArticleWhereInput = { status: ArticleStatus.published, visibility: ArticleVisibility.public, author: { is: { status: UserStatus.active } } };
    if (scope.kind === "author") where = { ...where, author: { is: { username: scope.username, status: UserStatus.active } } };
    if (scope.kind === "topic") where = { ...where, topicItems: { some: { topic: { is: { slug: scope.slug, status: ArticleTopicStatus.active, visibility: PortalVisibility.public } } } } };
    if (scope.kind === "collection") where = { ...where, collectionItems: { some: { collection: { is: { id: scope.id, visibility: ArticleVisibility.public, owner: { is: { status: UserStatus.active } } } } } } };
    return this.prisma.article.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { id: true, title: true, summary: true, slug: true, publishedAt: true, updatedAt: true, author: { select: { nickname: true, username: true } } },
    });
  }

  private async resolveFeedScope(scope: FeedScope): Promise<FeedScope> {
    if (scope.kind === "site") return scope;
    if (scope.kind === "author") {
      const author = await this.prisma.user.findFirst({
        where: {
          username: scope.username,
          status: UserStatus.active,
          OR: [
            { profileSettings: null },
            { profileSettings: { is: { profileAccess: ProfileAccessLevel.public } } },
          ],
        },
        select: { nickname: true, username: true },
      });
      if (!author) throw new NotFoundException("作者订阅源不可用。");
      return { ...scope, title: author.nickname || `@${author.username}` };
    }
    if (scope.kind === "topic") {
      const topic = await this.prisma.articleTopic.findFirst({
        where: { slug: scope.slug, status: ArticleTopicStatus.active, visibility: PortalVisibility.public },
        select: { title: true },
      });
      if (!topic) throw new NotFoundException("专题订阅源不可用。");
      return { ...scope, title: topic.title };
    }
    const collection = await this.prisma.articleCollection.findFirst({
      where: { id: scope.id, visibility: ArticleVisibility.public, owner: { is: { status: UserStatus.active } } },
      select: { name: true },
    });
    if (!collection) throw new NotFoundException("合集订阅源不可用。");
    return { ...scope, title: collection.name };
  }

  private async findDigestArticles(userId: number, roleCode: string, startedAfter: Date, now: Date) {
    const [authorSubscriptions, topicSubscriptions, tagSubscriptions] = await Promise.all([
      this.prisma.userSubscription.findMany({ where: { subscriberId: userId, notifyNewArticles: true, frequency: SubscriptionDeliveryFrequency.daily }, select: { authorId: true } }),
      this.prisma.articleTopicSubscription.findMany({ where: { userId, frequency: SubscriptionDeliveryFrequency.daily, topic: { status: ArticleTopicStatus.active } }, select: { topicId: true } }),
      this.prisma.articleTagSubscription.findMany({ where: { userId, frequency: SubscriptionDeliveryFrequency.daily }, select: { tag: true } }),
    ]);
    const authorIds = [...new Set(authorSubscriptions.map(({ authorId }) => authorId))];
    const topicIds = [...new Set(topicSubscriptions.map(({ topicId }) => topicId))];
    const tags = [...new Set(tagSubscriptions.map(({ tag }) => tag))];
    const matches: Prisma.ArticleWhereInput[] = [];
    if (authorIds.length) matches.push({ authorId: { in: authorIds } });
    if (topicIds.length) matches.push({ topicItems: { some: { topicId: { in: topicIds }, topic: { is: { status: ArticleTopicStatus.active } } } } });
    tags.forEach((tag) => matches.push({ tags: { contains: tag } }));
    if (!matches.length) return [];
    const records = await this.prisma.article.findMany({
      where: {
        status: ArticleStatus.published,
        publishedAt: { gte: startedAfter, lte: now },
        visibility: { not: ArticleVisibility.private },
        author: { is: { status: UserStatus.active } },
        OR: matches,
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 100,
      select: { id: true, title: true, summary: true, slug: true, publishedAt: true, visibility: true, author: { select: { nickname: true, username: true } }, allowedRoles: { select: { role: { select: { code: true } } } } },
    });
    return records
      .filter((article) => article.visibility !== ArticleVisibility.role_restricted || article.allowedRoles.some(({ role }) => role.code === roleCode))
      .map((article) => ({
        id: article.id,
        title: article.title,
        summary: article.summary,
        slug: article.slug,
        publishedAt: article.publishedAt,
        author: article.author,
      }));
  }

  private async ensureEmailPreference(userId: number) {
    return this.prisma.subscriptionEmailPreference.upsert({
      where: { userId },
      create: { userId, unsubscribeToken: randomBytes(32).toString("hex") },
      update: {},
    });
  }

  private renderRss(scope: FeedScope, articles: FeedArticle[], siteUrl: string, feedUrl: string): string {
    const items = articles.map((article) => {
      const articleUrl = this.absoluteUrl(`/articles/${encodeURIComponent(article.slug)}`);
      return `<item><title>${this.xml(article.title)}</title><link>${this.xml(articleUrl)}</link><guid isPermaLink="true">${this.xml(articleUrl)}</guid><description>${this.xml(article.summary || article.title)}</description><pubDate>${(article.publishedAt ?? article.updatedAt).toUTCString()}</pubDate><author>${this.xml(`${article.author.username}@${new URL(siteUrl).hostname} (${article.author.nickname})`)}</author></item>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${this.xml(scope.title)}</title><link>${this.xml(siteUrl)}</link><description>${this.xml(`${scope.title} public articles`)}</description><language>zh-CN</language><atom:link href="${this.xml(feedUrl)}" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
  }

  private renderAtom(scope: FeedScope, articles: FeedArticle[], siteUrl: string, feedUrl: string): string {
    const updated = articles[0]?.updatedAt ?? new Date();
    const entries = articles.map((article) => {
      const articleUrl = this.absoluteUrl(`/articles/${encodeURIComponent(article.slug)}`);
      const published = (article.publishedAt ?? article.updatedAt).toISOString();
      return `<entry><title>${this.xml(article.title)}</title><id>${this.xml(articleUrl)}</id><link href="${this.xml(articleUrl)}"/><updated>${article.updatedAt.toISOString()}</updated><published>${published}</published><author><name>${this.xml(article.author.nickname)}</name><uri>${this.xml(this.absoluteUrl(`/users/${encodeURIComponent(article.author.username)}`))}</uri></author><summary>${this.xml(article.summary || article.title)}</summary></entry>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>${this.xml(scope.title)}</title><id>${this.xml(feedUrl)}</id><link href="${this.xml(siteUrl)}"/><link href="${this.xml(feedUrl)}" rel="self"/><updated>${updated.toISOString()}</updated>${entries}</feed>`;
  }

  private renderDigestText(articles: Array<{ title: string; summary: string; slug: string; author: { nickname: string } }>, english: boolean, dayKey: string): string {
    const title = english ? `Subscription digest for ${dayKey}` : `订阅日报 ${dayKey}`;
    const lines = articles.map((article) => `- ${article.title} · ${article.author.nickname}\n  ${this.absoluteUrl(`/articles/${encodeURIComponent(article.slug)}`)}`);
    return `${title}\n\n${lines.join("\n")}`;
  }

  private renderDigestHtml(articles: Array<{ title: string; summary: string; slug: string; author: { nickname: string } }>, english: boolean, dayKey: string, token: string): string {
    const title = english ? `Subscription digest for ${dayKey}` : `订阅日报 ${dayKey}`;
    const unsubscribe = this.absoluteUrl(`/unsubscribe/${encodeURIComponent(token)}`);
    const rows = articles.map((article) => `<li><a href="${this.xml(this.absoluteUrl(`/articles/${encodeURIComponent(article.slug)}`))}">${this.xml(article.title)}</a><span> · ${this.xml(article.author.nickname)}</span>${article.summary ? `<p>${this.xml(article.summary)}</p>` : ""}</li>`).join("");
    return `<div><h2>${this.xml(title)}</h2><ul>${rows}</ul><p><a href="${this.xml(unsubscribe)}">${english ? "Unsubscribe from email digests" : "退订邮件日报"}</a></p></div>`;
  }

  private async assertFeedRateLimit(ip: string, scope: string): Promise<void> {
    const key = `distribution:feed:${createHash("sha256").update(ip || "unknown").digest("hex")}:${createHash("sha256").update(scope).digest("hex").slice(0, 12)}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 60);
    if (count > 60) throw new HttpException("订阅源请求过于频繁，请稍后再试。", HttpStatus.TOO_MANY_REQUESTS);
  }

  private toDeliveryResponse(delivery: { id: number; dayKey: string; status: SubscriptionEmailDeliveryStatus; attempts: number; itemCount: number; lastError: string | null; sentAt: Date | null; createdAt: Date }): SubscriptionEmailDeliveryResponse {
    return { id: delivery.id, dayKey: delivery.dayKey, status: delivery.status, attempts: delivery.attempts, itemCount: delivery.itemCount, lastError: delivery.lastError, sentAt: delivery.sentAt?.toISOString() ?? null, createdAt: delivery.createdAt.toISOString() };
  }

  private siteUrl(): string {
    return (process.env.PUBLIC_SITE_URL ?? `https://${process.env.SITE_DOMAIN ?? "5200918.xyz"}`).replace(/\/$/, "");
  }

  private absoluteUrl(path: string): string {
    return `${this.siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private xml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  }

  private chinaDateTimeParts(value: Date): { year: number; month: number; day: number; hour: number } {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(value);
    const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return { year: number("year"), month: number("month"), day: number("day"), hour: number("hour") };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error && error.message ? error.message : "未知错误";
  }
}
