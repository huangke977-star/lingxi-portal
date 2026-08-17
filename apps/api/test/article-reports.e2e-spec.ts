import { ArticleCommentReportStatus, ArticleStatus, ArticleVisibility } from "../src/generated/prisma/client";
import { ArticlesService } from "../src/articles/articles.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { ReputationService } from "../src/reputation/reputation.service";
import { SiteSettingsService } from "../src/site-settings/site-settings.service";

const reporter = {
  id: 7,
  nickname: "举报人",
  username: "reporter",
  isSuperAdmin: false,
  role: { code: "qi_refining", name: "练气", level: 10 },
} as AuthenticatedUser;

const administrator = {
  id: 99,
  nickname: "管理员",
  username: "admin",
  isSuperAdmin: false,
  role: { code: "administrator", name: "管理员", level: 90 },
} as AuthenticatedUser;

const article = {
  id: 12,
  authorId: 8,
  title: "待处理文章",
  slug: "reported-article",
  status: ArticleStatus.published,
  visibility: ArticleVisibility.public,
  allowedRoles: [],
};

function createService(prisma: object, siteSettings: object = {}, reputation: object = { awardArticleReportAccepted: jest.fn(async () => true) }) {
  return new ArticlesService(
    prisma as PrismaService,
    siteSettings as SiteSettingsService,
    {} as RedisService,
    reputation as ReputationService,
  );
}

describe("article reports", () => {
  it("creates a report and notifies active administrators", async () => {
    const createMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      article: { findUnique: jest.fn(async () => article) },
      articleReport: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({ id: 31, status: ArticleCommentReportStatus.pending })),
      },
      user: { findMany: jest.fn(async () => [{ id: 99 }]) },
      userNotification: { createMany },
    };
    const siteSettings = {
      getArticlePublishPolicy: jest.fn(async () => ({ reportsEnabled: true })),
      getNotificationSettings: jest.fn(async () => ({ notifyCommentReport: true })),
    };
    const service = createService(prisma, siteSettings);

    await expect(service.reportArticle(12, reporter, { reason: "spam", detail: "广告内容" }))
      .resolves.toEqual({ reported: true });
    expect(prisma.articleReport.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ articleId: 12, reporterId: reporter.id, reason: "spam", detail: "广告内容" }),
    }));
    expect(createMany).toHaveBeenCalledWith({
      data: [{
        userId: 99,
        actorId: reporter.id,
        type: "article_report_received",
        channel: "system",
        title: "收到文章举报",
        body: expect.stringContaining("举报了《待处理文章》"),
        actionUrl: "/admin/articles?tab=articles&report=31",
        articleId: 12,
        articleReportId: 31,
      }],
    });
  });

  it.each([
    ["rejected", undefined, false, ArticleCommentReportStatus.rejected],
    ["resolved", undefined, false, ArticleCommentReportStatus.resolved],
    ["resolved", "blocked", true, ArticleCommentReportStatus.resolved],
    ["resolved", "deleted", true, ArticleCommentReportStatus.resolved],
  ] as const)("handles %s report action with the expected article effect", async (status, articleStatus, changesArticle, expectedStatus) => {
    const updateArticle = jest.fn(async () => ({ ...article, status: articleStatus ?? ArticleStatus.published }));
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const createNotification = jest.fn(async () => ({ id: 1 }));
    const transaction = {
      articleReport: {
        findUnique: jest.fn(async () => ({
          articleId: article.id,
          reporterId: reporter.id,
          status: ArticleCommentReportStatus.pending,
          article: { authorId: article.authorId, title: article.title, slug: article.slug, status: article.status },
        })),
        updateMany,
        count: jest.fn(async () => 1),
      },
      article: { update: updateArticle },
      userNotification: { create: createNotification },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: object) => Promise<void>) => callback(transaction)),
    };
    const siteSettings = {
      getNotificationSettings: jest.fn(async () => ({ notifyCommentReport: true })),
    };
    const service = createService(prisma, siteSettings);

    await expect(service.moderateArticleReport(article.id, administrator, {
      status,
      articleStatus,
    })).resolves.toEqual({ success: true });

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: article.id, status: ArticleCommentReportStatus.pending },
      data: expect.objectContaining({ status: expectedStatus, handledById: administrator.id }),
    });
    expect(updateArticle).toHaveBeenCalledTimes(changesArticle ? 1 : 0);
    if (changesArticle) {
      expect(updateArticle).toHaveBeenCalledWith({
        where: { id: article.id },
        data: expect.objectContaining({ status: articleStatus }),
      });
    }
  });

  it("creates a publish restriction after the third valid report in 30 days", async () => {
    const restrictionCreate = jest.fn(async () => ({ id: 77 }));
    const createNotification = jest.fn(async () => ({ id: 1 }));
    const transaction = {
      articleReport: {
        findUnique: jest.fn(async () => ({
          articleId: article.id,
          reporterId: reporter.id,
          status: ArticleCommentReportStatus.pending,
          article: { authorId: article.authorId, title: article.title, slug: article.slug, status: article.status },
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        count: jest.fn(async () => 3),
      },
      article: { update: jest.fn() },
      articlePublishRestriction: {
        findFirst: jest.fn(async () => null),
        create: restrictionCreate,
      },
      userNotification: { create: createNotification },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: object) => Promise<void>) => callback(transaction)),
    };
    const service = createService(prisma, { getNotificationSettings: jest.fn(async () => ({ notifyCommentReport: true })) });

    await service.moderateArticleReport(article.id, administrator, { status: "resolved", resolution: "确认违规" });

    expect(restrictionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: article.authorId, sourceReportId: article.id, endsAt: expect.any(Date) }),
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: article.authorId, type: "article_publish_restricted" }),
    }));
  });

  it("lists only reports submitted by the current user", async () => {
    const findMany = jest.fn(async () => [{
      id: 31,
      article: { id: article.id, title: article.title, slug: article.slug },
      reporter: { id: reporter.id, nickname: reporter.nickname, username: reporter.username, avatarStoredName: null, isSuperAdmin: false, role: { code: "qi_refining", name: "练气", level: 10 } },
      reason: "spam",
      detail: null,
      status: ArticleCommentReportStatus.pending,
      resolution: null,
      createdAt: new Date("2026-08-17T01:00:00.000Z"),
      handledAt: null,
    }]);
    const service = createService({ articleReport: { findMany } });

    await expect(service.listMyArticleReports(reporter)).resolves.toMatchObject({ items: [{ id: 31, article: { id: article.id } }] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { reporterId: reporter.id } }));
  });
});
