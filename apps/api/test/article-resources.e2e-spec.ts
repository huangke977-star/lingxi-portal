import {
  ArticleStatus,
  ArticleVisibility,
} from "../src/generated/prisma/client";
import { ArticlesService } from "../src/articles/articles.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { ReputationService } from "../src/reputation/reputation.service";
import { SiteSettingsService } from "../src/site-settings/site-settings.service";

const viewer: AuthenticatedUser = {
  id: 7,
  username: "reader",
  nickname: "读者",
  email: "reader@example.com",
  status: "active",
  isSuperAdmin: false,
  avatarUrl: null,
  profileBio: "",
  createdAt: new Date(),
  appearance: {
    themeId: "cloud-blue",
    customAccent: "#1814f0",
    customSurface: "#dfc8c8",
    customForeground: "#2b2530",
    customMuted: "#665867",
    cardAlpha: 50,
    glassBlur: 18,
    glassTint: "#fff3f6",
    glassTintAlpha: 0,
  },
  role: { code: "qi_refining", name: "练气", level: 10 },
};

function resourceArticle() {
  return {
    id: 12,
    authorId: 8,
    title: "积分资源文章",
    slug: "resource-article",
    summary: "兑换前可以看到这段摘要。",
    content: "只有兑换后才能返回的完整正文。",
    coverPath: null,
    category: "资源",
    tags: "资源",
    titleColor: "",
    visibility: ArticleVisibility.public,
    status: ArticleStatus.published,
    isPinned: false,
    pinOrder: 0,
    publishedAt: new Date("2026-08-16T00:00:00.000Z"),
    blockedReason: null,
    viewCount: 1,
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    isPointResource: true,
    pointCost: 10,
    searchText: "",
    searchPinyin: "",
    createdAt: new Date("2026-08-16T00:00:00.000Z"),
    updatedAt: new Date("2026-08-16T00:00:00.000Z"),
    author: {
      id: 8,
      nickname: "作者",
      username: "author",
      avatarStoredName: null,
      isSuperAdmin: false,
      role: { code: "foundation_building", name: "筑基", level: 20 },
    },
    allowedRoles: [],
    images: [],
    likes: [],
    favorites: [],
    collectionItems: [],
    topicItems: [],
    comments: [],
  };
}

function createService(prisma: object, reputation: object = {}) {
  return new ArticlesService(
    prisma as PrismaService,
    {} as SiteSettingsService,
    {} as RedisService,
    reputation as ReputationService,
  );
}

describe("article point resources", () => {
  it("never returns the protected body to a visitor before redemption", async () => {
    const article = resourceArticle();
    const prisma = {
      article: {
        findUnique: jest.fn(async () => article),
      },
      $transaction: jest.fn(
        async (callback: (transaction: object) => Promise<void>) =>
          callback({
            articleView: { create: jest.fn(async () => ({ id: 1 })) },
            article: { update: jest.fn(async () => article) },
          }),
      ),
    };
    const service = createService(prisma);

    await expect(
      service.getPublicBySlug(article.slug, "visitor-key"),
    ).resolves.toMatchObject({
      content: "",
      summary: article.summary,
      resource: {
        enabled: true,
        pointCost: 10,
        redeemed: false,
        accessible: false,
      },
    });
  });

  it("permanently unlocks the body after one atomic exchange", async () => {
    const article = resourceArticle();
    const createExchange = jest.fn(async () => ({ count: 1 }));
    const transferResourcePoints = jest.fn(async () => undefined);
    const prisma = {
      article: { findUnique: jest.fn(async () => article) },
      articleResourceExchange: { findUnique: jest.fn(async () => ({ id: 1 })) },
      articleReadLater: { findUnique: jest.fn(async () => null) },
      articleReadingHistory: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(
        async (callback: (transaction: object) => Promise<void>) =>
          callback({
            articleResourceExchange: { createMany: createExchange },
          }),
      ),
    };
    const service = createService(prisma, { transferResourcePoints });

    await expect(
      service.redeemResource(article.id, viewer),
    ).resolves.toMatchObject({
      content: article.content,
      resource: {
        enabled: true,
        pointCost: 10,
        redeemed: true,
        accessible: true,
      },
    });
    expect(createExchange).toHaveBeenCalledWith({
      data: [
        {
          articleId: article.id,
          buyerId: viewer.id,
          authorId: article.authorId,
          pointCost: article.pointCost,
        },
      ],
      skipDuplicates: true,
    });
    expect(transferResourcePoints).toHaveBeenCalledWith(expect.anything(), {
      buyerId: viewer.id,
      authorId: article.authorId,
      articleId: article.id,
      pointCost: article.pointCost,
    });
  });

  it("does not transfer points again when the exchange already exists", async () => {
    const article = resourceArticle();
    const transferResourcePoints = jest.fn(async () => undefined);
    const prisma = {
      article: { findUnique: jest.fn(async () => article) },
      articleResourceExchange: { findUnique: jest.fn(async () => ({ id: 1 })) },
      articleReadLater: { findUnique: jest.fn(async () => null) },
      articleReadingHistory: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(
        async (callback: (transaction: object) => Promise<void>) =>
          callback({
            articleResourceExchange: {
              createMany: jest.fn(async () => ({ count: 0 })),
            },
          }),
      ),
    };
    const service = createService(prisma, { transferResourcePoints });

    await expect(
      service.redeemResource(article.id, viewer),
    ).resolves.toMatchObject({
      content: article.content,
      resource: { redeemed: true, accessible: true },
    });
    expect(transferResourcePoints).not.toHaveBeenCalled();
  });

  it("rejects publishing an autosaved resource without a valid point cost", async () => {
    const article = {
      ...resourceArticle(),
      authorId: viewer.id,
      status: ArticleStatus.draft,
      publishedAt: null,
      pointCost: 0,
    };
    const transaction = jest.fn();
    const service = createService({
      article: { findUnique: jest.fn(async () => article) },
      $transaction: transaction,
    });

    await expect(service.publish(article.id, viewer)).rejects.toThrow(
      "积分资源的兑换价格必须是 1 到 10000 的整数。",
    );
    expect(transaction).not.toHaveBeenCalled();
  });
});
