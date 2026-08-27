import {
  ArticleCommentStatus,
  ArticleStatus,
  ArticleTopicStatus,
  ArticleVisibility,
  PortalVisibility,
} from "../src/generated/prisma/client";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { ReputationService } from "../src/reputation/reputation.service";
import { ArticlesService } from "../src/articles/articles.service";
import { ListArticleCommentsQueryDto, ListArticlesQueryDto } from "../src/articles/dto/article.dto";
import { SiteSettingsService } from "../src/site-settings/site-settings.service";

const user: AuthenticatedUser = {
  id: 7,
  username: "writer",
  nickname: "写作者",
  email: "writer@example.com",
  status: "active",
  isSuperAdmin: false,
  avatarUrl: null,
  profileBio: "",
  createdAt: new Date("2026-07-20T00:00:00.000Z"),
  appearance: {
    themeId: "sakura-mist",
    customAccent: "#db2777",
    customSurface: "#ffffff",
    customForeground: "#2b2530",
    customMuted: "#665867",
    cardAlpha: 52,
    glassBlur: 22,
    glassTint: "#fff3f6",
    glassTintAlpha: 72,
  },
  role: { code: "qi_refining", name: "练气", level: 10 },
};

function articleRecord(status: ArticleStatus = ArticleStatus.published) {
  return {
    id: 12,
    authorId: user.id,
    title: "服务器经验",
    slug: "server-notes-12345678",
    summary: "摘要",
    content: "正文",
    coverPath: null,
    category: "运维",
    tags: "服务器,经验",
    titleColor: "",
    visibility: ArticleVisibility.public,
    status,
    isPinned: false,
    pinOrder: 0,
    publishedAt: new Date("2026-07-20T00:00:00.000Z"),
    scheduledPublishAt: null,
    scheduledUnpublishAt: null,
    scheduleError: null,
    blockedReason: null,
    viewCount: 3,
    likeCount: 2,
    favoriteCount: 1,
    commentCount: 0,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    updatedAt: new Date("2026-07-21T00:00:00.000Z"),
    author: {
      id: user.id,
      nickname: user.nickname,
      username: user.username,
      avatarStoredName: null,
      isSuperAdmin: false,
      isAdministrator: false,
      role: user.role,
    },
    allowedRoles: [],
    images: [],
    likes: [{ userId: user.id }],
    favorites: [{ userId: user.id }],
    comments: [
      {
        authorId: 9,
        author: {
          id: 9,
          nickname: "回复者",
          username: "commenter",
          avatarStoredName: null,
          isSuperAdmin: false,
          role: { code: "qi_refining", name: "练气", level: 10 },
        },
      },
      {
        authorId: 9,
        author: {
          id: 9,
          nickname: "回复者",
          username: "commenter",
          avatarStoredName: null,
          isSuperAdmin: false,
          role: { code: "qi_refining", name: "练气", level: 10 },
        },
      },
      {
        authorId: 10,
        author: {
          id: 10,
          nickname: "另一位回复者",
          username: "commenter-2",
          avatarStoredName: null,
          isSuperAdmin: false,
          role: { code: "foundation_building", name: "筑基", level: 20 },
        },
      },
    ],
  };
}

function createPrismaMock() {
  return {
    article: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => articleRecord(ArticleStatus.deleted)),
      update: jest.fn(async () => articleRecord(ArticleStatus.draft)),
      delete: jest.fn(async () => articleRecord(ArticleStatus.deleted)),
      groupBy: jest.fn(async () => [
        { status: ArticleStatus.draft, _count: { _all: 2 } },
        { status: ArticleStatus.published, _count: { _all: 3 } },
        { status: ArticleStatus.deleted, _count: { _all: 1 } },
      ]),
    },
    userNotification: { create: jest.fn(async () => ({ id: 1 })) },
    articleFavorite: {
      count: jest.fn(async (_args: unknown) => {
        void _args;
        return 1;
      }),
      findMany: jest.fn(async (_args: unknown) => {
        void _args;
        return [{ article: articleRecord() }];
      }),
    },
    articleLike: {
      count: jest.fn(async (_args: unknown) => {
        void _args;
        return 1;
      }),
      findMany: jest.fn(async (_args: unknown) => {
        void _args;
        return [{ article: articleRecord() }];
      }),
    },
    articleReadLater: {
      count: jest.fn(async () => 4),
      findMany: jest.fn(async (): Promise<unknown[]> => []),
      upsert: jest.fn(async () => ({ articleId: 12, userId: user.id })),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
    articleReadingHistory: {
      count: jest.fn(async () => 5),
      findMany: jest.fn(async (): Promise<unknown[]> => []),
      deleteMany: jest.fn(async () => ({ count: 1 })),
    },
  };
}

const siteSettingsService = {
  getArticlePublishPolicy: jest.fn(async () => ({
    defaultArticleVisibility: ArticleVisibility.public,
    articleImageMaxSizeMb: 10,
    commentsEnabled: true,
    reportsEnabled: true,
  })),
  getNotificationSettings: jest.fn(async () => ({
    notifyArticleLiked: true,
    notifyArticleFavorited: true,
    notifyArticleCommented: true,
    notifyCommentReplied: true,
    notifyAuthorSubscribed: true,
    notifySubscriptionPublished: true,
    notifyFriendRequest: true,
    notifyCommentReport: true,
    notifySystem: true,
    templates: {
      articleLiked: "{actor} 点赞了《{article}》。",
      articleFavorited: "{actor} 收藏了《{article}》。",
      articleCommented: "{actor} 评论了《{article}》。",
      commentReplied: "{actor} 回复了你在《{article}》中的评论。",
      authorSubscribed: "{actor} 订阅了你。",
      subscriptionPublished: "{author} 发布了《{article}》。",
      friendRequest: "{actor} 向你发送了好友申请。",
      commentReportHandled: "你对《{article}》中评论的举报已{result}。",
      commentAuthorModerated: "你在《{article}》中的评论已被{result}。",
    },
    templatesEn: {
      articleLiked: "{actor} liked {article}.",
      articleFavorited: "{actor} favorited {article}.",
      articleCommented: "{actor} commented on {article}.",
      commentReplied: "{actor} replied to your comment on {article}.",
      authorSubscribed: "{actor} subscribed to you.",
      subscriptionPublished: "{author} published {article}.",
      friendRequest: "{actor} sent you a friend request.",
      commentReportHandled: "Your report of a comment on {article} was {result}.",
      commentAuthorModerated: "Your comment on {article} was {result}.",
    },
  })),
  renderTemplate: jest.fn((template: string, variables: Record<string, string | number | null | undefined>) => {
    return Object.entries(variables).reduce((current, [key, value]) => {
      return current.replaceAll(`{${key}}`, String(value ?? ""));
    }, template);
  }),
  renderNotificationTemplate: jest.fn((settings: { templates: Record<string, string>; templatesEn: Record<string, string> }, name: string, variables: Record<string, string | number | null | undefined>, englishVariables = variables) => ({
    body: Object.entries(variables).reduce((current, [key, value]) => current.replaceAll(`{${key}}`, String(value ?? "")), settings.templates[name] ?? ""),
    bodyEn: Object.entries(englishVariables).reduce((current, [key, value]) => current.replaceAll(`{${key}}`, String(value ?? "")), settings.templatesEn[name] ?? ""),
  })),
};

const redisService = {
  get: jest.fn(async () => null),
  set: jest.fn(async () => undefined),
};

const reputationService = {
  awardArticleRead: jest.fn(async () => true),
  awardArticleComment: jest.fn(async () => true),
  awardArticlePublished: jest.fn(async () => true),
  awardArticleLiked: jest.fn(async () => true),
  transferResourcePoints: jest.fn(async () => undefined),
};

function createService(prisma: object) {
  return new ArticlesService(
    prisma as unknown as PrismaService,
    siteSettingsService as unknown as SiteSettingsService,
    redisService as unknown as RedisService,
    reputationService as unknown as ReputationService,
  );
}

function commentRecord(id: number, parentId: number | null, createdAt: string) {
  return {
    id,
    articleId: 12,
    parentId,
    body: `评论 ${id}`,
    status: ArticleCommentStatus.active,
    likeCount: 0,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    author: {
      id: 20 + id,
      nickname: `用户 ${id}`,
      username: `user-${id}`,
      avatarStoredName: null,
      isSuperAdmin: false,
      role: { code: "qi_refining", name: "练气", level: 10 },
    },
  };
}

describe("ArticlesService article center extensions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists favorites in interaction order and applies expanded search", async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    const query = Object.assign(new ListArticlesQueryDto(), {
      search: "写作者",
      page: 1,
      pageSize: 10,
    });

    const result = await service.listFavorites(query, user);

    expect(result.total).toBe(1);
    expect(result.items[0].favorited).toBe(true);
    expect(result.items[0].recentCommenters).toEqual([
      expect.objectContaining({ nickname: "回复者", username: "commenter" }),
      expect.objectContaining({ nickname: "另一位回复者", username: "commenter-2" }),
    ]);
    const args = prisma.articleFavorite.findMany.mock.calls[0][0] as {
      orderBy: Array<{ createdAt: string }>;
      where: { article: { AND: Array<{ OR: unknown[] }> } };
    };
    expect(args.orderBy).toEqual([{ createdAt: "desc" }]);
    expect(args.where.article.AND[0].OR).toEqual(expect.arrayContaining([
      { category: { contains: "写作者" } },
      { tags: { contains: "写作者" } },
      { author: { is: { nickname: { contains: "写作者" } } } },
    ]));
  });

  it("returns creation counts for every author status", async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    await expect(service.getMineSummary(user)).resolves.toEqual({
      total: 6,
      draft: 2,
      published: 3,
      unpublished: 0,
      blocked: 0,
      deleted: 1,
    });
  });

  it("aggregates creator interaction and resource income for the dashboard", async () => {
    const createdAt = new Date("2026-08-20T03:00:00.000Z");
    const availableAt = new Date("2026-08-23T03:00:00.000Z");
    const settledAt = new Date("2026-08-23T03:04:00.000Z");
    const prisma = {
      article: {
        aggregate: jest.fn(async () => ({ _sum: { viewCount: 31, likeCount: 9, commentCount: 6, favoriteCount: 4 } })),
      },
      articleResourceExchange: {
        count: jest.fn(async () => 3),
        aggregate: jest.fn(async (input: { where: { sellerSettledAt: unknown } }) => (
          input.where.sellerSettledAt === null ? { _sum: { pointCost: 12 } } : { _sum: { pointCost: 8 } }
        )),
        findMany: jest.fn(async () => [{
          id: 8,
          pointCost: 8,
          createdAt,
          sellerAvailableAt: availableAt,
          sellerSettledAt: settledAt,
          article: { id: 12, title: "服务器经验", slug: "server-notes-12345678" },
        }]),
      },
    };
    const service = createService(prisma);

    await expect(service.getMineDashboard(user)).resolves.toEqual({
      views: 31,
      likes: 9,
      comments: 6,
      favorites: 4,
      resourceExchanges: 3,
      pendingPoints: 12,
      settledPoints: 8,
      recentResourceIncome: [{
        id: 8,
        article: { id: 12, title: "服务器经验", slug: "server-notes-12345678" },
        pointCost: 8,
        createdAt: createdAt.toISOString(),
        availableAt: availableAt.toISOString(),
        settledAt: settledAt.toISOString(),
      }],
    });
    expect(prisma.article.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ authorId: user.id, status: { not: ArticleStatus.deleted } }),
    }));
  });

  it("returns all article-center tab counts in one summary", async () => {
    const prisma = createPrismaMock();
    prisma.article.count
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(6)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(7);
    prisma.articleFavorite.count.mockResolvedValueOnce(2);
    prisma.articleLike.count.mockResolvedValueOnce(3);
    const service = createService(prisma);
    const adminUser = { ...user, isSuperAdmin: true };

    await expect(service.getCenterSummary(adminUser)).resolves.toEqual({
      discover: 5,
      subscriptions: 6,
      mine: 4,
      favorites: 2,
      liked: 3,
      readLater: 4,
      history: 5,
      manage: 7,
    });
  });

  it("lists account reading history with progress and last-read time", async () => {
    const prisma = createPrismaMock();
    const lastReadAt = new Date("2026-08-04T02:03:04.000Z");
    prisma.articleReadingHistory.count.mockResolvedValueOnce(1);
    prisma.articleReadingHistory.findMany.mockResolvedValueOnce([{
      progress: 68,
      lastReadAt,
      article: articleRecord(),
    }]);
    const service = createService(prisma);

    await expect(service.listReadingHistory(new ListArticlesQueryDto(), user)).resolves.toMatchObject({
      total: 1,
      items: [{ id: 12, readingProgress: 68, lastReadAt: lastReadAt.toISOString() }],
    });
    expect(prisma.articleReadingHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ lastReadAt: "desc" }],
    }));
  });

  it("keeps read-later separate from favorites", async () => {
    const prisma = createPrismaMock();
    prisma.article.findUnique.mockResolvedValueOnce(articleRecord());
    const service = createService(prisma);

    await expect(service.toggleReadLater(12, user, true)).resolves.toEqual({ readLater: true });
    expect(prisma.articleReadLater.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { articleId_userId: { articleId: 12, userId: user.id } },
    }));
    expect(prisma.articleFavorite.findMany).not.toHaveBeenCalled();
  });

  it("rechecks cached recommendations against current visibility", async () => {
    const prisma = createPrismaMock();
    (prisma.article.findMany as jest.Mock)
      .mockResolvedValueOnce([{ id: 12 }])
      .mockResolvedValueOnce([articleRecord()]);
    const service = new ArticlesService(
      prisma as unknown as PrismaService,
      siteSettingsService as unknown as SiteSettingsService,
      { get: jest.fn(async () => JSON.stringify([12, 13])), set: jest.fn() } as unknown as RedisService,
      reputationService as unknown as ReputationService,
    );
    const query = new ListArticlesQueryDto();
    query.sort = "recommended";

    await expect(service.listPublic(query)).resolves.toMatchObject({
      total: 1,
      items: [{ id: 12 }],
    });
    expect(prisma.article.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ AND: expect.any(Array) }),
      select: { id: true },
    }));
    expect(prisma.article.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ AND: expect.any(Array) }),
    }));
  });

  it("paginates comments by complete root threads", async () => {
    const comments = [
      commentRecord(1, null, "2026-07-20T00:00:01.000Z"),
      commentRecord(4, 1, "2026-07-20T00:00:02.000Z"),
      commentRecord(5, 4, "2026-07-20T00:00:03.000Z"),
      commentRecord(2, null, "2026-07-20T00:00:04.000Z"),
      commentRecord(3, null, "2026-07-20T00:00:05.000Z"),
      commentRecord(6, 3, "2026-07-20T00:00:06.000Z"),
    ];
    const prisma = {
      article: { findUnique: jest.fn(async () => articleRecord()) },
      articleComment: {
        findMany: jest.fn(async (args: { select: Record<string, unknown>; where?: { id?: { in: number[] } } }) => {
          if (!("body" in args.select)) {
            return comments.map(({ id, parentId, status }) => ({ id, parentId, status }));
          }
          const ids = args.where?.id?.in ?? comments.map((comment) => comment.id);
          return comments.filter((comment) => ids.includes(comment.id));
        }),
      },
      articleCommentLike: { findMany: jest.fn(async () => []) },
      articleCommentReport: { findMany: jest.fn(async () => []) },
    };
    const service = createService(prisma);

    const first = await service.listComments(
      "server-notes-12345678",
      user,
      Object.assign(new ListArticleCommentsQueryDto(), { pageSize: 2 }),
    );
    expect(first.items.map((comment) => comment.id)).toEqual([1, 4, 5, 2]);
    expect(first).toMatchObject({ hasMore: true, nextCursor: 2, totalThreads: 3 });

    const second = await service.listComments(
      "server-notes-12345678",
      user,
      Object.assign(new ListArticleCommentsQueryDto(), { cursor: 2, pageSize: 2 }),
    );
    expect(second.items.map((comment) => comment.id)).toEqual([3, 6]);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null, totalThreads: 3 });
  });

  it("includes the focused reply thread without breaking the first cursor page", async () => {
    const comments = [
      commentRecord(1, null, "2026-07-20T00:00:01.000Z"),
      commentRecord(2, null, "2026-07-20T00:00:02.000Z"),
      commentRecord(3, null, "2026-07-20T00:00:03.000Z"),
      commentRecord(6, 3, "2026-07-20T00:00:04.000Z"),
    ];
    const prisma = {
      article: { findUnique: jest.fn(async () => articleRecord()) },
      articleComment: {
        findMany: jest.fn(async (args: { select: Record<string, unknown>; where?: { id?: { in: number[] } } }) => {
          if (!("body" in args.select)) return comments.map(({ id, parentId, status }) => ({ id, parentId, status }));
          const ids = args.where?.id?.in ?? [];
          return comments.filter((comment) => ids.includes(comment.id));
        }),
      },
      articleCommentLike: { findMany: jest.fn(async () => []) },
      articleCommentReport: { findMany: jest.fn(async () => []) },
    };
    const service = createService(prisma);

    const result = await service.listComments(
      "server-notes-12345678",
      user,
      Object.assign(new ListArticleCommentsQueryDto(), { focusId: 6, pageSize: 1 }),
    );

    expect(result.items.map((comment) => comment.id)).toEqual([1, 3, 6]);
    expect(result).toMatchObject({ hasMore: true, nextCursor: 1, totalThreads: 3 });
  });

  it("aggregates unread article-like notifications and moves the latest actor to the front", async () => {
    const target = { ...articleRecord(), authorId: 19 };
    const transaction = {
      articleLike: { create: jest.fn(async () => ({ articleId: 12, userId: user.id })) },
      article: { update: jest.fn(async () => target) },
      userNotification: {
        findFirst: jest.fn(async () => ({ id: 31, aggregateCount: 2 })),
        delete: jest.fn(async () => ({ id: 31 })),
        create: jest.fn(async () => ({ id: 32 })),
      },
    };
    const prisma = {
      article: { findUnique: jest.fn(async () => target), findUniqueOrThrow: jest.fn(async () => ({ likeCount: 4, favoriteCount: 1 })) },
      articleLike: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createService(prisma);
    await expect(service.toggleLike(12, user, true)).resolves.toEqual({ liked: true, likeCount: 4, favoriteCount: 1 });
    expect(transaction.userNotification.delete).toHaveBeenCalledWith({ where: { id: 31 } });
    expect(transaction.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      userId: 19, actorId: user.id, type: "article_liked", channel: "interaction", aggregateCount: 3,
    }) }));
  });

  it("notifies readable subscribers only on the first publication", async () => {
    const draft = { ...articleRecord(ArticleStatus.draft), publishedAt: null };
    const published = { ...articleRecord(), publishedAt: new Date("2026-07-24T10:00:00.000Z") };
    const transaction = {
      article: { update: jest.fn(async () => published) },
      articleVersion: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 1 })),
        findMany: jest.fn(async () => []),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      userSubscription: { findMany: jest.fn(async () => [{ subscriberId: 21 }, { subscriberId: 22 }]) },
      userNotification: { createMany: jest.fn(async () => ({ count: 2 })) },
    };
    const prisma = {
      article: { findUnique: jest.fn(async () => draft) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createService(prisma);
    await service.publish(12, user);
    expect(transaction.userSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        authorId: user.id,
        notifyNewArticles: true,
      }),
    }));
    expect(transaction.userNotification.createMany).toHaveBeenCalledWith({ data: expect.arrayContaining([
      expect.objectContaining({ userId: 21, type: "subscription_published", channel: "subscription" }),
      expect.objectContaining({ userId: 22, type: "subscription_published", channel: "subscription" }),
    ]) });
  });

  it("shows collection and topic metadata only when the current viewer may open it", async () => {
    const associatedArticle = {
      ...articleRecord(),
      collectionItems: [
        { collection: { id: 1, ownerId: 99, name: "公开合集", visibility: ArticleVisibility.public } },
        { collection: { id: 2, ownerId: 99, name: "登录合集", visibility: ArticleVisibility.authenticated } },
        { collection: { id: 3, ownerId: user.id, name: "我的私有合集", visibility: ArticleVisibility.private } },
        { collection: { id: 4, ownerId: 99, name: "他人私有合集", visibility: ArticleVisibility.private } },
      ],
      topicItems: [
        { topic: { id: 11, title: "公开专题", slug: "public", visibility: PortalVisibility.public, status: ArticleTopicStatus.active, allowedRoles: [] } },
        { topic: { id: 12, title: "登录专题", slug: "signed-in", visibility: PortalVisibility.authenticated, status: ArticleTopicStatus.active, allowedRoles: [] } },
        { topic: { id: 13, title: "当前角色专题", slug: "role", visibility: PortalVisibility.role_restricted, status: ArticleTopicStatus.active, allowedRoles: [{ role: { code: user.role.code } }] } },
        { topic: { id: 14, title: "其他角色专题", slug: "other-role", visibility: PortalVisibility.role_restricted, status: ArticleTopicStatus.active, allowedRoles: [{ role: { code: "foundation_building" } }] } },
        { topic: { id: 15, title: "停用专题", slug: "disabled", visibility: PortalVisibility.public, status: ArticleTopicStatus.disabled, allowedRoles: [] } },
      ],
    };
    const prisma = {
      article: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [associatedArticle]),
      },
    };
    const service = createService(prisma);
    const query = Object.assign(new ListArticlesQueryDto(), { page: 1, pageSize: 12 });

    const visible = await service.listVisible(query, user);
    expect(visible.items[0]).toMatchObject({
      collections: [{ id: 1 }, { id: 2 }, { id: 3 }],
      topics: [{ id: 11 }, { id: 12 }, { id: 13 }],
    });

    const anonymous = await service.listPublic(query);
    expect(anonymous.items[0]).toMatchObject({
      collections: [{ id: 1 }],
      topics: [{ id: 11 }],
    });
  });

  it("restores deleted articles as unpinned drafts", async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    const restored = await service.restore(12, user);

    expect(restored.status).toBe("draft");
    expect(prisma.article.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 12 },
      data: expect.objectContaining({ status: ArticleStatus.draft, isPinned: false, pinOrder: 0 }),
    }));
  });

  it("permanently deletes only items already in the recycle bin", async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);

    await expect(service.permanentlyDelete(12, user)).resolves.toEqual({ success: true });
    expect(prisma.article.delete).toHaveBeenCalledWith({ where: { id: 12 } });
  });

  it("soft deletes an owned comment and recalculates the active comment count", async () => {
    const transaction = {
      articleComment: {
        update: jest.fn(async () => ({ articleId: 12 })),
        count: jest.fn(async () => 4),
      },
      article: { update: jest.fn(async () => ({ id: 12 })) },
    };
    const prisma = {
      articleComment: {
        findUnique: jest.fn(async () => ({ authorId: user.id, status: "active" })),
      },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    };
    const service = createService(prisma);

    await expect(service.deleteComment(44, user)).resolves.toEqual({ success: true });
    expect(transaction.articleComment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 44 },
      data: { status: "deleted" },
    }));
    expect(transaction.article.update).toHaveBeenCalledWith({
      where: { id: 12 },
      data: { commentCount: 4 },
    });
  });

  it("updates a report and creates the reporter notification in the same transaction", async () => {
    const transaction = {
      articleCommentReport: {
        findUnique: jest.fn(async () => ({
          commentId: 44,
          reporterId: 19,
          status: "pending",
          comment: { authorId: 23, body: "被举报评论", article: { title: "测试文章", slug: "test-article" } },
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      userNotification: { create: jest.fn(async () => ({ id: 7 })) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    };
    const service = createService(prisma);
    const actor = { ...user, isSuperAdmin: true };

    await expect(service.moderateCommentReport(6, actor, {
      status: "resolved",
      resolution: "已处理违规内容",
    })).resolves.toEqual({ success: true });

    expect(transaction.articleCommentReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 6, status: "pending" },
      data: expect.objectContaining({ status: "resolved", handledById: actor.id }),
    }));
    expect(transaction.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 19,
        actorId: null,
        type: "comment_report_resolved",
        commentReportId: 6,
        actionUrl: "/articles/test-article?commentId=44",
      }),
    }));
  });

  it("notifies the comment author when moderation blocks the reported comment", async () => {
    const transaction = {
      articleCommentReport: {
        findUnique: jest.fn(async () => ({
          commentId: 44,
          reporterId: 19,
          status: "pending",
          comment: { authorId: 23, body: "被举报评论", article: { title: "测试文章", slug: "test-article" } },
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      articleComment: {
        update: jest.fn(async () => ({ articleId: 12 })),
        count: jest.fn(async () => 4),
      },
      article: { update: jest.fn(async () => ({ id: 12 })) },
      userNotification: { create: jest.fn(async () => ({ id: 7 })) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    };
    const service = createService(prisma);
    const actor = { ...user, isSuperAdmin: true };

    await service.moderateCommentReport(6, actor, {
      status: "resolved",
      commentStatus: "blocked",
    });

    expect(transaction.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 23,
        actorId: null,
        type: "comment_author_moderated",
        commentReportId: 6,
      }),
    }));
  });

  it("does not create another notification for an already handled report", async () => {
    const transaction = {
      articleCommentReport: {
        findUnique: jest.fn(async () => ({
          commentId: 44,
          reporterId: 19,
          status: "resolved",
          comment: { authorId: 23, body: "被举报评论", article: { title: "测试文章", slug: "test-article" } },
        })),
      },
      userNotification: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    };
    const service = createService(prisma);
    const actor = { ...user, isSuperAdmin: true };

    await expect(service.moderateCommentReport(6, actor, {
      status: "resolved",
    })).rejects.toThrow("已经处理");
    expect(transaction.userNotification.create).not.toHaveBeenCalled();
  });

  it("validates and stores a future publication schedule", async () => {
    const publishAt = new Date("2099-01-01T08:00:00.000Z");
    const unpublishAt = new Date("2099-01-02T08:00:00.000Z");
    const prisma = createPrismaMock();
    const draft = { ...articleRecord(ArticleStatus.draft), publishedAt: null };
    (prisma.article.findUnique as jest.Mock).mockResolvedValueOnce(draft);
    (prisma.article.update as jest.Mock).mockResolvedValueOnce({ ...draft, scheduledPublishAt: publishAt, scheduledUnpublishAt: unpublishAt });
    const service = createService(prisma);

    await expect(service.schedule(12, user, {
      publishAt: publishAt.toISOString(),
      unpublishAt: unpublishAt.toISOString(),
    })).resolves.toMatchObject({
      schedule: { publishAt: publishAt.toISOString(), unpublishAt: unpublishAt.toISOString(), error: null },
    });
    expect(prisma.article.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 12 },
      data: { scheduledPublishAt: publishAt, scheduledUnpublishAt: unpublishAt, scheduleError: null },
    }));
    expect(prisma.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "system", actionUrl: "/articles/mine" }),
    }));

    const invalidPrisma = createPrismaMock();
    (invalidPrisma.article.findUnique as jest.Mock).mockResolvedValueOnce(draft);
    const invalidService = createService(invalidPrisma);
    await expect(invalidService.schedule(12, user, {
      publishAt: unpublishAt.toISOString(),
      unpublishAt: publishAt.toISOString(),
    })).rejects.toThrow("下线时间必须晚于发布时间");
    expect(invalidPrisma.article.update).not.toHaveBeenCalled();
  });

  it("keeps article templates scoped to their author", async () => {
    const createdAt = new Date("2026-08-27T00:00:00.000Z");
    const template = {
      id: 3,
      authorId: user.id,
      name: "运维模板",
      summary: "",
      content: "# 记录",
      category: "运维",
      tags: "服务器,经验",
      titleColor: "",
      visibility: ArticleVisibility.public,
      roleCodes: "",
      createdAt,
      updatedAt: createdAt,
    };
    const prisma = {
      articleTemplate: {
        findMany: jest.fn(async () => [template]),
        create: jest.fn(async () => template),
        findFirst: jest.fn(async (input: { where: { id: number; authorId: number } }) => input.where.authorId === user.id ? template : null),
        update: jest.fn(async () => template),
      },
      role: { findMany: jest.fn(async () => []) },
    };
    const service = createService(prisma);

    await expect(service.listTemplates(user)).resolves.toMatchObject({ items: [{ id: 3, name: "运维模板", tags: ["服务器", "经验"] }] });
    await expect(service.createTemplate(user, {
      name: "运维模板",
      content: "# 记录",
      category: "运维",
      tags: "服务器,经验",
    })).resolves.toMatchObject({ id: 3 });
    expect(prisma.articleTemplate.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ authorId: user.id, tags: "服务器,经验" }) }));
    await expect(service.updateTemplate(3, { ...user, id: 99 }, {
      name: "运维模板",
      content: "# 记录",
    })).rejects.toThrow("文章模板不存在");
  });

  it("publishes scheduled articles once and records the localized notification type", async () => {
    const scheduledAt = new Date("2026-08-26T00:00:00.000Z");
    const candidate = { ...articleRecord(ArticleStatus.draft), publishedAt: null, scheduledPublishAt: scheduledAt };
    const published = { ...candidate, status: ArticleStatus.published, publishedAt: scheduledAt, scheduledPublishAt: null };
    const transaction = {
      article: { update: jest.fn(async () => published) },
      articleVersion: { findFirst: jest.fn(async () => null), create: jest.fn(async () => ({})) },
      userSubscription: { findMany: jest.fn(async () => []) },
      userNotification: { create: jest.fn(async () => ({})) },
    };
    const prisma = {
      article: {
        findMany: jest.fn(async (input: { where: { scheduledPublishAt?: unknown } }) => input.where.scheduledPublishAt ? [candidate] : []),
        findUnique: jest.fn(async () => candidate),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      user: { findUnique: jest.fn(async () => ({ id: user.id, isSuperAdmin: false, isAdministrator: false })) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createService(prisma);

    await service.processArticleLifecycle();

    expect(prisma.article.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 12, status: { in: [ArticleStatus.draft, ArticleStatus.unpublished] }, scheduledPublishAt: { lte: expect.any(Date) } },
    }));
    expect(transaction.article.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ArticleStatus.published, publicationCount: { increment: 1 } }),
    }));
    expect(transaction.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "article_scheduled_publish", bodyEn: expect.stringContaining("published on schedule") }),
    }));

    (prisma.article.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
    await service.processArticleLifecycle();
    expect(transaction.article.update).toHaveBeenCalledTimes(1);
  });

  it("records a failure and notifies the author when scheduled publication is rejected", async () => {
    const scheduledAt = new Date("2026-08-26T00:00:00.000Z");
    const candidate = { ...articleRecord(ArticleStatus.draft), publishedAt: null, scheduledPublishAt: scheduledAt };
    const prisma = {
      article: {
        findMany: jest.fn(async (input: { where: { scheduledPublishAt?: unknown } }) => input.where.scheduledPublishAt ? [candidate] : []),
        findUnique: jest.fn(async () => candidate),
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => candidate),
      },
      user: { findUnique: jest.fn(async () => ({ id: user.id, isSuperAdmin: false, isAdministrator: false })) },
      userNotification: { create: jest.fn(async () => ({})) },
    };
    const moderation = { enforce: jest.fn(async () => { throw new Error("命中敏感词规则"); }), recordAccepted: jest.fn() };
    const service = new ArticlesService(
      prisma as unknown as PrismaService,
      siteSettingsService as unknown as SiteSettingsService,
      redisService as unknown as RedisService,
      reputationService as unknown as ReputationService,
      moderation,
    );

    await service.processArticleLifecycle();

    expect(prisma.article.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { scheduleError: "命中敏感词规则" } });
    expect(prisma.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: "article_scheduled_publish_failed", bodyEn: expect.stringContaining("failed") }),
    }));
  });
});
