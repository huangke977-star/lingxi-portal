import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { FriendshipStatus, Prisma } from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { ListMessagesQueryDto } from "./dto/social.dto";
import {
  ChatMessageResponse,
  ConversationResponse,
  FriendshipResponse,
  PublicProfileResponse,
  SocialSummaryResponse,
  SocialUserResponse,
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
} satisfies Prisma.ChatMessageInclude;

type MessageRecord = Prisma.ChatMessageGetPayload<{ include: typeof messageInclude }>;

@Injectable()
export class SocialService {
  constructor(private readonly prisma: PrismaService) {}

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
        relationship.status === FriendshipStatus.accepted
      )
        ? {
            id: relationship.id,
            status: relationship.status,
            direction: this.friendshipDirection(relationship, viewer.id),
          }
        : null,
    };
  }

  async listFriendships(user: AuthenticatedUser): Promise<{
    friends: FriendshipResponse[];
    incoming: FriendshipResponse[];
    outgoing: FriendshipResponse[];
  }> {
    const records = await this.prisma.friendship.findMany({
      where: {
        OR: [{ userOneId: user.id }, { userTwoId: user.id }],
        status: { in: [FriendshipStatus.pending, FriendshipStatus.accepted] },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: friendshipInclude,
    });
    const responses = records.map((record) => this.toFriendship(record, user.id));
    return {
      friends: responses.filter((item) => item.status === FriendshipStatus.accepted),
      incoming: responses.filter((item) => item.status === FriendshipStatus.pending && item.direction === "incoming"),
      outgoing: responses.filter((item) => item.status === FriendshipStatus.pending && item.direction === "outgoing"),
    };
  }

  async requestFriend(user: AuthenticatedUser, targetId: number): Promise<FriendshipResponse> {
    if (user.id === targetId) {
      throw new BadRequestException("不能添加自己为好友。");
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, status: true } });
    if (!target || target.status !== "active") {
      throw new NotFoundException("用户不存在或当前不可添加。");
    }
    const [userOneId, userTwoId] = this.normalizePair(user.id, targetId);
    const existing = await this.prisma.friendship.findUnique({
      where: { userOneId_userTwoId: { userOneId, userTwoId } },
      include: friendshipInclude,
    });
    if (existing?.status === FriendshipStatus.accepted) {
      return this.toFriendship(existing, user.id);
    }
    if (existing?.status === FriendshipStatus.pending) {
      if (existing.requestedById !== user.id) {
        throw new BadRequestException("对方已经向你发送好友申请，请先处理申请。");
      }
      return this.toFriendship(existing, user.id);
    }
    const record = await this.prisma.friendship.upsert({
      where: { userOneId_userTwoId: { userOneId, userTwoId } },
      create: { userOneId, userTwoId, requestedById: user.id },
      update: {
        requestedById: user.id,
        status: FriendshipStatus.pending,
        respondedAt: null,
        acceptedAt: null,
      },
      include: friendshipInclude,
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
    const record = await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: {
        status: status === "accepted" ? FriendshipStatus.accepted : FriendshipStatus.declined,
        respondedAt: now,
        acceptedAt: status === "accepted" ? now : null,
      },
      include: friendshipInclude,
    });
    return this.toFriendship(record, user.id);
  }

  async removeFriendship(user: AuthenticatedUser, friendshipId: number): Promise<{ success: true }> {
    await this.getFriendshipForParticipant(friendshipId, user.id);
    await this.prisma.friendship.update({
      where: { id: friendshipId },
      data: { status: FriendshipStatus.removed, respondedAt: new Date(), acceptedAt: null },
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
  ): Promise<ChatMessageResponse> {
    const body = rawBody.trim();
    if (!body) {
      throw new BadRequestException("消息内容不能为空。");
    }
    if (Array.from(body).length > 2000) {
      throw new BadRequestException("单条消息不能超过 2000 个字符。");
    }
    await this.assertConversationMember(conversationId, userId);
    const message = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.chatMessage.create({
        data: { conversationId, senderId: userId, body },
        include: messageInclude,
      });
      await transaction.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return created;
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
    const [unreadMessages, pendingFriendRequests] = await Promise.all([
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
    ]);
    return { unreadMessages, pendingFriendRequests };
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
      sender: this.toSocialUser(message.sender),
      readAt: message.readAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }
}
