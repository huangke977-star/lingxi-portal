import { ForbiddenException } from "@nestjs/common";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { SocialService } from "../src/social/social.service";

const user: AuthenticatedUser = {
  id: 7,
  username: "member",
  nickname: "成员",
  email: "member@example.com",
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

const socialUser = (id: number) => ({
  id,
  nickname: `用户${id}`,
  username: `user-${id}`,
  avatarStoredName: null,
  profileBio: "介绍",
  isSuperAdmin: false,
  createdAt: new Date("2026-07-20T00:00:00.000Z"),
  status: "active",
  role: { code: "qi_refining", name: "练气", level: 10 },
});

describe("SocialService", () => {
  it("normalizes the user pair when creating a friend request", async () => {
    const record = {
      id: 9,
      userOneId: 3,
      userTwoId: 7,
      requestedById: 7,
      status: "pending",
      respondedAt: null,
      acceptedAt: null,
      createdAt: new Date("2026-07-23T00:00:00.000Z"),
      updatedAt: new Date("2026-07-23T00:00:00.000Z"),
      userOne: socialUser(3),
      userTwo: socialUser(7),
    };
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 3, status: "active" })) },
      friendship: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => record),
      },
    };
    const service = new SocialService(prisma as unknown as PrismaService);

    const result = await service.requestFriend(user, 3);

    expect(result.direction).toBe("outgoing");
    expect(prisma.friendship.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userOneId_userTwoId: { userOneId: 3, userTwoId: 7 } },
      create: { userOneId: 3, userTwoId: 7, requestedById: 7 },
    }));
  });

  it("does not create a conversation before the friendship is accepted", async () => {
    const prisma = {
      friendship: {
        findUnique: jest.fn(async () => ({
          id: 9,
          userOneId: 7,
          userTwoId: 8,
          requestedById: 7,
          status: "pending",
          respondedAt: null,
          acceptedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          userOne: socialUser(7),
          userTwo: socialUser(8),
        })),
      },
    };
    const service = new SocialService(prisma as unknown as PrismaService);

    await expect(service.getOrCreateConversation(user, 8)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
