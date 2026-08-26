import { ArticleStatus, ArticleVisibility, Prisma } from "../src/generated/prisma/client";
import { ArticlesService } from "../src/articles/articles.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { parseArticleContent } from "../src/articles/article-resources";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { ReputationService } from "../src/reputation/reputation.service";
import { SiteSettingsService } from "../src/site-settings/site-settings.service";

const sourceContent = [
  "公开正文。",
  "",
  ":::resource{points=10}",
  "第一段需要兑换的内容。",
  ":::",
  "",
  "中间公开正文。",
  "",
  ":::resource{points=5}",
  "第二段需要兑换的内容。",
  ":::",
].join("\n");

const parsedContent = parseArticleContent(sourceContent);
const firstBlock = parsedContent.blocks[0];
const secondBlock = parsedContent.blocks[1];

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
    content: sourceContent,
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
    isPointResource: false,
    pointCost: 0,
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

function readerStateDelegates(unlockedKeys: string[] = []) {
  return {
    articleReadLater: { findUnique: jest.fn(async () => null) },
    articleReadingHistory: { findUnique: jest.fn(async () => null) },
    articleResourceExchange: {
      findMany: jest.fn(async () => unlockedKeys.map((blockKey) => ({ blockKey }))),
    },
  };
}

type ExchangeCreateArgs = {
  data: {
    articleId: number;
    buyerId: number;
    authorId: number;
    blockKey: string;
    pointCost: number;
    sellerAvailableAt: Date;
  };
};

describe("article resource blocks", () => {
  it("derives the resource flag and lowest exchange cost from resource-block content", () => {
    const service = createService({});
    const summary = (service as unknown as {
      resourceSummary: (content: string) => { isPointResource: boolean; pointCost: number };
    }).resourceSummary(sourceContent);
    expect(summary).toEqual({ isPointResource: true, pointCost: 5 });
    expect((service as unknown as { resourceSummary: (content: string) => { isPointResource: boolean; pointCost: number } }).resourceSummary("公开内容"))
      .toEqual({ isPointResource: false, pointCost: 0 });
  });

  it("does not return locked resource bodies to a visitor", async () => {
    const article = resourceArticle();
    const prisma = {
      article: { findUnique: jest.fn(async () => article) },
      $transaction: jest.fn(
        async (callback: (transaction: object) => Promise<void>) =>
          callback({
            articleView: { create: jest.fn(async () => ({ id: 1 })) },
            article: { update: jest.fn(async () => article) },
          }),
      ),
    };
    const service = createService(prisma);

    await expect(service.getPublicBySlug(article.slug, "visitor-key")).resolves.toMatchObject({
      content: "公开正文。\n\n中间公开正文。",
      summary: article.summary,
      contentSegments: [
        { type: "markdown", content: "公开正文。" },
        { type: "resource", key: firstBlock.key, pointCost: 10, unlocked: false },
        { type: "markdown", content: "中间公开正文。" },
        { type: "resource", key: secondBlock.key, pointCost: 5, unlocked: false },
      ],
      resource: {
        enabled: true,
        blocks: [
          { key: firstBlock.key, pointCost: 10, unlocked: false },
          { key: secondBlock.key, pointCost: 5, unlocked: false },
        ],
      },
    });
  });

  it("redeems one block and leaves the other block locked", async () => {
    const article = resourceArticle();
    const createExchange = jest.fn(async (args: ExchangeCreateArgs) => {
      void args.data;
      return { id: 1 };
    });
    const transferResourcePoints = jest.fn(async () => undefined);
    const prisma = {
      article: { findUnique: jest.fn(async () => article) },
      ...readerStateDelegates([firstBlock.key]),
      $transaction: jest.fn(
        async (callback: (transaction: object) => Promise<void>) =>
          callback({
            articleResourceExchange: {
              findUnique: jest.fn(async () => null),
              create: createExchange,
            },
          }),
      ),
    };
    const service = createService(prisma, { transferResourcePoints });

    await expect(
      service.redeemResource(article.id, viewer, { blockKey: firstBlock.key }),
    ).resolves.toMatchObject({
      content: "公开正文。\n\n中间公开正文。",
      contentSegments: [
        { type: "markdown", content: "公开正文。" },
        { type: "resource", key: firstBlock.key, pointCost: 10, unlocked: true, content: firstBlock.content },
        { type: "markdown", content: "中间公开正文。" },
        { type: "resource", key: secondBlock.key, pointCost: 5, unlocked: false },
      ],
    });
    expect(createExchange).toHaveBeenCalledWith({
      data: expect.objectContaining({
        articleId: article.id,
        buyerId: viewer.id,
        authorId: article.authorId,
        blockKey: firstBlock.key,
        pointCost: 10,
        sellerAvailableAt: expect.any(Date),
      }),
    });
    const availableAt = createExchange.mock.calls[0]![0].data.sellerAvailableAt;
    expect(availableAt.getTime()).toBeGreaterThan(Date.now() + 71 * 60 * 60 * 1000);
    expect(availableAt.getTime()).toBeLessThan(Date.now() + 73 * 60 * 60 * 1000);
    expect(transferResourcePoints).toHaveBeenCalledWith(expect.anything(), {
      buyerId: viewer.id,
      authorId: article.authorId,
      articleId: article.id,
      blockKey: firstBlock.key,
      pointCost: 10,
    });
  });

  it("does not charge a block twice after it has already been exchanged", async () => {
    const article = resourceArticle();
    const createExchange = jest.fn(async (args: ExchangeCreateArgs) => {
      void args.data;
      return { id: 1 };
    });
    const transferResourcePoints = jest.fn(async () => undefined);
    const prisma = {
      article: { findUnique: jest.fn(async () => article) },
      ...readerStateDelegates([secondBlock.key]),
      $transaction: jest.fn(
        async (callback: (transaction: object) => Promise<void>) =>
          callback({
            articleResourceExchange: {
              findUnique: jest.fn(async () => ({ id: 8 })),
              create: createExchange,
            },
          }),
      ),
    };
    const service = createService(prisma, { transferResourcePoints });

    const response = await service.redeemResource(article.id, viewer, { blockKey: secondBlock.key });
    expect(response.contentSegments.find((segment) => segment.type === "resource" && segment.key === secondBlock.key))
      .toMatchObject({ type: "resource", key: secondBlock.key, unlocked: true, content: secondBlock.content });
    expect(createExchange).not.toHaveBeenCalled();
    expect(transferResourcePoints).not.toHaveBeenCalled();
  });

  it("turns a concurrent duplicate exchange into a stable business error", async () => {
    const article = resourceArticle();
    const duplicate = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const transferResourcePoints = jest.fn(async () => undefined);
    const prisma = {
      article: { findUnique: jest.fn(async () => article) },
      ...readerStateDelegates([]),
      $transaction: jest.fn(async (callback: (transaction: object) => Promise<void>) => callback({
        articleResourceExchange: {
          findUnique: jest.fn(async () => null),
          create: jest.fn(async () => { throw duplicate; }),
        },
      })),
    };
    const service = createService(prisma, { transferResourcePoints });

    await expect(service.redeemResource(article.id, viewer, { blockKey: firstBlock.key }))
      .rejects.toThrow("该资源已经兑换，无需重复支付。");
    expect(transferResourcePoints).not.toHaveBeenCalled();
  });

  it("rejects malformed resource syntax before an article can be saved", () => {
    expect(() => parseArticleContent(":::resource{points=0}\nsecret\n:::"))
      .toThrow("资源块积分必须是 1 到 10000 的整数。");
    expect(() => parseArticleContent(":::resource{points=10}\nsecret"))
      .toThrow("资源块缺少结束标记 :::。");
  });
});
