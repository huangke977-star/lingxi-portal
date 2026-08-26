import {
  ArticleStatus,
  ArticleTopicStatus,
  ArticleVisibility,
  PortalVisibility,
} from "../src/generated/prisma/client";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    coverPath: null,
    visibility: ArticleVisibility.public,
    sortOrder: 0,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    owner: { ...author, id: user.id, username: user.username, nickname: user.nickname },
    _count: { subscribers: 3 },
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
  it("shows active visible topics during first-run onboarding and persists the selected subscriptions", async () => {
    const upsertSubscription = jest.fn(async () => ({}));
    const upsertPreference = jest.fn(async () => ({}));
    const transaction = {
      articleTopicSubscription: { upsert: upsertSubscription },
      userGrowthPreference: { upsert: upsertPreference },
    };
    const prisma = {
      userGrowthPreference: { findUnique: jest.fn(async () => null) },
      articleTopic: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: 19, title: "运维", slug: "operations", description: "", coverPath: null, _count: { items: 4, subscribers: 2 } }])
          .mockResolvedValueOnce([{ id: 19 }]),
      },
      articleTopicSubscription: {
        findMany: jest.fn(async () => []),
      },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createService(prisma);

    await expect(service.getOnboarding(user)).resolves.toMatchObject({
      completed: false,
      topics: [{ id: 19, title: "运维", articleCount: 4, subscriberCount: 2, subscribed: false }],
    });
    await expect(service.completeOnboarding(user, { topicIds: [19] })).resolves.toEqual({ completed: true, topicIds: [19] });
    expect(upsertSubscription).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_topicId: { userId: user.id, topicId: 19 } },
    }));
    expect(upsertPreference).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: user.id },
      update: { onboardingCompletedAt: expect.any(Date) },
    }));
  });

  it("lists only visible point-resource articles with their resource exchange count", async () => {
    const resource = {
      ...article(1),
      content: "公开内容\n:::resource{points=5}\n受保护内容\n:::",
      isPointResource: true,
      pointCost: 5,
      _count: { resourceExchanges: 3 },
    };
    const prisma = {
      article: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [resource]),
      },
    };

    await expect(createService(prisma).listResourceCatalog({ page: 1, pageSize: 12, q: "", sort: "latest" }, user)).resolves.toMatchObject({
      total: 1,
      items: [{ minimumPointCost: 5, blockCount: 1, exchangeCount: 3, article: { id: resource.id } }],
    });
    expect(prisma.article.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([{ isPointResource: true }]) }),
    }));
  });

  it("creates at most one readable subscription digest per user and China date", async () => {
    const createMany = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      userSubscription: {
        findMany: jest.fn(async () => [{ subscriberId: user.id, authorId: author.id, subscriber: { role: user.role } }]),
      },
      article: {
        findMany: jest.fn(async () => [{ id: 88, authorId: author.id, title: "日报文章", slug: "digest-article", visibility: ArticleVisibility.public, allowedRoles: [] }]),
      },
      userNotificationChannelState: { findMany: jest.fn(async () => []) },
      userNotification: { createMany },
    };
    const service = createService(prisma);
    const internal = service as unknown as {
      chinaDateTimeParts: (value: Date) => { year: number; month: number; day: number; hour: number };
      dispatchSubscriptionDigests: () => Promise<void>;
    };
    internal.chinaDateTimeParts = () => ({ year: 2026, month: 8, day: 26, hour: 9 });

    await internal.dispatchSubscriptionDigests();
    expect(createMany).toHaveBeenCalledWith(expect.objectContaining({
      skipDuplicates: true,
      data: [expect.objectContaining({
        userId: user.id,
        dedupeKey: "subscription-digest:2026-08-26:7",
        actionUrl: "/articles/subscriptions",
      })],
    }));
  });

  it("lists the current user's visible topic and collection subscriptions", async () => {
    const subscribedAt = new Date("2026-08-12T09:30:00.000Z");
    const prisma = {
      articleTopicSubscription: {
        findMany: jest.fn(async () => [{
          createdAt: subscribedAt,
          topic: {
            id: 11,
            title: "运维专题",
            slug: "operations",
            description: "专题说明",
            coverPath: null,
            _count: { items: 4, subscribers: 6 },
          },
        }]),
      },
      articleCollectionSubscription: {
        findMany: jest.fn(async () => [{
          createdAt: subscribedAt,
          collection: {
            id: 31,
            name: "服务器手记",
            description: "合集说明",
            owner: author,
            _count: { items: 2, subscribers: 3 },
          },
        }]),
      },
    };

    await expect(createService(prisma).listContentSubscriptions(user)).resolves.toEqual({
      topics: [{
        id: 11,
        title: "运维专题",
        slug: "operations",
        description: "专题说明",
        coverPath: null,
        articleCount: 4,
        subscriberCount: 6,
        subscribedAt: subscribedAt.toISOString(),
      }],
      collections: [{
        id: 31,
        name: "服务器手记",
        description: "合集说明",
        owner: expect.objectContaining({ id: author.id, username: author.username }),
        articleCount: 2,
        subscriberCount: 3,
        subscribedAt: subscribedAt.toISOString(),
      }],
    });
    expect(prisma.articleTopicSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: user.id, topic: { is: expect.any(Object) } }),
    }));
    expect(prisma.articleCollectionSubscription.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: user.id, collection: { is: expect.any(Object) } }),
    }));
  });

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
    expect(prisma.article.count).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ author: expect.any(Object) }),
              expect.objectContaining({ collectionItems: expect.any(Object) }),
              expect.objectContaining({ topicItems: expect.any(Object) }),
            ]),
          }),
        ]),
      }),
    }));
  });

  it("recommends only unjoined active groups and unsubscribed visible discovery content", async () => {
    const prisma = {
      articleTopic: { findMany: jest.fn(async () => []) },
      articleCollection: { findMany: jest.fn(async () => []) },
      chatGroup: { findMany: jest.fn(async () => []) },
    };

    await expect(createService(prisma).listRecommendations(user)).resolves.toEqual({
      topics: [],
      collections: [],
      groups: [],
    });
    expect(prisma.articleTopic.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ subscribers: { none: { userId: user.id } } }),
    }));
    expect(prisma.articleCollection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([{ subscribers: { none: { userId: user.id } } }]),
      }),
    }));
    expect(prisma.chatGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        members: {
          none: {
            userId: user.id,
            status: { in: ["active", "blocked"] },
          },
        },
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

  it("creates a collection and its selected articles in one ordered transaction", async () => {
    const created = collection([article(2), article(1)]);
    const transaction = {
      article: { count: jest.fn(async () => 2) },
      articleCollection: { create: jest.fn(async () => created) },
    };
    const prisma = {
      ...transaction,
      $transaction: jest.fn(async (callback: (value: unknown) => Promise<unknown>) => callback(transaction)),
    };

    await expect(createService(prisma).createCollection(user, {
      name: "服务器手记",
      visibility: "public",
      articleIds: [2, 1],
    })).resolves.toMatchObject({ id: created.id, articles: [{ id: 2 }, { id: 1 }] });
    expect(prisma.article.count).toHaveBeenCalledWith({
      where: {
        id: { in: [2, 1] },
        authorId: user.id,
        status: { not: ArticleStatus.deleted },
      },
    });
    expect(prisma.articleCollection.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        items: { create: [{ articleId: 2, sortOrder: 0 }, { articleId: 1, sortOrder: 1 }] },
      }),
    }));
  });

  it("rejects the entire collection creation when a selected article is invalid", async () => {
    const transaction = {
      article: { count: jest.fn(async () => 1) },
      articleCollection: { create: jest.fn() },
    };
    const prisma = {
      ...transaction,
      $transaction: jest.fn(async (callback: (value: unknown) => Promise<unknown>) => callback(transaction)),
    };

    await expect(createService(prisma).createCollection(user, {
      name: "无效合集",
      articleIds: [1, 2],
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.articleCollection.create).not.toHaveBeenCalled();
  });

  it("creates a topic and its selected articles in one ordered transaction", async () => {
    const admin = { ...user, isSuperAdmin: true };
    const created = {
      id: 11,
      title: "运维专题",
      slug: "operations",
      description: "专题说明",
      coverPath: null,
      visibility: PortalVisibility.public,
      status: ArticleTopicStatus.active,
      sortOrder: 0,
      allowedRoles: [],
      items: [article(2), article(1)].map((item, sortOrder) => ({
        article: item,
        articleId: item.id,
        topicId: 11,
        sortOrder,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
      })),
      _count: { subscribers: 0 },
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    };
    const transaction = {
      article: { count: jest.fn(async () => 2) },
      articleTopic: {
        create: jest.fn(async () => created),
      },
    };
    const prisma = {
      ...transaction,
      articleTopic: {
        ...transaction.articleTopic,
        findFirst: jest.fn(async () => null),
      },
      $transaction: jest.fn(async (callback: (value: unknown) => Promise<unknown>) => callback(transaction)),
    };

    await expect(createService(prisma).createTopic(admin, {
      title: "运维专题",
      articleIds: [2, 1],
    })).resolves.toMatchObject({ id: created.id, articles: [{ id: 2 }, { id: 1 }] });
    expect(prisma.articleTopic.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        items: { create: [{ articleId: 2, sortOrder: 0 }, { articleId: 1, sortOrder: 1 }] },
      }),
    }));
  });

  it("searches only collections visible to the current viewer", async () => {
    const prisma = {
      articleCollection: {
        count: jest.fn(async () => 1),
        findMany: jest.fn(async () => [collection()]),
      },
      articleCollectionSubscription: {
        findMany: jest.fn(async () => []),
      },
    };

    const result = await createService(prisma).listCollections({
      q: "服务器",
      page: 1,
      pageSize: 12,
    }, user);

    expect(result.total).toBe(1);
    expect(prisma.articleCollection.count).toHaveBeenCalledWith({
      where: {
        AND: [
          expect.objectContaining({
            OR: expect.arrayContaining([
              { visibility: ArticleVisibility.public },
              { visibility: ArticleVisibility.authenticated },
              { visibility: ArticleVisibility.private, ownerId: user.id },
            ]),
          }),
          expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: "服务器" } },
              { description: { contains: "服务器" } },
            ]),
          }),
        ],
      },
    });
  });

  it("rejects a topic cover when its extension and bytes do not describe a supported image", async () => {
    const admin = { ...user, isSuperAdmin: true };
    const prisma = {
      articleTopic: {
        findUnique: jest.fn(async () => ({ id: 9, coverStoredName: null })),
      },
    };

    await expect(createService(prisma).uploadTopicCover(admin, 9, {
      buffer: Buffer.from("not-an-image"),
      mimetype: "image/png",
      originalname: "cover.png",
      size: 12,
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("writes a managed topic cover and physically removes the previous file", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "hlovet-topic-cover-"));
    const previousUploadRoot = process.env.ARTICLE_UPLOAD_DIR;
    process.env.ARTICLE_UPLOAD_DIR = uploadRoot;
    const coverDirectory = join(uploadRoot, "topic-covers");
    const previousStoredName = "topic-00000000-0000-4000-8000-000000000001.webp";
    await mkdir(coverDirectory, { recursive: true });
    await writeFile(join(coverDirectory, previousStoredName), Buffer.from("old-cover"));
    const admin = { ...user, isSuperAdmin: true };
    let updatedData: Record<string, unknown> = {};
    const prisma = {
      articleTopic: {
        findUnique: jest.fn(async (args: { include?: unknown }) => args.include ? {
          id: 9,
          title: "封面测试",
          slug: "cover-test",
          description: "",
          coverPath: updatedData.coverPath,
          visibility: PortalVisibility.public,
          status: ArticleTopicStatus.active,
          sortOrder: 0,
          allowedRoles: [],
          items: [],
          _count: { subscribers: 0 },
          createdAt: new Date("2026-08-10T00:00:00.000Z"),
          updatedAt: new Date("2026-08-10T00:00:00.000Z"),
        } : { id: 9, coverStoredName: previousStoredName }),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updatedData = data;
          return {};
        }),
      },
    };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    try {
      const result = await createService(prisma).uploadTopicCover(admin, 9, {
        buffer: png,
        mimetype: "image/png",
        originalname: "new-cover.png",
        size: png.length,
      });

      const storedName = String(updatedData.coverStoredName);
      expect(result.coverPath).toBe(`/discovery/topics/covers/${storedName}`);
      expect((await stat(join(coverDirectory, storedName))).size).toBe(png.length);
      await expect(stat(join(coverDirectory, previousStoredName))).rejects.toThrow();
    } finally {
      if (previousUploadRoot === undefined) delete process.env.ARTICLE_UPLOAD_DIR;
      else process.env.ARTICLE_UPLOAD_DIR = previousUploadRoot;
      await rm(uploadRoot, { recursive: true, force: true });
    }
  });

  it("writes a managed collection cover and physically removes the previous file", async () => {
    const uploadRoot = await mkdtemp(join(tmpdir(), "hlovet-collection-cover-"));
    const previousUploadRoot = process.env.ARTICLE_UPLOAD_DIR;
    process.env.ARTICLE_UPLOAD_DIR = uploadRoot;
    const coverDirectory = join(uploadRoot, "collection-covers");
    const previousStoredName = "collection-00000000-0000-4000-8000-000000000001.webp";
    await mkdir(coverDirectory, { recursive: true });
    await writeFile(join(coverDirectory, previousStoredName), Buffer.from("old-cover"));
    let updatedData: Record<string, unknown> = {};
    const prisma = {
      articleCollection: {
        findFirst: jest.fn(async (args: { include?: unknown }) => args.include ? { ...collection(), coverPath: updatedData.coverPath ?? null } : { id: 31, coverStoredName: previousStoredName }),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updatedData = data;
          return {};
        }),
      },
    };
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    try {
      const result = await createService(prisma).uploadCollectionCover(user, 31, {
        buffer: png,
        mimetype: "image/png",
        originalname: "new-cover.png",
        size: png.length,
      });

      const storedName = String(updatedData.coverStoredName);
      expect(result.coverPath).toBe(`/discovery/collections/covers/${storedName}`);
      expect((await stat(join(coverDirectory, storedName))).size).toBe(png.length);
      await expect(stat(join(coverDirectory, previousStoredName))).rejects.toThrow();
    } finally {
      if (previousUploadRoot === undefined) delete process.env.ARTICLE_UPLOAD_DIR;
      else process.env.ARTICLE_UPLOAD_DIR = previousUploadRoot;
      await rm(uploadRoot, { recursive: true, force: true });
    }
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
      profileAccess: "public",
      searchable: true,
      friendRequestPolicy: "everyone",
      directMessagePolicy: "request",
      groupInvitationPolicy: "everyone",
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
      friendship: { findFirst: jest.fn(async () => null) },
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
            profileAccess: "public",
            searchable: true,
            friendRequestPolicy: "everyone",
            directMessagePolicy: "request",
            groupInvitationPolicy: "everyone",
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
      friendship: { findFirst: jest.fn(async () => null) },
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
