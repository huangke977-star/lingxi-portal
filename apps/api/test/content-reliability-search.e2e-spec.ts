import { ForbiddenException } from "@nestjs/common";
import { ArticleStatus, ArticleVersionSource, ArticleVisibility } from "../src/generated/prisma/client";
import { ArticlesService } from "../src/articles/articles.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { SearchIndexService } from "../src/search/search-index.service";
import { buildSearchFields } from "../src/search/search-normalization";
import { SearchService } from "../src/search/search.service";
import { SiteSettingsService } from "../src/site-settings/site-settings.service";

const author: AuthenticatedUser = {
  id: 7,
  username: "writer",
  nickname: "灵犀作者",
  email: "writer@example.com",
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
  role: { code: "qi_refining", name: "练气", level: 10 },
};

function articleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    authorId: author.id,
    title: "灵犀使用指南",
    slug: "article-12345678",
    summary: "",
    content: "第一版正文",
    coverPath: null,
    category: "教程",
    tags: "灵犀,指南",
    titleColor: "",
    visibility: ArticleVisibility.public,
    status: ArticleStatus.draft,
    isPinned: false,
    pinOrder: 0,
    publishedAt: null,
    blockedReason: null,
    viewCount: 0,
    likeCount: 0,
    favoriteCount: 0,
    commentCount: 0,
    searchText: "灵犀使用指南 教程 灵犀 指南",
    searchPinyin: "ling xi shi yong zhi nan lingxishiyongzhinan lxsyzn",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    author: {
      id: author.id,
      username: author.username,
      nickname: author.nickname,
      avatarStoredName: null,
      isSuperAdmin: false,
      role: author.role,
    },
    allowedRoles: [],
    images: [],
    comments: [],
    likes: [],
    favorites: [],
    ...overrides,
  };
}

function createArticlesService(prisma: object) {
  return new ArticlesService(
    prisma as PrismaService,
    {
      getArticlePublishPolicy: jest.fn(async () => ({ defaultArticleVisibility: ArticleVisibility.public })),
    } as unknown as SiteSettingsService,
    {} as RedisService,
  );
}

describe("P3 content reliability and unified search", () => {
  it("creates one autosave snapshot and deduplicates identical content", async () => {
    const record = articleRecord();
    let latestVersion: Record<string, unknown> | null = null;
    const articleVersion = {
      findFirst: jest.fn(async () => latestVersion),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        latestVersion = data;
        return { id: 1, ...data };
      }),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    };
    const transaction = {
      article: { update: jest.fn(async () => record) },
      articleVersion,
    };
    const prisma = {
      article: { findUnique: jest.fn(async () => record) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createArticlesService(prisma);
    const input = { title: record.title, content: record.content, category: record.category, tags: record.tags };

    await service.autosave(record.id, author, input);
    await service.autosave(record.id, author, input);

    expect(articleVersion.create).toHaveBeenCalledTimes(1);
    expect(articleVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: ArticleVersionSource.autosave, versionNumber: 1 }),
    }));
  });

  it("restores an immutable version as a new draft version", async () => {
    const existing = articleRecord({ content: "当前正文" });
    const historical = {
      id: 31,
      articleId: existing.id,
      versionNumber: 2,
      source: ArticleVersionSource.manual,
      title: "历史标题",
      summary: "",
      content: "历史正文",
      category: "随笔",
      tags: "历史",
      titleColor: "",
      visibility: ArticleVisibility.public,
      status: ArticleStatus.draft,
      roleCodes: "",
      contentHash: "old-hash",
      changedFields: ["content"],
      editorId: author.id,
      createdAt: new Date("2026-08-01T01:00:00.000Z"),
    };
    const restored = articleRecord({ title: historical.title, content: historical.content, category: historical.category, tags: historical.tags });
    const transaction = {
      article: { update: jest.fn(async () => restored) },
      articleVersion: {
        findFirst: jest.fn(async () => ({ ...historical, versionNumber: 2 })),
        create: jest.fn(async () => ({ id: 32 })),
        findMany: jest.fn(async () => []),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const prisma = {
      article: { findUnique: jest.fn(async () => existing) },
      articleVersion: { findFirst: jest.fn(async () => historical) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createArticlesService(prisma);

    await service.restoreVersion(existing.id, historical.id, author);

    expect(transaction.article.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: "历史标题", content: "历史正文", status: ArticleStatus.draft }),
    }));
    expect(transaction.articleVersion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ source: ArticleVersionSource.restore, versionNumber: 3 }),
    }));
  });

  it("rejects autosave from a user who cannot edit the article", async () => {
    const record = articleRecord({ authorId: 99 });
    const prisma = { article: { findUnique: jest.fn(async () => record) }, $transaction: jest.fn() };
    const service = createArticlesService(prisma);

    await expect(service.autosave(record.id, author, { content: "越权修改" })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("builds full and initial pinyin fields for Chinese content", () => {
    const fields = buildSearchFields(["灵犀导航"]);
    expect(fields.searchPinyin).toContain("lingxidaohang");
    expect(fields.searchPinyin).toContain("lxdh");
  });

  it("deduplicates account history while aggregating hot search counts", async () => {
    const searchHistory = { upsert: jest.fn(async () => ({ id: 1 })), deleteMany: jest.fn() };
    const searchKeywordStat = { upsert: jest.fn(async () => ({ id: 1 })) };
    const prisma = {
      searchHistory,
      searchKeywordStat,
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new SearchService(prisma as unknown as PrismaService);

    await service.recordSearch("  灵犀  ", author.id);

    expect(searchHistory.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_normalizedKey: { userId: author.id, normalizedKey: "灵犀" } },
      update: expect.objectContaining({ searchCount: { increment: 1 } }),
    }));
    expect(searchKeywordStat.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { normalizedKey: "灵犀" },
      update: expect.objectContaining({ searchCount: { increment: 1 } }),
    }));
  });

  it("backfills legacy search fields with pinyin without changing source records", async () => {
    const userUpdate = jest.fn(async () => ({ id: 1 }));
    const articleUpdate = jest.fn(async () => ({ id: 2 }));
    const entryUpdate = jest.fn(async () => ({ id: 3 }));
    const prisma = {
      user: {
        findMany: jest.fn(async () => [{ id: 1, username: "lingxi", nickname: "灵犀", profileBio: "" }]),
        update: userUpdate,
      },
      article: {
        findMany: jest.fn(async () => [{ id: 2, title: "灵犀教程", category: "教程", tags: "指南" }]),
        update: articleUpdate,
      },
      portalEntry: {
        findMany: jest.fn(async () => [{ id: 3, title: "灵犀导航", description: "入口", category: { name: "导航" } }]),
        update: entryUpdate,
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    };
    const service = new SearchIndexService(prisma as unknown as PrismaService);

    await expect(service.backfillMissingFields()).resolves.toBe(3);
    expect(articleUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 2 },
      data: expect.objectContaining({ searchPinyin: expect.stringContaining("lingxi") }),
    }));
    expect(entryUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 } }));
  });

  it("keeps scoped search query count bounded while applying pinyin, sort and pagination", async () => {
    const articleFindMany = jest.fn(async () => []);
    const userCount = jest.fn(async () => 0);
    const prisma = {
      article: { count: jest.fn(async () => 0), findMany: articleFindMany },
      user: { count: userCount, findMany: jest.fn(async () => []) },
      portalEntry: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      articleTaxonomy: { findMany: jest.fn(async () => []) },
      portalCategory: { findMany: jest.fn(async () => []) },
    };
    const service = new SearchService(prisma as unknown as PrismaService);

    await service.search({
      q: "lingxi",
      page: 2,
      pageSize: 12,
      scope: "articles",
      sort: "popular",
    }, null);

    expect(userCount).not.toHaveBeenCalled();
    expect(articleFindMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 12,
      take: 12,
      orderBy: expect.arrayContaining([{ viewCount: "desc" }, { likeCount: "desc" }]),
      where: expect.objectContaining({
        AND: expect.arrayContaining([expect.objectContaining({
          OR: expect.arrayContaining([{ searchPinyin: { contains: "lingxi" } }]),
        })]),
      }),
    }));
  });
});
