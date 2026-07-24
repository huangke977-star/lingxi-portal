import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ChatMessageType,
  FriendshipStatus,
  Prisma,
  UserNotificationType,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { ChatAttachmentsService } from "./chat-attachments.service";
import { ListMessagesQueryDto, ListNotificationsQueryDto } from "./dto/social.dto";
import {
  ChatMessageResponse,
  ConversationResponse,
  FriendshipResponse,
  PublicProfileResponse,
  SocialSummaryResponse,
  SocialUserResponse,
  UserNotificationResponse,
} from "./social.types";

const socialUserSelect = {
  id: true,
  nickname: true,
  username: true,
  avatarStoredName: true,
  profileBio: true,
  isSuperAdmin: true,
  createdAt: true,
  status: true,
  role: { select: { code: true, name: true, level: true } },
} satisfies Prisma.UserSelect;

type SocialUserRecord = Prisma.UserGetPayload<{ select: typeof socialUserSelect }>;

const friendshipInclude = {
  userOne: { select: socialUserSelect },
  userTwo: { select: socialUserSelect },
} satisfies Prisma.FriendshipInclude;

type FriendshipRecord = Prisma.FriendshipGetPayload<{ include: typeof friendshipInclude }>;

const messageInclude = {
  sender: { select: socialUserSelect },
  attachments: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.ChatMessageInclude;

type MessageRecord = Prisma.ChatMessageGetPayload<{ include: typeof messageInclude }>;

const notificationInclude = {
  actor: { select: socialUserSelect },
  commentReport: {
    select: {
      comment: {
        select: {
          id: true,
          body: true,
          status: true,
          article: { select: { id: true, title: true, slug: true } },
        },
      },
    },
  },
} satisfies Prisma.UserNotificationInclude;

type NotificationRecord = Prisma.UserNotificationGetPayload<{ include: typeof notificationInclude }>;

@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatAttachmentsService: ChatAttachmentsService,
  ) {}

  async getProfile(viewer: AuthenticatedUser, userId: number): Promise<PublicProfileResponse> {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: socialUserSelect });
    if (!target || target.status !== "active") {
      throw new NotFoundException("用户不存在或当前不可查看。");
    }
    const relationship = viewer.id === userId
      ? null
      : await this.findFriendship(viewer.id, userId);
    return {
      ...this.toSocialUser(target),
      isSelf: viewer.id === userId,
      relationship: relationship && (
        relationship.status === FriendshipStatus.pending ||
        relationship.status === FriendshipStatus.accepted ||
        (relationship.status === FriendshipStatus.blocked && relationship.blockedById === viewer.id)
      )
        ? {
            id: relationship.id,
            status: relationship.status,
            direction: this.friendshipDirection(relationship, viewer.id),
            note: relationship.requestNote ?? null,
          }
        : null,
    };
  }

  async listFriendships(user: AuthenticatedUser): Promise<{
    friends: FriendshipResponse[];
    incoming: FriendshipResponse[];
    outgoing: FriendshipResponse[];
    blocked: FriendshipResponse[];
  }> {
    const records = await this.prisma.friendship.findMany({
      where: {
        OR: [{ userOneId: user.id }, { userTwoId: user.id }],
        status: { in: [FriendshipStatus.pending, FriendshipStatus.accepted, FriendshipStatus.blocked] },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: friendshipInclude,
    });
    const responses = records
      .filter((record) => record.status !== FriendshipStatus.blocked || record.blockedById === user.id)
      .map((record) => this.toFriendship(record, user.id));
    return {
      friends: responses.filter((item) => item.status === FriendshipStatus.accepted),
      incoming: responses.filter((item) => item.status === FriendshipStatus.pending && item.direction === "incoming"),
      outgoing: responses.filter((item) => item.status === FriendshipStatus.pending && item.direction === "outgoing"),
      blocked: responses.filter((item) => item.status === FriendshipStatus.blocked),
    };
  }

  async requestFriend(
    user: AuthenticatedUser,
    targetId: number,
    rawNote?: string,
  ): Promise<FriendshipResponse> {
    if (user.id === targetId) {
      throw new BadRequestException("不能添加自己为好友。");
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, status: true } });
    if (!target || target.status !== "active") {
      throw new NotFoundException("用户不存在或当前不可添加。");
    }
    const [userOneId, userTwoId] = this.normalizePair(user.id, targetId);
    const requestNote = rawNote?.trim() || null;
    const existing = await this.prisma.friendship.findUnique({
      where: { userOneId_userTwoId: { userOneId, userTwoId } },
      include: friendshipInclude,
    });
    if (existing?.status === FriendshipStatus.accepted) {
      return this.toFriendship(existing, user.id);
    }
    if (existing?.status === FriendshipStatus.blocked) {
      throw new ForbiddenException(
        existing.blockedById === user.id
          ? "请先从黑名单中解除该用户。"
          : "当前无法向该用户发送好友申请。",
      );
    }
    if (existing?.status === FriendshipStatus.pending) {
      if (existing.requestedById !== user.id) {
        throw new BadRequestException("对方已经向你发送好友申请，请先处理申请。");
      }
      if (existing.requestNote !== requestNote) {
        const updated = await this.prisma.friendship.update({
          where: { id: existing.id },
          data: { requestNote },
          include: friendshipInclude,
        });
        return this.toFriendship(updated, user.id);
      }
      return this.toFriendship(existing, user.id);
    }
    const record = await this.prisma.$transaction(async (transaction) => {
      const friendship = await transaction.friendship.upsert({
        where: { userOneId_userTwoId: { userOneId, userTwoId } },
        create: { userOneId, userTwoId, requestedById: user.id, requestNote },
        update: {
          requestedById: user.id,
          requestNote,
          status: FriendshipStatus.pending,
          blockedById: null,
          respondedAt: null,
          acceptedAt: null,
        },
        include: friendshipInclude,
      });
      await transaction.userNotification.create({
        data: {
          userId: targetId,
          actorId: user.id,
          type: UserNotificationType.friend_request_received,
          title: "新的好友申请",
          body: `${user.nickname || user.username} 向你发送了好友申请。`,
          actionUrl: `/messages?friendshipId=${friendship.id}`,
          friendshipId: friendship.id,
        },
      });
      return friendship;
    });
    return this.toFriendship(record, user.id);
  }

  async respondFriendRequest(
    user: AuthenticatedUser,
    friendshipId: number,
    status: "accepted" | "declined",
  ): Promise<FriendshipResponse> {
    const existing = await this.getFriendshipForParticipant(friendshipId, user.id);
    if (existing.status !== FriendshipStatus.pending || existing.requestedById === user.id) {
      throw new ForbiddenException("这条好友申请不能由当前账号处理。");
    }
    const now = new Date();
    const record = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.friendship.update({
        where: { id: friendshipId },
        data: {
          status: status === "accepted" ? FriendshipStatus.accepted : FriendshipStatus.declined,
          blockedById: null,
          respondedAt: now,
          acceptedAt: status === "accepted" ? now : null,
        },
        include: friendshipInclude,
      });
      await transaction.userNotification.updateMany({
        where: {
          userId: user.id,
          friendshipId,
          type: UserNotificationType.friend_request_received,
          readAt: null,
        },
        data: { readAt: now },
      });
      if (status === "accepted") {
        const conversation = await transaction.conversation.upsert({
          where: { friendshipId },
          create: { friendshipId },
          update: { updatedAt: now },
          select: { id: true },
        });
        await transaction.chatMessage.create({
          data: {
            conversationId: conversation.id,
            senderId: user.id,
            body: "你们已经成为好友，可以开始聊天了。",
            type: ChatMessageType.system,
          },
        });
      }
      await transaction.userNotification.create({
        data: {
          userId: existing.requestedById,
          actorId: user.id,
          type: status === "accepted"
            ? UserNotificationType.friend_request_accepted
            : UserNotificationType.friend_request_declined,
          title: status === "accepted" ? "好友申请已通过" : "好友申请未通过",
          body: `${user.nickname || user.username}${status === "accepted" ? "接受" : "拒绝"}了你的好友申请。`,
          actionUrl: "/messages",
          friendshipId,
        },
      });
      return updated;
    });
    return this.toFriendship(record, user.id);
  }

  async removeFriendship(user: AuthenticatedUser, friendshipId: number): Promise<{ success: true }> {
    const friendship = await this.getFriendshipForParticipant(friendshipId, user.id);
    if (friendship.status !== FriendshipStatus.accepted) {
      throw new BadRequestException("当前关系不是可删除的好友关系。");
    }
    await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: FriendshipStatus.removed, blockedById: null, respondedAt: new Date(), acceptedAt: null },
    });
    return { success: true };
  }

  async blockFriendship(user: AuthenticatedUser, friendshipId: number): Promise<{ success: true }> {
    const friendship = await this.getFriendshipForParticipant(friendshipId, user.id);
    if (friendship.status === FriendshipStatus.blocked) {
      if (friendship.blockedById === user.id) return { success: true };
      throw new ForbiddenException("当前好友关系不可操作。");
    }
    if (friendship.status !== FriendshipStatus.accepted) {
      throw new BadRequestException("只能拉黑当前好友。当前关系不是好友状态。");
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.friendship.update({
        where: { id: friendshipId },
        data: {
          status: FriendshipStatus.blocked,
          blockedById: user.id,
          respondedAt: now,
          acceptedAt: null,
        },
      }),
      this.prisma.userNotification.updateMany({
        where: {
          friendshipId,
          type: UserNotificationType.friend_request_received,
          readAt: null,
        },
        data: { readAt: now },
      }),
    ]);
    return { success: true };
  }

  async unblockFriendship(user: AuthenticatedUser, friendshipId: number): Promise<{ success: true }> {
    const friendship = await this.getFriendshipForParticipant(friendshipId, user.id);
    if (friendship.status !== FriendshipStatus.blocked || friendship.blockedById !== user.id) {
      throw new ForbiddenException("只能解除自己设置的拉黑关系。");
    }
    await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: {
        status: FriendshipStatus.removed,
        blockedById: null,
        respondedAt: new Date(),
        acceptedAt: null,
      },
    });
    return { success: true };
  }

  async getOrCreateConversation(user: AuthenticatedUser, targetId: number): Promise<ConversationResponse> {
    const friendship = await this.findFriendship(user.id, targetId);
    if (!friendship || friendship.status !== FriendshipStatus.accepted) {
      throw new ForbiddenException("成为好友后才能发起聊天。");
    }
    const conversation = await this.prisma.conversation.upsert({
      where: { friendshipId: friendship.id },
      create: { friendshipId: friendship.id },
      update: {},
      select: { id: true },
    });
    return this.getConversation(user.id, conversation.id);
  }

  async listConversations(user: AuthenticatedUser): Promise<{ items: ConversationResponse[] }> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        friendship: {
          status: FriendshipStatus.accepted,
          OR: [{ userOneId: user.id }, { userTwoId: user.id }],
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        friendship: { include: friendshipInclude },
        messages: { orderBy: [{ id: "desc" }], take: 1, include: messageInclude },
      },
    });
    return {
      items: await Promise.all(conversations.map(async (conversation) => {
        const counterpart = this.counterpart(conversation.friendship, user.id);
        const unreadCount = await this.prisma.chatMessage.count({
          where: { conversationId: conversation.id, senderId: { not: user.id }, readAt: null },
        });
        return {
          id: conversation.id,
          user: this.toSocialUser(counterpart),
          lastMessage: conversation.messages[0] ? this.toMessage(conversation.messages[0]) : null,
          unreadCount,
          updatedAt: conversation.updatedAt.toISOString(),
        };
      })),
    };
  }

  async listMessages(
    user: AuthenticatedUser,
    conversationId: number,
    query: ListMessagesQueryDto,
  ): Promise<{ items: ChatMessageResponse[]; hasMore: boolean }> {
    await this.assertConversationMember(conversationId, user.id);
    const messages = await this.prisma.chatMessage.findMany({
      where: {
        conversationId,
        ...(query.beforeId ? { id: { lt: query.beforeId } } : {}),
      },
      orderBy: [{ id: "desc" }],
      take: query.limit + 1,
      include: messageInclude,
    });
    const hasMore = messages.length > query.limit;
    return {
      items: messages.slice(0, query.limit).reverse().map((message) => this.toMessage(message)),
      hasMore,
    };
  }

  async createMessage(
    userId: number,
    conversationId: number,
    rawBody: string,
    attachmentIds: number[] = [],
  ): Promise<ChatMessageResponse> {
    const body = rawBody.trim();
    if (!body && !attachmentIds.length) {
      throw new BadRequestException("消息文字和附件不能同时为空。");
    }
    if (Array.from(body).length > 2000) {
      throw new BadRequestException("单条消息不能超过 2000 个字符。");
    }
    await this.assertConversationMember(conversationId, userId);
    const message = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.chatMessage.create({
        data: {
          conversationId,
          senderId: userId,
          body,
          type: body
            ? attachmentIds.length ? ChatMessageType.mixed : ChatMessageType.text
            : ChatMessageType.attachment,
        },
        select: { id: true },
      });
      await this.chatAttachmentsService.bindToMessage(
        transaction,
        userId,
        conversationId,
        attachmentIds,
        created.id,
      );
      await transaction.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return transaction.chatMessage.findUniqueOrThrow({ where: { id: created.id }, include: messageInclude });
    });
    return this.toMessage(message);
  }

  async markConversationRead(
    userId: number,
    conversationId: number,
  ): Promise<{ count: number; readAt: string; participantIds: number[] }> {
    const friendship = await this.assertConversationMember(conversationId, userId);
    const readAt = new Date();
    const result = await this.prisma.chatMessage.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt },
    });
    return {
      count: result.count,
      readAt: readAt.toISOString(),
      participantIds: [friendship.userOneId, friendship.userTwoId],
    };
  }

  async getConversationParticipantIds(conversationId: number): Promise<number[]> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { friendship: { select: { userOneId: true, userTwoId: true, status: true } } },
    });
    if (!conversation || conversation.friendship.status !== FriendshipStatus.accepted) {
      throw new NotFoundException("会话不存在或当前不可使用。");
    }
    return [conversation.friendship.userOneId, conversation.friendship.userTwoId];
  }

  async getSummary(user: AuthenticatedUser): Promise<SocialSummaryResponse> {
    const friendshipWhere: Prisma.FriendshipWhereInput = {
      status: FriendshipStatus.accepted,
      OR: [{ userOneId: user.id }, { userTwoId: user.id }],
    };
    const [unreadMessages, pendingFriendRequests, unreadNotifications] = await Promise.all([
      this.prisma.chatMessage.count({
        where: {
          senderId: { not: user.id },
          readAt: null,
          conversation: { friendship: friendshipWhere },
        },
      }),
      this.prisma.friendship.count({
        where: {
          status: FriendshipStatus.pending,
          requestedById: { not: user.id },
          OR: [{ userOneId: user.id }, { userTwoId: user.id }],
        },
      }),
      this.prisma.userNotification.count({
        where: {
          userId: user.id,
          readAt: null,
          type: { not: UserNotificationType.friend_request_received },
        },
      }),
    ]);
    return { unreadMessages, pendingFriendRequests, unreadNotifications };
  }

  async listNotifications(
    user: AuthenticatedUser,
    query: ListNotificationsQueryDto,
  ): Promise<{ items: UserNotificationResponse[]; hasMore: boolean }> {
    const notifications = await this.prisma.userNotification.findMany({
      where: {
        userId: user.id,
        ...(query.beforeId ? { id: { lt: query.beforeId } } : {}),
      },
      orderBy: [{ id: "desc" }],
      take: query.limit + 1,
      include: notificationInclude,
    });
    return {
      items: notifications.slice(0, query.limit).map((notification) => this.toNotification(notification)),
      hasMore: notifications.length > query.limit,
    };
  }

  async markNotificationRead(user: AuthenticatedUser, id: number): Promise<UserNotificationResponse> {
    const result = await this.prisma.userNotification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    const notification = await this.prisma.userNotification.findFirst({
      where: { id, userId: user.id },
      include: notificationInclude,
    });
    if (!notification) {
      throw new NotFoundException("通知不存在。");
    }
    void result;
    return this.toNotification(notification);
  }

  async markAllNotificationsRead(user: AuthenticatedUser): Promise<{ count: number; readAt: string }> {
    const readAt = new Date();
    const result = await this.prisma.userNotification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt },
    });
    return { count: result.count, readAt: readAt.toISOString() };
  }

  private async getConversation(userId: number, conversationId: number): Promise<ConversationResponse> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        friendship: { include: friendshipInclude },
        messages: { orderBy: [{ id: "desc" }], take: 1, include: messageInclude },
      },
    });
    if (!conversation || conversation.friendship.status !== FriendshipStatus.accepted) {
      throw new NotFoundException("会话不存在。");
    }
    const counterpart = this.counterpart(conversation.friendship, userId);
    const unreadCount = await this.prisma.chatMessage.count({
      where: { conversationId, senderId: { not: userId }, readAt: null },
    });
    return {
      id: conversation.id,
      user: this.toSocialUser(counterpart),
      lastMessage: conversation.messages[0] ? this.toMessage(conversation.messages[0]) : null,
      unreadCount,
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private async assertConversationMember(conversationId: number, userId: number) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { friendship: { select: { userOneId: true, userTwoId: true, status: true } } },
    });
    if (
      !conversation ||
      conversation.friendship.status !== FriendshipStatus.accepted ||
      ![conversation.friendship.userOneId, conversation.friendship.userTwoId].includes(userId)
    ) {
      throw new ForbiddenException("没有访问这个会话的权限。");
    }
    return conversation.friendship;
  }

  private async findFriendship(userId: number, targetId: number): Promise<FriendshipRecord | null> {
    const [userOneId, userTwoId] = this.normalizePair(userId, targetId);
    return this.prisma.friendship.findUnique({
      where: { userOneId_userTwoId: { userOneId, userTwoId } },
      include: friendshipInclude,
    });
  }

  private async getFriendshipForParticipant(id: number, userId: number): Promise<FriendshipRecord> {
    const friendship = await this.prisma.friendship.findUnique({ where: { id }, include: friendshipInclude });
    if (!friendship || ![friendship.userOneId, friendship.userTwoId].includes(userId)) {
      throw new NotFoundException("好友关系不存在。");
    }
    return friendship;
  }

  private normalizePair(left: number, right: number): [number, number] {
    return left < right ? [left, right] : [right, left];
  }

  private friendshipDirection(record: FriendshipRecord, userId: number): FriendshipResponse["direction"] {
    if (record.status === FriendshipStatus.blocked) return "blocked";
    if (record.status === FriendshipStatus.accepted) return "accepted";
    return record.requestedById === userId ? "outgoing" : "incoming";
  }

  private counterpart(record: FriendshipRecord, userId: number): SocialUserRecord {
    if (record.userOneId === userId) return record.userTwo;
    if (record.userTwoId === userId) return record.userOne;
    throw new ForbiddenException("当前账号不属于这段用户关系。");
  }

  private toFriendship(record: FriendshipRecord, userId: number): FriendshipResponse {
    return {
      id: record.id,
      status: record.status,
      direction: this.friendshipDirection(record, userId),
      note: record.requestNote ?? null,
      user: this.toSocialUser(this.counterpart(record, userId)),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toSocialUser(user: SocialUserRecord): SocialUserResponse {
    return {
      id: user.id,
      nickname: user.nickname || user.username,
      username: user.username,
      avatarUrl: user.avatarStoredName ? `/auth/avatars/${user.avatarStoredName}` : null,
      profileBio: user.profileBio,
      isSuperAdmin: user.isSuperAdmin,
      role: {
        code: user.role.code,
        name: user.isSuperAdmin ? "超级管理员" : user.role.name,
        level: user.role.level,
      },
      createdAt: user.createdAt.toISOString(),
    };
  }

  private toMessage(message: MessageRecord): ChatMessageResponse {
    return {
      id: message.id,
      conversationId: message.conversationId,
      body: message.body,
      type: message.type,
      attachments: message.attachments.map((attachment) => this.chatAttachmentsService.toResponse(attachment)),
      sender: this.toSocialUser(message.sender),
      readAt: message.readAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private toNotification(notification: NotificationRecord): UserNotificationResponse {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      actionUrl: notification.actionUrl,
      friendshipId: notification.friendshipId,
      commentReportId: notification.commentReportId,
      actor: notification.actor ? this.toSocialUser(notification.actor) : null,
      context: notification.commentReport ? {
        kind: "comment_report",
        commentId: notification.commentReport.comment.id,
        commentBody: notification.commentReport.comment.body,
        commentStatus: notification.commentReport.comment.status,
        article: notification.commentReport.comment.article,
      } : null,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
