import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { ChatMessageType, FriendshipStatus } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { ChatAttachmentsService } from "../src/social/chat-attachments.service";
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

const attachmentsService = {
  bindToMessage: jest.fn(async () => undefined),
  toResponse: jest.fn((attachment: { id: number; conversationId: number; createdAt: Date }) => ({
    id: attachment.id,
    conversationId: attachment.conversationId,
    kind: "image" as const,
    originalName: "image.png",
    mimeType: "image/png",
    sizeBytes: 8,
    downloadUrl: `/social/attachments/${attachment.id}/download`,
    createdAt: attachment.createdAt.toISOString(),
  })),
};

function createService(prisma: object) {
  return new SocialService(
    prisma as unknown as PrismaService,
    attachmentsService as unknown as ChatAttachmentsService,
  );
}

describe("SocialService", () => {
  it("normalizes the user pair when creating a friend request", async () => {
    const record = {
      id: 9,
      userOneId: 3,
      userTwoId: 7,
      requestedById: 7,
      requestNote: "一起交流",
      status: "pending",
      respondedAt: null,
      acceptedAt: null,
      createdAt: new Date("2026-07-23T00:00:00.000Z"),
      updatedAt: new Date("2026-07-23T00:00:00.000Z"),
      userOne: socialUser(3),
      userTwo: socialUser(7),
    };
    const transaction = {
      friendship: { upsert: jest.fn(async () => record) },
      userNotification: { create: jest.fn(async () => ({ id: 1 })) },
    };
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 3, status: "active" })) },
      friendship: {
        findUnique: jest.fn(async () => null),
      },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createService(prisma);

    const result = await service.requestFriend(user, 3, "一起交流");

    expect(result.direction).toBe("outgoing");
    expect(result.note).toBe("一起交流");
    expect(transaction.friendship.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userOneId_userTwoId: { userOneId: 3, userTwoId: 7 } },
      create: { userOneId: 3, userTwoId: 7, requestedById: 7, requestNote: "一起交流" },
    }));
    expect(transaction.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 3, friendshipId: 9, type: "friend_request_received" }),
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
          requestNote: null,
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
    const service = createService(prisma);

    await expect(service.getOrCreateConversation(user, 8)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("creates a response notification when accepting a friend request", async () => {
    const existing = {
      id: 12,
      userOneId: 7,
      userTwoId: 8,
      requestedById: 8,
      requestNote: "你好",
      status: FriendshipStatus.pending,
      respondedAt: null,
      acceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      userOne: socialUser(7),
      userTwo: socialUser(8),
    };
    const accepted = { ...existing, status: FriendshipStatus.accepted, respondedAt: new Date(), acceptedAt: new Date() };
    const transaction = {
      friendship: { update: jest.fn(async () => accepted) },
      conversation: { upsert: jest.fn(async () => ({ id: 21 })) },
      chatMessage: { create: jest.fn(async () => ({ id: 31 })) },
      userNotification: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async () => ({ id: 2 })),
      },
    };
    const prisma = {
      friendship: { findUnique: jest.fn(async () => existing) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createService(prisma);

    const result = await service.respondFriendRequest(user, 12, "accepted");

    expect(result.status).toBe(FriendshipStatus.accepted);
    expect(transaction.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 8, actorId: 7, type: "friend_request_accepted" }),
    }));
    expect(transaction.userNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 7, friendshipId: 12, type: "friend_request_received" }),
    }));
    expect(transaction.conversation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { friendshipId: 12 },
    }));
    expect(transaction.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conversationId: 21, type: "system" }),
    }));
  });

  it("allows an attachment-only message and binds every attachment in the message transaction", async () => {
    const createdAt = new Date("2026-07-23T10:00:00.000Z");
    const message = {
      id: 31,
      conversationId: 5,
      senderId: user.id,
      body: "",
      type: ChatMessageType.attachment,
      readAt: null,
      createdAt,
      sender: socialUser(user.id),
      attachments: [{
        id: 41,
        conversationId: 5,
        uploadedById: user.id,
        messageId: 31,
        kind: "image",
        originalName: "image.png",
        storedName: "stored.png",
        mimeType: "image/png",
        sizeBytes: 8,
        sortOrder: 0,
        usedAt: createdAt,
        createdAt,
      }],
    };
    const friendship = { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted };
    const transaction = {
      chatMessage: {
        create: jest.fn(async () => ({ id: 31 })),
        findUniqueOrThrow: jest.fn(async () => message),
      },
      conversation: { update: jest.fn(async () => ({ id: 5 })) },
    };
    const prisma = {
      conversation: { findUnique: jest.fn(async () => ({ friendship })) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createService(prisma);

    const result = await service.createMessage(user.id, 5, "", [41]);

    expect(result.type).toBe("attachment");
    expect(result.attachments).toHaveLength(1);
    expect(attachmentsService.bindToMessage).toHaveBeenCalledWith(transaction, user.id, 5, [41], 31);
  });

  it("rejects a message when both text and attachments are empty", async () => {
    const service = createService({});
    await expect(service.createMessage(user.id, 5, "", [])).rejects.toBeInstanceOf(BadRequestException);
  });
});
