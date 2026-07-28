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
  cloneToMessage: jest.fn(async () => ["forwarded-image.webp"]),
  deleteStoredFiles: jest.fn(async () => undefined),
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it("rejects a new friend request when either side has blocked the relationship", async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 8, status: "active" })) },
      friendship: {
        findUnique: jest.fn(async () => ({
          id: 19,
          userOneId: 7,
          userTwoId: 8,
          requestedById: 7,
          blockedById: 8,
          requestNote: null,
          status: FriendshipStatus.blocked,
          respondedAt: new Date(),
          acceptedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          userOne: socialUser(7),
          userTwo: socialUser(8),
        })),
      },
    };
    const service = createService(prisma);

    await expect(service.requestFriend(user, 8)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("blocks an accepted friendship and records who performed the action", async () => {
    const existing = {
      id: 22,
      userOneId: 7,
      userTwoId: 8,
      requestedById: 7,
      blockedById: null,
      requestNote: null,
      status: FriendshipStatus.accepted,
      respondedAt: new Date(),
      acceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      userOne: socialUser(7),
      userTwo: socialUser(8),
    };
    const friendshipUpdate = jest.fn(async () => ({ ...existing, status: FriendshipStatus.blocked, blockedById: user.id }));
    const notificationUpdate = jest.fn(async () => ({ count: 0 }));
    const subscriptionDelete = jest.fn(async () => ({ count: 2 }));
    const prisma = {
      friendship: { findUnique: jest.fn(async () => existing), update: friendshipUpdate },
      userNotification: { updateMany: notificationUpdate },
      userSubscription: { deleteMany: subscriptionDelete },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = createService(prisma);

    await expect(service.blockFriendship(user, 22)).resolves.toEqual({ success: true });
    expect(friendshipUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 22 },
      data: expect.objectContaining({ status: FriendshipStatus.blocked, blockedById: user.id }),
    }));
    expect(subscriptionDelete).toHaveBeenCalledWith({ where: { OR: [
      { subscriberId: 7, authorId: 8 },
      { subscriberId: 8, authorId: 7 },
    ] } });
  });

  it("creates an author subscription and an interaction notification", async () => {
    const createSubscription = jest.fn(async () => ({ subscriberId: user.id, authorId: 8 }));
    const createNotification = jest.fn(async () => ({ id: 41 }));
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 8, status: "active" })) },
      friendship: { findUnique: jest.fn(async () => null) },
      userSubscription: { findUnique: jest.fn(async () => null), create: createSubscription, count: jest.fn(async () => 3) },
      userNotification: { create: createNotification },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = createService(prisma);
    await expect(service.subscribe(user, 8)).resolves.toEqual({ subscribed: true, subscriberCount: 3 });
    expect(createSubscription).toHaveBeenCalledWith({ data: { subscriberId: user.id, authorId: 8 } });
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 8, actorId: user.id, type: "author_subscribed", channel: "interaction" }) }));
  });

  it("rejects subscribing to the current account", async () => {
    await expect(createService({}).subscribe(user, user.id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("only lists blacklist entries created by the current user", async () => {
    const blockedByCurrentUser = {
      id: 23,
      userOneId: 7,
      userTwoId: 8,
      requestedById: 7,
      blockedById: 7,
      requestNote: null,
      status: FriendshipStatus.blocked,
      respondedAt: new Date(),
      acceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      userOne: socialUser(7),
      userTwo: socialUser(8),
    };
    const blockedByOtherUser = {
      ...blockedByCurrentUser,
      id: 24,
      userTwoId: 9,
      blockedById: 9,
      userTwo: socialUser(9),
    };
    const prisma = {
      friendship: { findMany: jest.fn(async () => [blockedByCurrentUser, blockedByOtherUser]) },
    };
    const service = createService(prisma);

    const result = await service.listFriendships(user);

    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0].user.id).toBe(8);
  });

  it("unblocks only a blacklist entry created by the current user", async () => {
    const existing = {
      id: 25,
      userOneId: 7,
      userTwoId: 8,
      requestedById: 7,
      blockedById: 7,
      requestNote: null,
      status: FriendshipStatus.blocked,
      respondedAt: new Date(),
      acceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      userOne: socialUser(7),
      userTwo: socialUser(8),
    };
    const update = jest.fn(async () => ({ ...existing, status: FriendshipStatus.removed, blockedById: null }));
    const prisma = {
      friendship: { findUnique: jest.fn(async () => existing), update },
    };
    const service = createService(prisma);

    await expect(service.unblockFriendship(user, 25)).resolves.toEqual({ success: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: FriendshipStatus.removed, blockedById: null }),
    }));
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
      conversationParticipantState: { createMany: jest.fn(async () => ({ count: 2 })) },
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
      conversationParticipantState: {
        createMany: jest.fn(async () => ({ count: 2 })),
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
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

  it("searches by nickname or username and returns the current relationship state", async () => {
    const accepted = {
      id: 18,
      userOneId: 7,
      userTwoId: 8,
      requestedById: 7,
      blockedById: null,
      requestNote: null,
      status: FriendshipStatus.accepted,
      respondedAt: new Date(),
      acceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      userOne: socialUser(7),
      userTwo: socialUser(8),
    };
    const prisma = {
      user: { findMany: jest.fn(async () => [socialUser(8), socialUser(9)]) },
      friendship: { findMany: jest.fn(async () => [accepted]) },
    };
    const service = createService(prisma);

    const result = await service.searchUsers(user, { q: "user", limit: 12 });

    expect(result.items).toHaveLength(2);
    expect(result.items.find((item) => item.id === 8)).toEqual(expect.objectContaining({
      canRequest: false,
      relationship: expect.objectContaining({ status: FriendshipStatus.accepted, direction: "accepted" }),
    }));
    expect(result.items.find((item) => item.id === 9)).toEqual(expect.objectContaining({
      canRequest: true,
      relationship: null,
    }));
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { not: user.id }, status: "active" }),
    }));
  });

  it("clears only the current account history while keeping the conversation visible", async () => {
    const friendship = { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted };
    const stateUpsert = jest.fn(async () => ({ id: 1 }));
    const prisma = {
      conversation: { findUnique: jest.fn(async () => ({ friendship })) },
      chatMessage: {
        findFirst: jest.fn(async () => ({ id: 52 })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      conversationParticipantState: { upsert: stateUpsert },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = createService(prisma);

    await expect(service.clearConversation(user.id, 5)).resolves.toEqual({
      conversationId: 5,
      participantIds: [7, 8],
    });
    expect(stateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ hidden: false, clearedBeforeMessageId: 52 }),
      update: expect.objectContaining({ hidden: false, clearedBeforeMessageId: 52 }),
    }));
  });

  it("hides a deleted conversation only for the current account", async () => {
    const friendship = { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted };
    const stateUpsert = jest.fn(async () => ({ id: 1 }));
    const prisma = {
      conversation: { findUnique: jest.fn(async () => ({ friendship })) },
      chatMessage: {
        findFirst: jest.fn(async () => ({ id: 53 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      conversationParticipantState: { upsert: stateUpsert },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = createService(prisma);

    await service.hideConversation(user.id, 5);

    expect(stateUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { conversationId_userId: { conversationId: 5, userId: user.id } },
      create: expect.objectContaining({ hidden: true, clearedBeforeMessageId: 53 }),
      update: expect.objectContaining({ hidden: true, clearedBeforeMessageId: 53 }),
    }));
  });

  it("physically deletes selected conversation messages for both participants and removes attachment files", async () => {
    const friendship = { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted };
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const transaction = {
      chatMessage: {
        deleteMany,
        findFirst: jest.fn(async () => ({ createdAt: new Date("2026-07-26T10:00:00.000Z") })),
      },
      conversation: { update: jest.fn(async () => ({ id: 5 })) },
    };
    const conversationFindUnique = jest.fn()
      .mockResolvedValueOnce({ friendship })
      .mockResolvedValueOnce({ createdAt: new Date("2026-07-20T00:00:00.000Z") });
    const prisma = {
      conversation: { findUnique: conversationFindUnique },
      chatMessage: { findMany: jest.fn(async () => [{
        id: 61,
        senderId: user.id,
        type: ChatMessageType.mixed,
        attachments: [{ storedName: "message-file.webp" }],
      }]) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createService(prisma);

    await expect(service.deleteMessagesForEveryone(user.id, 5, [61])).resolves.toEqual({
      conversationId: 5,
      messageIds: [61],
      participantIds: [7, 8],
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 5, id: { in: [61] } },
    });
    expect(attachmentsService.deleteStoredFiles).toHaveBeenCalledWith(["message-file.webp"]);
  });

  it("allows either participant to physically delete the other user's and system messages", async () => {
    const friendship = { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted };
    const deleteMany = jest.fn(async () => ({ count: 2 }));
    const transaction = {
      chatMessage: {
        deleteMany,
        findFirst: jest.fn(async () => null),
      },
      conversation: { update: jest.fn(async () => ({ id: 5 })) },
    };
    const conversationFindUnique = jest.fn()
      .mockResolvedValueOnce({ friendship })
      .mockResolvedValueOnce({ createdAt: new Date("2026-07-20T00:00:00.000Z") });
    const prisma = {
      conversation: { findUnique: conversationFindUnique },
      chatMessage: { findMany: jest.fn(async () => [
        { id: 62, senderId: 8, type: ChatMessageType.text, attachments: [] },
        { id: 63, senderId: 8, type: ChatMessageType.system, attachments: [] },
      ]) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createService(prisma);

    await expect(service.deleteMessagesForEveryone(user.id, 5, [62, 63])).resolves.toEqual({
      conversationId: 5,
      messageIds: [62, 63],
      participantIds: [7, 8],
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 5, id: { in: [62, 63] } },
    });
  });

  it("forwards selected messages in order and clones their attachments", async () => {
    const sourceFriendship = { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted };
    const targetFriendship = { userOneId: 7, userTwoId: 9, status: FriendshipStatus.accepted };
    const forwardedRecord = {
      id: 91,
      conversationId: 12,
      senderId: user.id,
      body: "需要转发的内容",
      type: ChatMessageType.mixed,
      readAt: null,
      createdAt: new Date("2026-07-27T10:00:00.000Z"),
      sender: socialUser(user.id),
      attachments: [{
        id: 101,
        conversationId: 12,
        uploadedById: user.id,
        messageId: 91,
        kind: "image",
        originalName: "image.webp",
        storedName: "forwarded-image.webp",
        mimeType: "image/webp",
        sizeBytes: 128,
        sortOrder: 0,
        usedAt: new Date(),
        createdAt: new Date(),
      }],
      callSession: null,
    };
    const transaction = {
      chatMessage: {
        create: jest.fn(async () => ({ id: 91 })),
        findUniqueOrThrow: jest.fn(async () => forwardedRecord),
      },
      conversationParticipantState: {
        createMany: jest.fn(async () => ({ count: 2 })),
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
      conversation: { update: jest.fn(async () => ({ id: 12 })) },
    };
    const prisma = {
      conversation: {
        findUnique: jest.fn(async ({ where }: { where: { id: number } }) => ({
          friendship: where.id === 5 ? sourceFriendship : targetFriendship,
        })),
      },
      conversationParticipantState: { findUnique: jest.fn(async () => null) },
      chatMessage: { findMany: jest.fn(async () => [{
        id: 81,
        conversationId: 5,
        senderId: 8,
        body: "需要转发的内容",
        type: ChatMessageType.mixed,
        readAt: null,
        createdAt: new Date("2026-07-27T09:00:00.000Z"),
        sender: socialUser(8),
        attachments: [{
          id: 100,
          conversationId: 5,
          uploadedById: 8,
          messageId: 81,
          kind: "image",
          originalName: "image.webp",
          storedName: "source-image.webp",
          mimeType: "image/webp",
          sizeBytes: 128,
          sortOrder: 0,
          usedAt: new Date(),
          createdAt: new Date(),
        }],
        callSession: null,
      }]) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = createService(prisma);

    const result = await service.forwardMessages(user.id, 5, 12, [81]);

    expect(result.participantIds).toEqual([7, 9]);
    expect(result.messages).toHaveLength(1);
    expect(attachmentsService.cloneToMessage).toHaveBeenCalledWith(
      transaction,
      user.id,
      12,
      91,
      expect.arrayContaining([expect.objectContaining({ storedName: "source-image.webp" })]),
    );
  });

  it("rejects recalling a message after the two-minute window", async () => {
    const prisma = {
      chatMessage: { findUnique: jest.fn(async () => ({
        id: 71,
        conversationId: 5,
        senderId: user.id,
        type: ChatMessageType.text,
        createdAt: new Date(Date.now() - 121_000),
        attachments: [],
        conversation: { friendship: { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted } },
      })) },
    };
    const service = createService(prisma);

    await expect(service.recallMessage(user, 71)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a message when both text and attachments are empty", async () => {
    const service = createService({});
    await expect(service.createMessage(user.id, 5, "", [])).rejects.toBeInstanceOf(BadRequestException);
  });

  it("counts friend requests separately from unread system notifications", async () => {
    const messageCount = jest.fn(async () => 2);
    const friendshipCount = jest.fn(async () => 3);
    const notificationCount = jest.fn(async () => 4);
    const service = createService({
      chatMessage: { count: messageCount },
      friendship: { count: friendshipCount },
      userNotification: { count: notificationCount },
    });

    await expect(service.getSummary(user)).resolves.toEqual({
      unreadMessages: 2,
      pendingFriendRequests: 3,
      unreadNotifications: 4,
    });
    expect(notificationCount).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        readAt: null,
        type: { not: "friend_request_received" },
      },
    });
  });

  it("marks only the current user's selected notifications as read", async () => {
    const updateMany = jest.fn(async () => ({ count: 2 }));
    const service = createService({ userNotification: { updateMany } });

    await expect(service.markSelectedNotificationsRead(user, [11, 12, 12])).resolves.toEqual({
      count: 2,
      readAt: expect.any(String),
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, id: { in: [11, 12] }, readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });

  it("deletes selected notifications only for the current user", async () => {
    const deleteMany = jest.fn(async () => ({ count: 2 }));
    const service = createService({ userNotification: { deleteMany } });

    await expect(service.deleteSelectedNotifications(user, [21, 22])).resolves.toEqual({ count: 2 });
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: user.id, id: { in: [21, 22] } },
    });
  });

  it("clears a notification channel without deleting pending friend-request notifications", async () => {
    const deleteMany = jest.fn(async () => ({ count: 3 }));
    const service = createService({ userNotification: { deleteMany } });

    await expect(service.clearNotifications(user, "system")).resolves.toEqual({ count: 3 });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        channel: "system",
        type: { not: "friend_request_received" },
      },
    });
  });

  it("hides a notification channel without deleting its notifications", async () => {
    const findFirst = jest.fn(async () => ({ id: 48 }));
    const stateUpsert = jest.fn(async () => ({}));
    const updateMany = jest.fn(async () => ({ count: 3 }));
    const service = createService({
      userNotification: { findFirst, updateMany },
      userNotificationChannelState: { upsert: stateUpsert },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    });

    await expect(service.hideNotificationChannel(user, "system")).resolves.toEqual({
      channel: "system",
      hiddenThroughNotificationId: 48,
      readAt: expect.any(String),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        channel: "system",
        type: { not: "friend_request_received" },
      },
      orderBy: [{ id: "desc" }],
      select: { id: true },
    });
    expect(stateUpsert).toHaveBeenCalledWith({
      where: { userId_channel: { userId: user.id, channel: "system" } },
      create: { userId: user.id, channel: "system", hiddenThroughNotificationId: 48 },
      update: { hiddenThroughNotificationId: 48 },
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: user.id,
        channel: "system",
        type: { not: "friend_request_received" },
        readAt: null,
      },
      data: { readAt: expect.any(Date) },
    });
  });

  it("reveals a hidden notification channel after a newer notification arrives", async () => {
    const service = createService({
      userNotification: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => ({ id: 49 })),
      },
      userNotificationChannelState: {
        findMany: jest.fn(async () => [{ channel: "subscription", hiddenThroughNotificationId: 48 }]),
      },
    });

    await expect(service.listNotifications(user, { limit: 20 })).resolves.toEqual({
      items: [],
      hasMore: false,
      hiddenChannels: [],
    });
  });
});
