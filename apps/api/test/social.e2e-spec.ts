import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { AuthenticatedUser } from "../src/auth/auth.types";
import {
  ChatMessageType,
  DirectMessagePolicy,
  FriendshipStatus,
  StrangerMessageRequestStatus,
} from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { SiteSettingsService } from "../src/site-settings/site-settings.service";
import { ReputationService } from "../src/reputation/reputation.service";
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

const siteSettingsService = {
  getNotificationSettings: jest.fn(async () => ({
    notifyArticleLiked: true,
    notifyArticleFavorited: true,
    notifyArticleCommented: true,
    notifyCommentReplied: true,
    notifyAuthorSubscribed: true,
    notifySubscriptionPublished: true,
    notifyFriendRequest: true,
    notifyCommentReport: true,
    notifySystem: true,
    templates: {
      articleLiked: "{actor} 点赞了《{article}》。",
      articleFavorited: "{actor} 收藏了《{article}》。",
      articleCommented: "{actor} 评论了《{article}》。",
      commentReplied: "{actor} 回复了你在《{article}》中的评论。",
      authorSubscribed: "{actor} 订阅了你。",
      subscriptionPublished: "{author} 发布了《{article}》。",
      friendRequest: "{actor} 向你发送了好友申请。",
      commentReportHandled: "你对《{article}》中评论的举报已{result}。",
      commentAuthorModerated: "你在《{article}》中的评论已被{result}。",
    },
  })),
  renderTemplate: jest.fn((template: string, variables: Record<string, string | number | null | undefined>) => {
    return Object.entries(variables).reduce((current, [key, value]) => {
      return current.replaceAll(`{${key}}`, String(value ?? ""));
    }, template);
  }),
};

const reputationService = {
  awardAuthorSubscribed: jest.fn(async () => true),
};

function createService(prisma: object) {
  return new SocialService(
    prisma as unknown as PrismaService,
    attachmentsService as unknown as ChatAttachmentsService,
    siteSettingsService as unknown as SiteSettingsService,
    reputationService as unknown as ReputationService,
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
      conversation: { findUnique: jest.fn(async () => null) },
      user: { findUnique: jest.fn(async () => ({ id: 8, status: "active", profileSettings: null })) },
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
      strangerMessageRequest: { updateMany: jest.fn(async () => ({ count: 1 })) },
      chatGroupInvitation: { updateMany: jest.fn(async () => ({ count: 1 })) },
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

  it("uses the default request policy when the recipient has no profile settings row", async () => {
    const createdAt = new Date("2026-08-19T01:00:00.000Z");
    const request = {
      id: 71,
      requesterId: user.id,
      recipientId: 8,
      conversationId: null,
      body: "想和你聊聊这篇文章",
      status: StrangerMessageRequestStatus.pending,
      respondedAt: null,
      createdAt,
      updatedAt: createdAt,
      requester: socialUser(user.id),
      recipient: socialUser(8),
    };
    const notificationCreate = jest.fn(async () => ({ id: 81 }));
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 8, status: "active", profileSettings: null })) },
      friendship: { findUnique: jest.fn(async () => null) },
      strangerMessageRequest: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => request),
      },
      userNotification: { create: notificationCreate },
    };

    await expect(createService(prisma).createStrangerMessageRequest(user, 8, request.body)).resolves.toMatchObject({
      id: 71,
      status: StrangerMessageRequestStatus.pending,
      direction: "outgoing",
    });
    expect(notificationCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: 8,
        strangerMessageRequestId: 71,
        actionUrl: "/messages?strangerRequests=1",
      }),
    }));
  });

  it("exposes the latest pending stranger request as an actionable interaction notification", async () => {
    const createdAt = new Date("2026-08-20T02:00:00.000Z");
    const notification = {
      id: 81,
      userId: user.id,
      actorId: 8,
      type: "system",
      channel: "interaction",
      title: "新的陌生消息请求",
      body: "用户8 向你发送了消息请求。",
      actionUrl: "/messages?strangerRequests=1",
      articleId: null,
      commentId: null,
      friendshipId: null,
      strangerMessageRequestId: 71,
      commentReportId: null,
      articleReportId: null,
      announcementId: null,
      aggregateCount: 1,
      readAt: null,
      openedAt: null,
      pushDeliveredAt: null,
      dedupeKey: null,
      createdAt,
      updatedAt: createdAt,
      actor: socialUser(8),
      friendship: null,
      strangerMessageRequest: {
        id: 71,
        recipientId: user.id,
        body: "想和你聊聊这篇文章",
        status: StrangerMessageRequestStatus.pending,
      },
      article: null,
      comment: null,
      commentReport: null,
      articleReport: null,
      announcement: null,
    };
    const findMany = jest.fn(async (args: { where?: { strangerMessageRequestId?: unknown } }) =>
      args.where?.strangerMessageRequestId
        ? [{ id: 81, userId: user.id, strangerMessageRequestId: 71 }]
        : [notification]);
    const service = createService({
      userNotification: { findMany },
      userNotificationChannelState: { findMany: jest.fn(async () => []) },
    });

    await expect(service.listNotifications(user, { limit: 20 })).resolves.toMatchObject({
      items: [{
        id: 81,
        context: {
          kind: "stranger_message_request",
          requestId: 71,
          requestBody: "想和你聊聊这篇文章",
          status: StrangerMessageRequestStatus.pending,
          actionable: true,
        },
      }],
    });
  });

  it("rejects stranger requests when the recipient only accepts friends", async () => {
    const prisma = {
      user: { findUnique: jest.fn(async () => ({
        id: 8,
        status: "active",
        profileSettings: { directMessagePolicy: DirectMessagePolicy.friends },
      })) },
      friendship: { findUnique: jest.fn(async () => null) },
    };

    await expect(createService(prisma).createStrangerMessageRequest(user, 8, "你好"))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it("marks the request notification read and notifies the requester when declined", async () => {
    const createdAt = new Date("2026-08-19T01:00:00.000Z");
    const existing = {
      id: 72,
      requesterId: 8,
      recipientId: user.id,
      conversationId: null,
      body: "你好",
      status: StrangerMessageRequestStatus.pending,
      respondedAt: null,
      createdAt,
      updatedAt: createdAt,
      requester: socialUser(8),
      recipient: socialUser(user.id),
    };
    const declined = { ...existing, status: StrangerMessageRequestStatus.declined, respondedAt: new Date() };
    const transaction = {
      strangerMessageRequest: { update: jest.fn(async () => declined) },
      userNotification: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async () => ({ id: 82 })),
      },
    };
    const prisma = {
      strangerMessageRequest: { findUnique: jest.fn(async () => existing) },
      friendship: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };

    await expect(createService(prisma).respondStrangerMessageRequest(user, 72, "declined"))
      .resolves.toMatchObject({ request: { status: StrangerMessageRequestStatus.declined }, conversation: null });
    expect(transaction.userNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: user.id, strangerMessageRequestId: 72, readAt: null }),
    }));
    expect(transaction.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 8, strangerMessageRequestId: 72, title: "陌生消息请求未通过" }),
    }));
  });

  it("creates an independent conversation and links the acceptance notification to it", async () => {
    const createdAt = new Date("2026-08-19T01:00:00.000Z");
    const existing = {
      id: 73,
      requesterId: 8,
      recipientId: user.id,
      conversationId: null,
      body: "你好",
      status: StrangerMessageRequestStatus.pending,
      respondedAt: null,
      createdAt,
      updatedAt: createdAt,
      requester: socialUser(8),
      recipient: socialUser(user.id),
    };
    const accepted = {
      ...existing,
      conversationId: 91,
      status: StrangerMessageRequestStatus.accepted,
      respondedAt: new Date(),
    };
    const directConversation = {
      id: 91,
      kind: "direct",
      friendship: null,
      directUserOneId: user.id,
      directUserTwoId: 8,
      directUserOne: socialUser(user.id),
      directUserTwo: socialUser(8),
      group: null,
      participantStates: [],
      updatedAt: new Date(),
    };
    const transaction = {
      conversation: { upsert: jest.fn(async () => ({ id: 91 })) },
      conversationParticipantState: { createMany: jest.fn(async () => ({ count: 2 })) },
      chatMessage: { create: jest.fn(async () => ({ id: 92 })) },
      strangerMessageRequest: { update: jest.fn(async () => accepted) },
      userNotification: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async () => ({ id: 83 })),
      },
    };
    const prisma = {
      strangerMessageRequest: {
        findUnique: jest.fn(async () => existing),
        findUniqueOrThrow: jest.fn(async () => accepted),
      },
      friendship: { findUnique: jest.fn(async () => null) },
      conversation: { findUnique: jest.fn(async () => directConversation) },
      chatMessage: { findFirst: jest.fn(async () => null), count: jest.fn(async () => 0) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };

    await expect(createService(prisma).respondStrangerMessageRequest(user, 73, "accepted"))
      .resolves.toMatchObject({
        request: { status: StrangerMessageRequestStatus.accepted, conversationId: 91 },
        conversation: { id: 91, canCall: false },
      });
    expect(transaction.chatMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conversationId: 91, senderId: 8, body: "你好" }),
    }));
    expect(transaction.userNotification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 8, actionUrl: "/messages?conversation=91" }),
    }));
  });

  it("creates an author subscription and an interaction notification", async () => {
    const createSubscription = jest.fn(async () => ({ subscriberId: user.id, authorId: 8 }));
    const createNotification = jest.fn(async () => ({ id: 41 }));
    const prisma = {
      user: { findUnique: jest.fn(async () => ({ id: 8, status: "active" })) },
      friendship: { findUnique: jest.fn(async () => null) },
      userSubscription: { findUnique: jest.fn(async () => null), create: createSubscription, count: jest.fn(async () => 3) },
      userNotification: { create: createNotification },
      $transaction: jest.fn(async (callback: (client: {
        userSubscription: { create: typeof createSubscription };
        userNotification: { create: typeof createNotification };
      }) => Promise<unknown>) => callback({
        userSubscription: { create: createSubscription },
        userNotification: { create: createNotification },
      })),
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

  it("delivers an accepted stranger-request conversation to both direct participants", async () => {
    const service = createService({
      conversation: { findUnique: jest.fn(async () => ({
        kind: "direct",
        directUserOneId: user.id,
        directUserTwoId: 8,
        friendship: null,
        group: null,
      })) },
      friendship: { findUnique: jest.fn(async () => null) },
    });

    await expect(service.getConversationDelivery(91)).resolves.toEqual({
      kind: "direct",
      participantIds: [user.id, 8],
    });
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

  it("includes unread friend-request notifications in the message badge total", async () => {
    const friendshipCount = jest.fn(async () => 3);
    const strangerRequestCount = jest.fn(async () => 1);
    const notificationCount = jest.fn(async () => 4);
    const service = createService({
      conversation: { findMany: jest.fn(async () => []) },
      friendship: { count: friendshipCount },
      strangerMessageRequest: { count: strangerRequestCount },
      userNotification: { count: notificationCount },
      userNotificationChannelState: { findMany: jest.fn(async () => []) },
    });

    await expect(service.getSummary(user)).resolves.toEqual({
      unreadMessages: 0,
      pendingFriendRequests: 3,
      pendingStrangerRequests: 1,
      unreadNotifications: 4,
    });
    expect(notificationCount).toHaveBeenCalledWith({ where: { userId: user.id, readAt: null } });
  });

  it("marks only the current user's selected notifications as read", async () => {
    const updateMany = jest.fn(async () => ({ count: 2 }));
    const service = createService({ userNotification: { updateMany } });

    await expect(service.markSelectedNotificationsRead(user, [11, 12, 12])).resolves.toEqual({
      count: 2,
      readAt: expect.any(String),
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: user.id, id: { in: [11, 12] }, OR: [{ readAt: null }, { openedAt: null }] },
      data: { readAt: expect.any(Date), openedAt: expect.any(Date) },
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
        findMany: jest.fn(async () => [{ channel: "subscription", hiddenThroughNotificationId: 48, pushEnabled: true }]),
      },
    });

    await expect(service.listNotifications(user, { limit: 20 })).resolves.toEqual({
      items: [],
      hasMore: false,
      hiddenChannels: [],
      channelStates: [
        { channel: "system", hiddenThroughNotificationId: 0, pushEnabled: true },
        { channel: "subscription", hiddenThroughNotificationId: 48, pushEnabled: true },
        { channel: "interaction", hiddenThroughNotificationId: 0, pushEnabled: true },
      ],
    });
  });
});
