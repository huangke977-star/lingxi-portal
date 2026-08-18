import { AnonymousTopicReactionValue, AnonymousTopicStatus } from "../src/generated/prisma/client";
import { JwtService } from "@nestjs/jwt";
import { createHash } from "node:crypto";
import { AnonymousTopicsService } from "../src/anonymous-topics/anonymous-topics.service";
import type { AuthenticatedUser } from "../src/auth/auth.types";
import { PasswordService } from "../src/auth/password.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";

const visitorKey = "browser-visitor-key-for-topic-tests";
const now = new Date("2026-08-15T08:00:00.000Z");

function topic() {
  return {
    id: 7,
    title: "排序测试",
    status: AnonymousTopicStatus.active,
    isHidden: false,
    messageCount: 12,
    messageSequence: 12,
    messageLikeCount: 9,
    favoriteCount: 4,
    createdAt: now,
    updatedAt: now,
  };
}

const manager = {
  id: 1,
  isSuperAdmin: true,
  isAdministrator: false,
  role: { code: "qi_refining", name: "练气", level: 10 },
} as AuthenticatedUser;

function createService(prisma: object) {
  return new AnonymousTopicsService(
    prisma as PrismaService,
    {} as PasswordService,
    {} as JwtService,
    {} as RedisService,
  );
}

describe("AnonymousTopicsService engagement", () => {
  it("uses the fixed home ordering and returns visitor favorite and message highlights", async () => {
    const liked = { id: 31, sequence: 2, body: "最受认可的点评", likeCount: 6, dislikeCount: 1, identity: { nickname: "清风" } };
    const disliked = { id: 32, sequence: 5, body: "争议最大的点评", likeCount: 1, dislikeCount: 4, identity: null };
    const findMany = jest.fn(async (args: { select?: { messages?: { where?: { likeCount?: unknown; dislikeCount?: unknown } } } }) => {
      if (!args.select) return [topic()];
      if (args.select.messages?.where?.likeCount) return [{ id: 7, messages: [liked] }];
      return [{ id: 7, messages: [disliked] }];
    });
    const prisma = {
      anonymousTopic: { count: jest.fn(async () => 1), findMany },
      anonymousTopicFavorite: { findMany: jest.fn(async () => [{ topicId: 7 }]) },
    };

    const result = await createService(prisma).list({ page: 1, pageSize: 8, sort: "home" }, visitorKey);

    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      orderBy: [
        { favoriteCount: "desc" },
        { messageCount: "desc" },
        { messageLikeCount: "desc" },
        { updatedAt: "desc" },
        { id: "desc" },
      ],
    }));
    expect(result.items[0]).toMatchObject({
      favorited: true,
      topLikedMessage: { id: 31, count: 6, nickname: "清风" },
      topDislikedMessage: { id: 32, count: 4, nickname: null },
    });
    expect(prisma.anonymousTopicFavorite.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ visitorKey: createHash("sha256").update(visitorKey).digest("hex") }),
    }));
  });

  it("toggles one topic favorite per visitor and increments the aggregate once", async () => {
    const transaction = {
      anonymousTopic: {
        findFirst: jest.fn(async () => topic()),
        update: jest.fn(async () => ({ ...topic(), favoriteCount: 5 })),
      },
      anonymousTopicFavorite: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({})),
        delete: jest.fn(async () => ({})),
      },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)) };

    const result = await createService(prisma).favorite(7, { visitorKey });

    expect(result).toMatchObject({ id: 7, favorited: true, favoriteCount: 5 });
    expect(transaction.anonymousTopicFavorite.create).toHaveBeenCalledWith({
      data: { topicId: 7, visitorKey: createHash("sha256").update(visitorKey).digest("hex") },
    });
    expect(transaction.anonymousTopic.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { favoriteCount: { increment: 1 } },
    });
  });

  it("keeps the topic message-like aggregate in sync with a message upvote", async () => {
    const current = {
      id: 31,
      topicId: 7,
      sequence: 2,
      body: "点评",
      isHidden: false,
      likeCount: 2,
      dislikeCount: 0,
      identityId: null,
      identity: null,
      createdAt: now,
      updatedAt: now,
    };
    const transaction = {
      anonymousTopicMessage: {
        findFirst: jest.fn(async () => current),
        update: jest.fn(async () => ({ ...current, likeCount: 3 })),
      },
      anonymousTopicReaction: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
        delete: jest.fn(async () => ({})),
      },
      anonymousTopic: { update: jest.fn(async () => topic()) },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)) };

    await createService(prisma).react(31, { visitorKey, value: "up" });

    expect(transaction.anonymousTopicReaction.create).toHaveBeenCalledWith({
      data: { messageId: 31, visitorKey: expect.any(String), value: AnonymousTopicReactionValue.up },
    });
    expect(transaction.anonymousTopic.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { messageLikeCount: { increment: 1 } },
    });
  });

  it("filters hidden topics for managers when requested", async () => {
    const findMany = jest.fn(async (args: { select?: unknown }) => args.select ? [{ id: 7, messages: [] }] : [topic()]);
    const prisma = {
      anonymousTopic: { count: jest.fn(async () => 1), findMany },
      anonymousTopicFavorite: { findMany: jest.fn(async () => []) },
    };

    await createService(prisma).listAdmin(manager, {
      page: 1,
      pageSize: 8,
      sort: "time",
      visibility: "hidden",
    });

    expect(prisma.anonymousTopic.count).toHaveBeenCalledWith({ where: { isHidden: true } });
    expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { isHidden: true } }));
  });

  it("updates visible message and like counts when a manager hides a message", async () => {
    const current = {
      id: 31,
      topicId: 7,
      sequence: 2,
      body: "需要隐藏的点评",
      isHidden: false,
      likeCount: 2,
      dislikeCount: 1,
      identityId: null,
      identity: null,
      createdAt: now,
      updatedAt: now,
    };
    const transaction = {
      anonymousTopicMessage: {
        findUnique: jest.fn(async () => current),
        update: jest.fn(async () => ({ ...current, isHidden: true })),
      },
      anonymousTopic: { update: jest.fn(async () => topic()) },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof transaction) => unknown) => callback(transaction)) };

    const result = await createService(prisma).updateMessage(manager, 31, { isHidden: true });

    expect(result.isHidden).toBe(true);
    expect(transaction.anonymousTopic.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: {
        messageCount: { increment: -1 },
        messageLikeCount: { increment: -2 },
      },
    });
  });
});
