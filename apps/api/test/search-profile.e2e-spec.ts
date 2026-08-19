import { NotFoundException } from "@nestjs/common";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { SearchService } from "../src/search/search.service";
import { SiteSettingsService } from "../src/site-settings/site-settings.service";
import { ReputationService } from "../src/reputation/reputation.service";
import { ChatAttachmentsService } from "../src/social/chat-attachments.service";
import { SocialService } from "../src/social/social.service";

const member: AuthenticatedUser = {
  id: 7,
  username: "member",
  nickname: "成员",
  email: "member@example.com",
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

describe("global search and public profiles", () => {
  it("limits anonymous search to public content and excludes server entries", async () => {
    const prisma = {
      article: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      user: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      portalEntry: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      articleTopic: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      articleCollection: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      chatGroup: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      announcement: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      articleTaxonomy: { findMany: jest.fn(async () => []) },
      portalCategory: { findMany: jest.fn(async () => []) },
    };
    const service = new SearchService(prisma as unknown as PrismaService);

    await service.search({ q: "测试", page: 1, pageSize: 12 }, null);

    expect(prisma.article.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([expect.objectContaining({ visibility: "public" })]),
      }),
    }));
    expect(prisma.portalEntry.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        category: expect.objectContaining({ kind: { in: ["navigation", "custom_page"] } }),
        AND: expect.arrayContaining([expect.objectContaining({ visibility: "public" })]),
      }),
    }));
    expect(prisma.portalEntry.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        category: expect.objectContaining({ kind: { in: ["tool"] } }),
      }),
    }));
    expect(prisma.portalCategory.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        entries: { some: expect.objectContaining({ visibility: "public" }) },
      }),
    }));
  });

  it("adds private-owner and role visibility only for the signed-in user", async () => {
    const prisma = {
      article: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      user: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      portalEntry: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      articleTopic: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      articleCollection: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      chatGroup: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      announcement: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      articleTaxonomy: { findMany: jest.fn(async () => []) },
      portalCategory: { findMany: jest.fn(async () => []) },
    };
    const service = new SearchService(prisma as unknown as PrismaService);

    await service.search({ q: "测试", page: 1, pageSize: 12 }, member);

    expect(prisma.article.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([expect.objectContaining({
          OR: expect.arrayContaining([
            { visibility: "private", authorId: member.id },
            { visibility: "role_restricted", allowedRoles: { some: { role: { code: member.role.code } } } },
          ]),
        })]),
      }),
    }));
    expect(prisma.portalEntry.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([{
          OR: [
            { visibility: "public" },
            { visibility: "authenticated" },
            { visibility: "role_restricted", allowedRoles: { some: { role: { code: member.role.code } } } },
          ],
        }]),
      }),
    }));
    expect(prisma.articleTopic.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([
              { visibility: "role_restricted", allowedRoles: { some: { role: { code: member.role.code } } } },
            ]),
          }),
        ]),
      }),
    }));
    expect(prisma.chatGroup.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: expect.arrayContaining([
          { members: { none: { userId: member.id, status: "blocked" } } },
        ]),
      }),
    }));
  });

  it("looks up active profiles by username without exposing disabled accounts", async () => {
    const activeUser = {
      id: 9,
      username: "writer",
      nickname: "写作者",
      avatarStoredName: null,
      profileBio: "公开介绍",
      isSuperAdmin: false,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      status: "active",
      role: { code: "foundation", name: "筑基", level: 20 },
    };
    const prisma = {
      user: { findUnique: jest.fn(async () => activeUser) },
      userSubscription: {
        findUnique: jest.fn(async () => null),
        count: jest.fn()
          .mockResolvedValueOnce(3)
          .mockResolvedValueOnce(2),
      },
      article: {
        aggregate: jest.fn(async () => ({
          _count: { _all: 4 },
          _sum: { likeCount: 12, viewCount: 60 },
        })),
      },
      friendship: { findUnique: jest.fn(async () => null) },
    };
    const service = new SocialService(
      prisma as unknown as PrismaService,
      {} as ChatAttachmentsService,
      {} as SiteSettingsService,
      {} as ReputationService,
    );

    await expect(service.getProfileByUsername(" writer ", null)).resolves.toMatchObject({
      username: "writer",
      nickname: "写作者",
      profileBio: "公开介绍",
      subscriberCount: 3,
      followingCount: 2,
      publicArticleCount: 4,
      receivedLikeCount: 12,
      publicViewCount: 60,
      subscribed: false,
      relationship: null,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { username: "writer" } }));

    prisma.user.findUnique.mockResolvedValueOnce({ ...activeUser, status: "disabled" });
    await expect(service.getProfileByUsername("writer", null)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("suppresses private profile fields without calculating hidden statistics", async () => {
    const privateUser = {
      id: 9,
      username: "private-writer",
      nickname: "低调作者",
      avatarStoredName: null,
      profileBio: "不公开的介绍",
      isSuperAdmin: false,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      status: "active",
      role: { code: "foundation", name: "筑基", level: 20 },
      profileSettings: {
        showBio: false,
        showJoinedAt: false,
        showStats: false,
        showFollowingCount: false,
        showPinnedContent: false,
      },
    };
    const prisma = {
      user: { findUnique: jest.fn(async () => privateUser) },
      userSubscription: {
        findUnique: jest.fn(async () => null),
        count: jest.fn(async () => 99),
      },
      article: {
        aggregate: jest.fn(async () => ({
          _count: { _all: 99 },
          _sum: { likeCount: 99, viewCount: 99 },
        })),
      },
      friendship: { findUnique: jest.fn(async () => null) },
    };
    const service = new SocialService(
      prisma as unknown as PrismaService,
      {} as ChatAttachmentsService,
      {} as SiteSettingsService,
      {} as ReputationService,
    );

    await expect(service.getProfileByUsername(privateUser.username, null)).resolves.toMatchObject({
      profileBio: null,
      createdAt: null,
      subscriberCount: null,
      followingCount: null,
      publicArticleCount: null,
      receivedLikeCount: null,
      publicViewCount: null,
      visibleFields: {
        bio: false,
        joinedAt: false,
        stats: false,
        followingCount: false,
        pinnedContent: false,
      },
    });
    expect(prisma.userSubscription.count).not.toHaveBeenCalled();
    expect(prisma.article.aggregate).not.toHaveBeenCalled();
  });
});
