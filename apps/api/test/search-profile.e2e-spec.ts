import { NotFoundException } from "@nestjs/common";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { SearchService } from "../src/search/search.service";
import { SiteSettingsService } from "../src/site-settings/site-settings.service";
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
        category: expect.objectContaining({ kind: { in: ["navigation", "tool", "custom_page"] } }),
        AND: expect.arrayContaining([expect.objectContaining({ visibility: "public" })]),
      }),
    }));
  });

  it("adds private-owner and role visibility only for the signed-in user", async () => {
    const prisma = {
      article: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      user: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
      portalEntry: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) },
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
        count: jest.fn(async () => 3),
      },
      friendship: { findUnique: jest.fn(async () => null) },
    };
    const service = new SocialService(
      prisma as unknown as PrismaService,
      {} as ChatAttachmentsService,
      {} as SiteSettingsService,
    );

    await expect(service.getProfileByUsername(" writer ", null)).resolves.toMatchObject({
      username: "writer",
      nickname: "写作者",
      profileBio: "公开介绍",
      subscriberCount: 3,
      subscribed: false,
      relationship: null,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { username: "writer" } }));

    prisma.user.findUnique.mockResolvedValueOnce({ ...activeUser, status: "disabled" });
    await expect(service.getProfileByUsername("writer", null)).rejects.toBeInstanceOf(NotFoundException);
  });
});
