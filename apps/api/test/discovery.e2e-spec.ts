import {
  ArticleStatus,
  ArticleTopicStatus,
  ArticleVisibility,
  PortalVisibility,
} from "../src/generated/prisma/client";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { DiscoveryService } from "../src/discovery/discovery.service";
import { PrismaService } from "../src/prisma/prisma.service";

const user: AuthenticatedUser = {
  id: 7,
  username: "reader",
  nickname: "读者",
  email: "reader@example.com",
  status: "active",
  isSuperAdmin: false,
  avatarUrl: null,
  profileBio: "",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
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
  role: { code: "foundation_building", name: "筑基", level: 20 },
};

const author = {
  id: 8,
  username: "writer",
  nickname: "写作者",
  avatarStoredName: null,
  isSuperAdmin: false,
  role: { code: "qi_refining", name: "练气", level: 10 },
};

function article(id: number, readAt: Date | null = null) {
  return {
    id,
    authorId: author.id,
    title: `文章 ${id}`,
    slug: `article-${id}`,
    category: "随笔",
    tags: "测试,发现",
    titleColor: "",
    coverPath: null,
    visibility: ArticleVisibility.public,
    status: ArticleStatus.published,
    viewCount: id * 10,
    likeCount: id,
    favoriteCount: id,
    commentCount: id,
    publishedAt: new Date(`2026-08-0${id}T08:00:00.000Z`),
    author,
    allowedRoles: [],
    collectionItems: [],
    topicItems: [],
    subscriptionFeedReads: readAt ? [{ readAt }] : [],
  };
}

function collection(items = [article(1), article(2)]) {
  return {
    id: 31,
    ownerId: user.id,
    name: "服务器手记",
    description: "合集说明",
    visibility: ArticleVisibility.public,
    sortOrder: 0,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    owner: { ...author, id: user.id, username: user.username, nickname: user.nickname },
    items: items.map((item, sortOrder) => ({
      article: item,
      articleId: item.id,
      collectionId: 31,
      sortOrder,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    })),
  };
}

function createService(prisma: object) {
  return new DiscoveryService(prisma as unknown as PrismaService);
}

describe("DiscoveryService", () => {
  it("keeps unread subscription items before read items across the requested page", async () => {
    const prisma = {
      article: {
        count: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(2),
        findMany: jest.fn()
          .mockResolvedValueOnce([article(2), article(1)])
          .mockResolvedValueOnce([article(3, new Date("2026-08-05T00:00:00.000Z"))]),
      },
    };

    const result = await createService(prisma).listSubscriptionFeed(user, {
      page: 1,
      pageSize: 3,
      sort: "unread",
    });

    expect(result.unread).toBe(2);
    expect(result.items.map((item) => [item.article.id, Boolean(item.readAt)])).toEqual([
      [2, false],
      [1, false],
      [3, true],
    ]);
    expect(prisma.article.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      skip: 0,
      take: 2,
      where: expect.objectContaining({
        AND: expect.arrayContaining([{ subscriptionFeedReads: { none: { userId: user.id } } }]),
      }),
    }));
  });

  it("requires collection ordering to contain every current article exactly once", async () => {
    const record = collection();
    const prisma = {
      articleCollection: { findFirst: jest.fn(async () => record) },
      articleCollectionItem: {
        findMany: jest.fn(async () => [{ articleId: 1 }, { articleId: 2 }]),
        update: jest.fn(async () => ({})),
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = createService(prisma);

    await expect(service.reorderCollectionArticles(user, 31, { ids: [2, 1] }))
      .resolves.toMatchObject({ id: 31, articles: [{ id: 1 }, { id: 2 }] });
    expect(prisma.articleCollectionItem.update).toHaveBeenNthCalledWith(1, {
      where: { collectionId_articleId: { collectionId: 31, articleId: 2 } },
      data: { sortOrder: 0 },
    });

    await expect(service.reorderCollectionArticles(user, 31, { ids: [1] }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it("persists per-user feed reads so the state is shared by every device", async () => {
    const readAt = new Date("2026-08-10T08:00:00.000Z");
    const prisma = {
      article: {
        findFirst: jest.fn(async () => ({ id: 2 })),
        findMany: jest.fn(async () => [{ id: 1 }, { id: 2 }]),
      },
      subscriptionFeedRead: {
        upsert: jest.fn(async () => ({ userId: user.id, articleId: 2, readAt })),
        createMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const service = createService(prisma);

    await expect(service.markSubscriptionFeedRead(user, 2)).resolves.toEqual({
      articleId: 2,
      readAt: readAt.toISOString(),
    });
    expect(prisma.subscriptionFeedRead.upsert).toHaveBeenCalledWith({
      where: { userId_articleId: { userId: user.id, articleId: 2 } },
      create: { userId: user.id, articleId: 2 },
      update: { readAt: expect.any(Date) },
    });

    await service.markAllSubscriptionFeedRead(user);
    expect(prisma.subscriptionFeedRead.createMany).toHaveBeenCalledWith({
      data: [
        { userId: user.id, articleId: 1 },
        { userId: user.id, articleId: 2 },
      ],
      skipDuplicates: true,
    });
  });

  it("adds the viewer role restriction to visible topic queries and blocks non-admin management", async () => {
    const prisma = {
      articleTopic: {
        count: jest.fn(async () => 0),
        findMany: jest.fn(async () => []),
      },
    };
    const service = createService(prisma);

    await service.listTopics({ page: 1, pageSize: 12 }, user);
    expect(prisma.articleTopic.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        status: ArticleTopicStatus.active,
        OR: expect.arrayContaining([{
          visibility: PortalVisibility.role_restricted,
          allowedRoles: { some: { role: { code: user.role.code } } },
        }]),
      }),
    });
    await expect(service.listAdminTopics(user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("deduplicates profile visits by hashed visitor and day without storing raw request data", async () => {
    const profileSettings = {
      userId: author.id,
      showBio: true,
      showJoinedAt: true,
      showStats: true,
      showFollowingCount: true,
      showPinnedContent: true,
      pinnedArticleId: null,
      pinnedCollectionId: null,
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: author.id, status: "active", profileSettings })) },
      profileVisit: {
        upsert: jest.fn(async (_args: unknown) => {
          void _args;
          return {};
        }),
        count: jest.fn(async () => 1),
      },
      articleCollection: { findMany: jest.fn(async () => []) },
    };
    const service = createService(prisma);
    const visitorKey = service.createVisitorKey("Mobile Safari", "203.0.113.10");

    await service.getProfileShowcase(author.username, user, visitorKey);
    await service.getProfileShowcase(author.username, user, visitorKey);

    expect(visitorKey).toMatch(/^[a-f0-9]{64}$/);
    expect(visitorKey).not.toContain("203.0.113.10");
    const first = prisma.profileVisit.upsert.mock.calls[0]?.[0] as {
      where: { profileUserId_visitorKey_visitedOn: object };
      create: Record<string, unknown>;
    };
    const second = prisma.profileVisit.upsert.mock.calls[1]?.[0] as {
      where: { profileUserId_visitorKey_visitedOn: object };
      create: Record<string, unknown>;
    };
    expect(first.where.profileUserId_visitorKey_visitedOn)
      .toEqual(second.where.profileUserId_visitorKey_visitedOn);
    expect(first.create).toEqual(expect.objectContaining({
      profileUserId: author.id,
      visitorKey,
      visitedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
    expect(first.create).not.toHaveProperty("ip");
    expect(first.create).not.toHaveProperty("userAgent");
  });

  it("does not expose visit totals when profile statistics are private", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({
          id: author.id,
          status: "active",
          profileSettings: {
            userId: author.id,
            showBio: false,
            showJoinedAt: false,
            showStats: false,
            showFollowingCount: false,
            showPinnedContent: false,
            pinnedArticleId: null,
            pinnedCollectionId: null,
            updatedAt: new Date("2026-08-01T00:00:00.000Z"),
          },
        })),
      },
      profileVisit: {
        upsert: jest.fn(async (_args: unknown) => {
          void _args;
          return {};
        }),
        count: jest.fn(async () => 99),
      },
      articleCollection: { findMany: jest.fn(async () => []) },
    };

    const result = await createService(prisma).getProfileShowcase(
      author.username,
      user,
      "0".repeat(64),
    );

    expect(result.visitCount).toBeNull();
    expect(result.pinnedArticle).toBeNull();
    expect(result.pinnedCollection).toBeNull();
    expect(prisma.profileVisit.count).not.toHaveBeenCalled();
  });
});
