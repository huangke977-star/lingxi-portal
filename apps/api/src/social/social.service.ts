import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  ArticleStatus,
  ArticleVisibility,
  ChatGroupMemberRole,
  ChatGroupMemberStatus,
  ChatGroupInvitationStatus,
  ChatGroupJoinRequestStatus,
  ChatGroupReportStatus,
  ChatGroupStatus,
  ChatMessageType,
  ConversationKind,
  FriendshipStatus,
  Prisma,
  UserNotificationChannel,
  UserNotificationType,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { SiteSettingsService } from "../site-settings/site-settings.service";
import { ReputationService } from "../reputation/reputation.service";
import { ChatAttachmentsService } from "./chat-attachments.service";
import {
  ListMessagesQueryDto,
  ListNotificationsQueryDto,
  SearchSocialUsersQueryDto,
  UpdateConversationSettingsDto,
  UpdateNotificationChannelSettingsDto,
} from "./dto/social.dto";
import {
  ChatMessageResponse,
  ChatGroupSummaryResponse,
  ConversationResponse,
  FriendshipResponse,
  PublicProfileResponse,
  SocialSummaryResponse,
  SocialUserResponse,
  SocialUserSearchResult,
  NotificationChannelStateResponse,
  UserNotificationResponse,
} from "./social.types";

const MESSAGE_RECALL_WINDOW_MS = 2 * 60 * 1000;

const socialUserSelect = {
  id: true,
  nickname: true,
  username: true,
  avatarStoredName: true,
  profileBio: true,
  isSuperAdmin: true,
  isAdministrator: true,
  createdAt: true,
  status: true,
  role: { select: { code: true, name: true, level: true } },
  profileSettings: {
    select: {
      showBio: true,
      showJoinedAt: true,
      showStats: true,
      showFollowingCount: true,
      showPinnedContent: true,
    },
  },
} satisfies Prisma.UserSelect;

type SocialUserRecord = Prisma.UserGetPayload<{ select: typeof socialUserSelect }>;

const conversationGroupInclude = {
  owner: { select: socialUserSelect },
  members: {
    include: { user: { select: socialUserSelect } },
    orderBy: [{ joinedAt: "asc" as const }, { userId: "asc" as const }],
  },
  joinRequests: {
    where: { status: "pending" as const },
    select: { id: true },
  },
  reports: {
    where: { status: "pending" as const },
    select: { id: true },
  },
} satisfies Prisma.ChatGroupInclude;

type ConversationGroupRecord = Prisma.ChatGroupGetPayload<{ include: typeof conversationGroupInclude }>;

interface ConversationMembership {
  kind: ConversationKind;
  participantIds: number[];
  friendship: { userOneId: number; userTwoId: number } | null;
  group: {
    id: number;
    role: ChatGroupMemberRole;
    alias: string | null;
    mutedUntil: Date | null;
    isBanned: boolean;
    bannedUntil: Date | null;
    banReason: string | null;
  } | null;
}

const friendshipInclude = {
  userOne: { select: socialUserSelect },
  userTwo: { select: socialUserSelect },
} satisfies Prisma.FriendshipInclude;

type FriendshipRecord = Prisma.FriendshipGetPayload<{ include: typeof friendshipInclude }>;

const messageInclude = {
  sender: { select: socialUserSelect },
  attachments: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
  callSession: { select: { id: true, type: true, status: true, durationSeconds: true } },
} satisfies Prisma.ChatMessageInclude;

type MessageRecord = Prisma.ChatMessageGetPayload<{ include: typeof messageInclude }>;

const notificationInclude = {
  actor: { select: socialUserSelect },
  friendship: {
    select: {
      status: true,
      requestedById: true,
      requestNote: true,
    },
  },
  article: { select: { id: true, title: true, slug: true } },
  comment: {
    select: {
      id: true,
      body: true,
      status: true,
      article: { select: { id: true, title: true, slug: true } },
    },
  },
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
  articleReport: {
    select: {
      id: true,
      status: true,
      article: { select: { id: true, title: true, slug: true } },
    },
  },
  announcement: { select: { id: true, title: true, summary: true } },
} satisfies Prisma.UserNotificationInclude;

type NotificationRecord = Prisma.UserNotificationGetPayload<{ include: typeof notificationInclude }>;
type NotificationContext = NonNullable<UserNotificationResponse["context"]>;

@Injectable()
export class SocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatAttachmentsService: ChatAttachmentsService,
    private readonly siteSettingsService: SiteSettingsService,
    private readonly reputationService: ReputationService,
  ) {}

  async getProfile(viewer: AuthenticatedUser, userId: number): Promise<PublicProfileResponse> {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: socialUserSelect });
    return this.buildProfile(target, viewer);
  }

  async getProfileByUsername(
    rawUsername: string,
    viewer: AuthenticatedUser | null,
  ): Promise<PublicProfileResponse> {
    const username = rawUsername.trim();
    const target = await this.prisma.user.findUnique({ where: { username }, select: socialUserSelect });
    return this.buildProfile(target, viewer);
  }

  private async buildProfile(
    target: SocialUserRecord | null,
    viewer: AuthenticatedUser | null,
  ): Promise<PublicProfileResponse> {
    if (!target || target.status !== "active") {
      throw new NotFoundException("用户不存在或当前不可查看。");
    }
    const isSelf = viewer?.id === target.id;
    const settings = target.profileSettings ?? {
      showBio: true,
      showJoinedAt: true,
      showStats: true,
      showFollowingCount: true,
      showPinnedContent: true,
    };
    const showBio = isSelf || settings.showBio;
    const showJoinedAt = isSelf || settings.showJoinedAt;
    const showStats = isSelf || settings.showStats;
    const showFollowingCount = isSelf || settings.showFollowingCount;
    const [relationship, subscription, subscriberCount, followingCount, publicArticleStats] = await Promise.all([
      !viewer || viewer.id === target.id ? Promise.resolve(null) : this.findFriendship(viewer.id, target.id),
      !viewer || viewer.id === target.id
        ? Promise.resolve(null)
        : this.prisma.userSubscription.findUnique({
            where: { subscriberId_authorId: { subscriberId: viewer.id, authorId: target.id } },
            select: { authorId: true },
          }),
      showStats
        ? this.prisma.userSubscription.count({ where: { authorId: target.id } })
        : Promise.resolve(null),
      showFollowingCount
        ? this.prisma.userSubscription.count({ where: { subscriberId: target.id } })
        : Promise.resolve(null),
      showStats
        ? this.prisma.article.aggregate({
            where: {
              authorId: target.id,
              status: ArticleStatus.published,
              visibility: ArticleVisibility.public,
            },
            _count: { _all: true },
            _sum: { likeCount: true, viewCount: true },
          })
        : Promise.resolve(null),
    ]);
    return {
      ...this.toSocialUser(target),
      profileBio: showBio ? target.profileBio : null,
      createdAt: showJoinedAt ? target.createdAt.toISOString() : null,
      isSelf,
      subscribed: Boolean(subscription),
      subscriberCount: showStats ? subscriberCount : null,
      followingCount: showFollowingCount ? followingCount : null,
      publicArticleCount: showStats ? publicArticleStats?._count._all ?? 0 : null,
      receivedLikeCount: showStats ? publicArticleStats?._sum.likeCount ?? 0 : null,
      publicViewCount: showStats ? publicArticleStats?._sum.viewCount ?? 0 : null,
      visibleFields: {
        bio: showBio,
        joinedAt: showJoinedAt,
        stats: showStats,
        followingCount: showFollowingCount,
        pinnedContent: isSelf || settings.showPinnedContent,
      },
      relationship: viewer && relationship && (
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

  async subscribe(user: AuthenticatedUser, authorId: number): Promise<{ subscribed: true; subscriberCount: number }> {
    if (user.id === authorId) throw new BadRequestException("不能订阅自己。");
    const author = await this.prisma.user.findUnique({ where: { id: authorId }, select: { id: true, status: true } });
    if (!author || author.status !== "active") throw new NotFoundException("用户不存在或当前不可订阅。");
    const friendship = await this.findFriendship(user.id, authorId);
    if (friendship?.status === FriendshipStatus.blocked) throw new ForbiddenException("当前无法订阅该用户。");
    const existing = await this.prisma.userSubscription.findUnique({
      where: { subscriberId_authorId: { subscriberId: user.id, authorId } },
      select: { authorId: true },
    });
    if (!existing) {
      const notificationSettings = await this.siteSettingsService.getNotificationSettings();
      await this.prisma.$transaction(async (transaction) => {
        await transaction.userSubscription.create({ data: { subscriberId: user.id, authorId } });
        await this.reputationService.awardAuthorSubscribed(transaction, authorId, user.id);
        if (notificationSettings.notifyAuthorSubscribed) {
          await transaction.userNotification.create({ data: {
            userId: authorId,
            actorId: user.id,
            type: UserNotificationType.author_subscribed,
            channel: UserNotificationChannel.interaction,
            title: "新的订阅者",
            body: this.siteSettingsService.renderTemplate(notificationSettings.templates.authorSubscribed, {
              actor: user.nickname || user.username,
            }),
          } });
        }
      });
    }
    return { subscribed: true, subscriberCount: await this.prisma.userSubscription.count({ where: { authorId } }) };
  }

  async unsubscribe(user: AuthenticatedUser, authorId: number): Promise<{ subscribed: false; subscriberCount: number }> {
    await this.prisma.userSubscription.deleteMany({ where: { subscriberId: user.id, authorId } });
    return { subscribed: false, subscriberCount: await this.prisma.userSubscription.count({ where: { authorId } }) };
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

  async searchUsers(
    user: AuthenticatedUser,
    query: SearchSocialUsersQueryDto,
  ): Promise<{ items: SocialUserSearchResult[] }> {
    const keyword = query.q.trim();
    if (keyword.length < 2) {
      throw new BadRequestException("搜索关键词至少需要 2 个字符。");
    }
    const candidates = await this.prisma.user.findMany({
      where: {
        id: { not: user.id },
        status: "active",
        OR: [
          { username: { contains: keyword } },
          { nickname: { contains: keyword } },
        ],
      },
      take: Math.min(query.limit * 2, 40),
      select: socialUserSelect,
    });
    const sorted = candidates.sort((left, right) => {
      const leftUsername = left.username.toLocaleLowerCase();
      const rightUsername = right.username.toLocaleLowerCase();
      const target = keyword.toLocaleLowerCase();
      const score = (candidate: SocialUserRecord) => {
        const username = candidate.username.toLocaleLowerCase();
        const nickname = candidate.nickname.toLocaleLowerCase();
        if (username === target) return 0;
        if (username.startsWith(target)) return 1;
        if (nickname.startsWith(target)) return 2;
        return 3;
      };
      return score(left) - score(right) || leftUsername.localeCompare(rightUsername);
    }).slice(0, query.limit);
    const candidateIds = sorted.map((candidate) => candidate.id);
    const relationships = candidateIds.length
      ? await this.prisma.friendship.findMany({
          where: {
            OR: [
              { userOneId: user.id, userTwoId: { in: candidateIds } },
              { userTwoId: user.id, userOneId: { in: candidateIds } },
            ],
          },
          include: friendshipInclude,
        })
      : [];
    const relationshipByUserId = new Map<number, FriendshipRecord>();
    relationships.forEach((relationship) => {
      const targetId = relationship.userOneId === user.id
        ? relationship.userTwoId
        : relationship.userOneId;
      relationshipByUserId.set(targetId, relationship);
    });
    return {
      items: sorted.map((candidate) => {
        const relationship = relationshipByUserId.get(candidate.id) ?? null;
        const visibleRelationship = relationship && (
          relationship.status === FriendshipStatus.pending ||
          relationship.status === FriendshipStatus.accepted ||
          (relationship.status === FriendshipStatus.blocked && relationship.blockedById === user.id)
        ) ? {
            id: relationship.id,
            status: relationship.status,
            direction: this.friendshipDirection(relationship, user.id),
            note: relationship.requestNote ?? null,
          } : null;
        return {
          ...this.toSocialUser(candidate),
          relationship: visibleRelationship,
          canRequest: !relationship || relationship.status === FriendshipStatus.removed || relationship.status === FriendshipStatus.declined,
        };
      }),
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
    const notificationSettings = await this.siteSettingsService.getNotificationSettings();
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
          body: this.siteSettingsService.renderTemplate(notificationSettings.templates.friendRequest, {
            actor: user.nickname || user.username,
            note: requestNote,
          }),
          actionUrl: `/messages?friendshipId=${friendship.id}`,
          friendshipId: friendship.id,
          pushDeliveredAt: notificationSettings.notifyFriendRequest ? null : new Date(),
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
    const notificationSettings = await this.siteSettingsService.getNotificationSettings();
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
        await transaction.conversationParticipantState.createMany({
          data: [
            { conversationId: conversation.id, userId: existing.userOneId },
            { conversationId: conversation.id, userId: existing.userTwoId },
          ],
          skipDuplicates: true,
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
      if (notificationSettings.notifyFriendRequest) {
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
      }
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
      this.prisma.userSubscription.deleteMany({
        where: { OR: [
          { subscriberId: friendship.userOneId, authorId: friendship.userTwoId },
          { subscriberId: friendship.userTwoId, authorId: friendship.userOneId },
        ] },
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
    const conversation = await this.prisma.$transaction(async (transaction) => {
      const record = await transaction.conversation.upsert({
        where: { friendshipId: friendship.id },
        create: { friendshipId: friendship.id },
        update: {},
        select: { id: true },
      });
      await transaction.conversationParticipantState.createMany({
        data: [
          { conversationId: record.id, userId: friendship.userOneId },
          { conversationId: record.id, userId: friendship.userTwoId },
        ],
        skipDuplicates: true,
      });
      await transaction.conversationParticipantState.update({
        where: { conversationId_userId: { conversationId: record.id, userId: user.id } },
        data: { hidden: false },
      });
      return record;
    });
    return this.getConversation(user.id, conversation.id);
  }

  async listConversations(user: AuthenticatedUser): Promise<{ items: ConversationResponse[] }> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        OR: [
          {
            friendship: {
              status: FriendshipStatus.accepted,
              OR: [{ userOneId: user.id }, { userTwoId: user.id }],
            },
          },
          {
            group: {
              status: ChatGroupStatus.active,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              members: { some: { userId: user.id, status: ChatGroupMemberStatus.active } },
            },
          },
        ],
        participantStates: { none: { userId: user.id, hidden: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      include: {
        friendship: { include: friendshipInclude },
        group: { include: conversationGroupInclude },
        participantStates: { where: { userId: user.id }, take: 1 },
      },
    });
    return {
      items: await Promise.all(conversations.map(async (conversation) => {
        const clearedBeforeMessageId = conversation.participantStates[0]?.clearedBeforeMessageId ?? null;
        const visibleWhere = this.visibleMessageWhere(user.id, conversation.id, clearedBeforeMessageId);
        const lastReadMessageId = conversation.participantStates[0]?.lastReadMessageId ?? null;
        const [lastMessage, unreadCount] = await Promise.all([
          this.prisma.chatMessage.findFirst({
            where: visibleWhere,
            orderBy: [{ id: "desc" }],
            include: messageInclude,
          }),
          this.prisma.chatMessage.count({
            where: conversation.group
              ? {
                  AND: [visibleWhere, { senderId: { not: user.id } }, ...(lastReadMessageId ? [{ id: { gt: lastReadMessageId } }] : [])],
                }
              : { ...visibleWhere, senderId: { not: user.id }, readAt: null },
          }),
        ]);
        if (conversation.friendship) {
          const counterpart = this.counterpart(conversation.friendship, user.id);
          return {
            id: conversation.id,
            kind: ConversationKind.direct,
            user: this.toSocialUser(counterpart),
            group: null,
            lastMessage: lastMessage ? this.toMessage(lastMessage) : null,
            unreadCount,
            muted: conversation.participantStates[0]?.muted ?? false,
            updatedAt: conversation.updatedAt.toISOString(),
          };
        }
        if (!conversation.group) throw new NotFoundException("会话关联数据不存在。");
        return {
          id: conversation.id,
          kind: conversation.kind,
          user: this.toSocialUser(conversation.group.owner),
          group: this.toGroupSummary(conversation.group, user.id),
          lastMessage: lastMessage ? this.toMessage(lastMessage) : null,
          unreadCount,
          muted: conversation.participantStates[0]?.muted ?? false,
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
    const membership = await this.assertConversationMember(conversationId, user.id);
    const state = await this.prisma.conversationParticipantState.findUnique({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      select: { clearedBeforeMessageId: true },
    });
    const messages = await this.prisma.chatMessage.findMany({
      where: query.beforeId
        ? {
            AND: [
              this.visibleMessageWhere(user.id, conversationId, state?.clearedBeforeMessageId ?? null),
              { id: { lt: query.beforeId } },
            ],
          }
        : this.visibleMessageWhere(user.id, conversationId, state?.clearedBeforeMessageId ?? null),
      orderBy: [{ id: "desc" }],
      take: query.limit + 1,
      include: messageInclude,
    });
    const hasMore = messages.length > query.limit;
    const aliases = membership.group
      ? new Map((await this.prisma.chatGroupMember.findMany({
          where: { groupId: membership.group.id, userId: { in: messages.map((message) => message.senderId) } },
          select: { userId: true, alias: true },
        })).map((member) => [member.userId, member.alias]))
      : new Map<number, string | null>();
    return {
      items: messages.slice(0, query.limit).reverse().map((message) => this.toMessage(message, aliases.get(message.senderId) ?? undefined)),
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
    const membership = await this.assertConversationMember(conversationId, userId);
    if (membership.group?.mutedUntil && membership.group.mutedUntil > new Date()) {
      throw new ForbiddenException(`你已被禁言至 ${membership.group.mutedUntil.toLocaleString("zh-CN", { hour12: false })}。`);
    }
    this.assertGroupCanSend(membership.group);
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
      await transaction.conversationParticipantState.createMany({
        data: membership.participantIds.map((participantId) => ({ conversationId, userId: participantId })),
        skipDuplicates: true,
      });
      await transaction.conversationParticipantState.updateMany({
        where: { conversationId },
        data: { hidden: false },
      });
      await transaction.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return transaction.chatMessage.findUniqueOrThrow({ where: { id: created.id }, include: messageInclude });
    });
    return this.toMessage(message, membership.group?.alias ?? undefined);
  }

  async forwardMessages(
    userId: number,
    sourceConversationId: number,
    targetConversationId: number,
    rawMessageIds: number[],
  ): Promise<{ messages: ChatMessageResponse[]; participantIds: number[] }> {
    const messageIds = this.normalizeMessageIds(rawMessageIds);
    if (messageIds.length > 20) throw new BadRequestException("单次最多转发 20 条消息。");
    if (sourceConversationId === targetConversationId) throw new BadRequestException("请选择其他好友进行转发。");
    const sourceMembership = await this.assertConversationMember(sourceConversationId, userId);
    this.assertGroupCanSend(sourceMembership.group);
    const targetMembership = await this.assertConversationMember(targetConversationId, userId);
    if (targetMembership.group?.mutedUntil && targetMembership.group.mutedUntil > new Date()) {
      throw new ForbiddenException("你当前在目标群聊中被禁言。");
    }
    this.assertGroupCanSend(targetMembership.group);
    const sourceState = await this.prisma.conversationParticipantState.findUnique({
      where: { conversationId_userId: { conversationId: sourceConversationId, userId } },
      select: { clearedBeforeMessageId: true },
    });
    const sourceMessages = await this.prisma.chatMessage.findMany({
      where: {
        AND: [
          this.visibleMessageWhere(userId, sourceConversationId, sourceState?.clearedBeforeMessageId ?? null),
          { id: { in: messageIds }, type: { not: ChatMessageType.system } },
        ],
      },
      orderBy: [{ id: "asc" }],
      include: messageInclude,
    });
    if (sourceMessages.length !== messageIds.length) {
      throw new NotFoundException("部分消息不存在、已删除或不能转发。");
    }
    const totalAttachmentBytes = sourceMessages.reduce(
      (total, message) => total + message.attachments.reduce((sum, attachment) => sum + attachment.sizeBytes, 0),
      0,
    );
    if (totalAttachmentBytes > 100 * 1024 * 1024) {
      throw new BadRequestException("单次转发的附件总大小不能超过 100MB。");
    }

    const copiedStoredNames: string[] = [];
    try {
      const forwarded = await this.prisma.$transaction(async (transaction) => {
        const records: MessageRecord[] = [];
        for (const source of sourceMessages) {
          const created = await transaction.chatMessage.create({
            data: {
              conversationId: targetConversationId,
              senderId: userId,
              body: source.body,
              type: source.attachments.length
                ? source.body ? ChatMessageType.mixed : ChatMessageType.attachment
                : ChatMessageType.text,
            },
            select: { id: true },
          });
          copiedStoredNames.push(...await this.chatAttachmentsService.cloneToMessage(
            transaction,
            userId,
            targetConversationId,
            created.id,
            source.attachments,
          ));
          records.push(await transaction.chatMessage.findUniqueOrThrow({
            where: { id: created.id },
            include: messageInclude,
          }));
        }
        await transaction.conversationParticipantState.createMany({
          data: targetMembership.participantIds.map((participantId) => ({
            conversationId: targetConversationId,
            userId: participantId,
          })),
          skipDuplicates: true,
        });
        await transaction.conversationParticipantState.updateMany({
          where: { conversationId: targetConversationId },
          data: { hidden: false },
        });
        await transaction.conversation.update({ where: { id: targetConversationId }, data: { updatedAt: new Date() } });
        return records;
      });
      return {
        messages: forwarded.map((message) => this.toMessage(message)),
        participantIds: targetMembership.participantIds,
      };
    } catch (error) {
      await this.chatAttachmentsService.deleteStoredFiles(copiedStoredNames).catch(() => undefined);
      throw error;
    }
  }

  async markConversationRead(
    userId: number,
    conversationId: number,
  ): Promise<{ count: number; readAt: string; participantIds: number[] }> {
    const membership = await this.assertConversationMember(conversationId, userId);
    const readAt = new Date();
    const state = await this.prisma.conversationParticipantState.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { lastReadMessageId: true },
    });
    const latest = await this.prisma.chatMessage.findFirst({
      where: { conversationId },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    const count = membership.group
      ? await this.prisma.chatMessage.count({
          where: {
            conversationId,
            senderId: { not: userId },
            ...(state?.lastReadMessageId ? { id: { gt: state.lastReadMessageId } } : {}),
          },
        })
      : (await this.prisma.chatMessage.updateMany({
          where: { conversationId, senderId: { not: userId }, readAt: null },
          data: { readAt },
        })).count;
    await this.prisma.conversationParticipantState.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, lastReadMessageId: latest?.id ?? null },
      update: { lastReadMessageId: latest?.id ?? null },
    });
    return {
      count,
      readAt: readAt.toISOString(),
      participantIds: membership.participantIds,
    };
  }

  async updateConversationSettings(
    user: AuthenticatedUser,
    conversationId: number,
    dto: UpdateConversationSettingsDto,
  ): Promise<ConversationResponse> {
    await this.assertConversationMember(conversationId, user.id);
    await this.prisma.conversationParticipantState.upsert({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      create: { conversationId, userId: user.id, muted: dto.muted },
      update: { muted: dto.muted },
    });
    return this.getConversation(user.id, conversationId);
  }

  async clearConversation(
    userId: number,
    conversationId: number,
  ): Promise<{ conversationId: number; participantIds: number[] }> {
    const membership = await this.assertConversationMember(conversationId, userId);
    const latestMessage = await this.prisma.chatMessage.findFirst({
      where: { conversationId },
      orderBy: [{ id: "desc" }],
      select: { id: true },
    });
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.conversationParticipantState.upsert({
        where: { conversationId_userId: { conversationId, userId } },
        create: {
          conversationId,
          userId,
          hidden: false,
          clearedBeforeMessageId: latestMessage?.id ?? null,
        },
        update: {
          hidden: false,
          clearedBeforeMessageId: latestMessage?.id ?? null,
        },
      }),
      this.prisma.chatMessage.updateMany({
        where: { conversationId, senderId: { not: userId }, readAt: null },
        data: { readAt: now },
      }),
    ]);
    return {
      conversationId,
      participantIds: membership.participantIds,
    };
  }

  async hideConversation(
    userId: number,
    conversationId: number,
  ): Promise<{ conversationId: number; participantIds: number[] }> {
    const membership = await this.assertConversationMember(conversationId, userId);
    const latestMessage = await this.prisma.chatMessage.findFirst({
      where: { conversationId },
      orderBy: [{ id: "desc" }],
      select: { id: true },
    });
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.conversationParticipantState.upsert({
        where: { conversationId_userId: { conversationId, userId } },
        create: {
          conversationId,
          userId,
          hidden: true,
          clearedBeforeMessageId: latestMessage?.id ?? null,
        },
        update: {
          hidden: true,
          clearedBeforeMessageId: latestMessage?.id ?? null,
        },
      }),
      this.prisma.chatMessage.updateMany({
        where: { conversationId, senderId: { not: userId }, readAt: null },
        data: { readAt: now },
      }),
    ]);
    return {
      conversationId,
      participantIds: membership.participantIds,
    };
  }

  async deleteMessagesForUser(
    userId: number,
    conversationId: number,
    rawMessageIds: number[],
  ): Promise<{ conversationId: number; messageIds: number[] }> {
    await this.assertConversationMember(conversationId, userId);
    const messageIds = this.normalizeMessageIds(rawMessageIds);
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId, id: { in: messageIds } },
      select: { id: true, senderId: true, readAt: true },
    });
    if (messages.length !== messageIds.length) {
      throw new NotFoundException("部分消息不存在或不属于当前会话。");
    }
    await this.prisma.$transaction([
      this.prisma.chatMessageDeletion.createMany({
        data: messageIds.map((messageId) => ({ messageId, userId })),
        skipDuplicates: true,
      }),
      this.prisma.chatMessage.updateMany({
        where: {
          id: { in: messages.filter((message) => message.senderId !== userId && !message.readAt).map((message) => message.id) },
        },
        data: { readAt: new Date() },
      }),
    ]);
    return { conversationId, messageIds };
  }

  async deleteMessagesForEveryone(
    userId: number,
    conversationId: number,
    rawMessageIds: number[],
  ): Promise<{ conversationId: number; messageIds: number[]; participantIds: number[] }> {
    const membership = await this.assertConversationMember(conversationId, userId);
    const messageIds = this.normalizeMessageIds(rawMessageIds);
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { createdAt: true },
    });
    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId, id: { in: messageIds } },
      select: {
        id: true,
        senderId: true,
        attachments: { select: { storedName: true } },
      },
    });
    if (messages.length !== messageIds.length) {
      throw new NotFoundException("部分消息不存在或不属于当前会话。");
    }
    if (
      membership.group &&
      membership.group.role === ChatGroupMemberRole.member &&
      messages.some((message) => message.senderId !== userId)
    ) {
      throw new ForbiddenException("普通群成员只能双向删除自己发送的消息。");
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatMessage.deleteMany({
        where: { conversationId, id: { in: messageIds } },
      });
      const latestMessage = await transaction.chatMessage.findFirst({
        where: { conversationId },
        orderBy: [{ id: "desc" }],
        select: { createdAt: true },
      });
      await transaction.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: latestMessage?.createdAt ?? conversation?.createdAt ?? new Date() },
      });
    });
    await this.chatAttachmentsService.deleteStoredFiles(
      messages.flatMap((message) => message.attachments.map((attachment) => attachment.storedName)),
    );
    return {
      conversationId,
      messageIds,
      participantIds: membership.participantIds,
    };
  }

  async recallMessage(
    user: AuthenticatedUser,
    messageId: number,
  ): Promise<{
    conversationId: number;
    messageId: number;
    replacement: ChatMessageResponse;
    participantIds: number[];
  }> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: {
        attachments: { select: { storedName: true } },
        conversation: {
          select: {
            friendship: { select: { userOneId: true, userTwoId: true, status: true } },
            group: { select: { id: true } },
          },
        },
      },
    });
    if (!message) {
      throw new NotFoundException("消息不存在或当前不可撤回。");
    }
    if (message.senderId !== user.id || message.type === ChatMessageType.system) {
      throw new ForbiddenException("只能撤回自己发送的普通消息。");
    }
    if (Date.now() - message.createdAt.getTime() > MESSAGE_RECALL_WINDOW_MS) {
      throw new BadRequestException("消息发送超过 2 分钟，不能撤回。");
    }
    const membership = await this.assertConversationMember(message.conversationId, user.id);
    const replacement = await this.prisma.$transaction(async (transaction) => {
      await transaction.chatMessage.delete({ where: { id: message.id } });
      const created = await transaction.chatMessage.create({
        data: {
          conversationId: message.conversationId,
          senderId: user.id,
          body: `${user.nickname || user.username} 撤回了一条消息。`,
          type: ChatMessageType.system,
        },
        include: messageInclude,
      });
      await transaction.conversation.update({
        where: { id: message.conversationId },
        data: { updatedAt: created.createdAt },
      });
      return created;
    });
    await this.chatAttachmentsService.deleteStoredFiles(
      message.attachments.map((attachment) => attachment.storedName),
    );
    return {
      conversationId: message.conversationId,
      messageId: message.id,
      replacement: this.toMessage(replacement),
      participantIds: membership.participantIds,
    };
  }

  async getConversationParticipantIds(conversationId: number): Promise<number[]> {
    return (await this.getConversationDelivery(conversationId)).participantIds;
  }

  async getConversationDelivery(conversationId: number): Promise<{ kind: ConversationKind; participantIds: number[] }> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        kind: true,
        friendship: { select: { userOneId: true, userTwoId: true, status: true } },
        group: {
          select: {
            status: true,
            expiresAt: true,
            members: { where: { status: ChatGroupMemberStatus.active }, select: { userId: true } },
          },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException("会话不存在或当前不可使用。");
    }
    if (conversation.friendship?.status === FriendshipStatus.accepted) {
      return { kind: ConversationKind.direct, participantIds: [conversation.friendship.userOneId, conversation.friendship.userTwoId] };
    }
    if (
      conversation.group?.status === ChatGroupStatus.active &&
      (!conversation.group.expiresAt || conversation.group.expiresAt > new Date())
    ) {
      return { kind: conversation.kind, participantIds: conversation.group.members.map((member) => member.userId) };
    }
    throw new NotFoundException("会话不存在或当前不可使用。");
  }

  async listActiveGroupConversationIds(userId: number): Promise<number[]> {
    const groups = await this.prisma.chatGroup.findMany({
      where: {
        status: ChatGroupStatus.active,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        members: { some: { userId, status: ChatGroupMemberStatus.active } },
      },
      select: { conversationId: true },
    });
    return groups.map((group) => group.conversationId);
  }

  async getMessageForBroadcast(messageId: number): Promise<ChatMessageResponse> {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      include: messageInclude,
    });
    if (!message) throw new NotFoundException("消息不存在。");
    return this.toMessage(message);
  }

  async getSummary(user: AuthenticatedUser): Promise<SocialSummaryResponse> {
    const pushDisabledChannels = await this.listPushDisabledNotificationChannels(user.id);
    const [unreadMessages, pendingFriendRequests, unreadNotifications] = await Promise.all([
      (async () => {
        const [directUnread, groupStates] = await Promise.all([
          this.prisma.chatMessage.count({
            where: {
              senderId: { not: user.id },
              readAt: null,
              deletions: { none: { userId: user.id } },
              conversation: {
                friendship: {
                  status: FriendshipStatus.accepted,
                  OR: [{ userOneId: user.id }, { userTwoId: user.id }],
                },
                participantStates: { none: { userId: user.id, OR: [{ hidden: true }, { muted: true }] } },
              },
            },
          }),
          this.prisma.conversationParticipantState.findMany({
            where: {
              userId: user.id,
              hidden: false,
              muted: false,
              conversation: {
                group: {
                  status: ChatGroupStatus.active,
                  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
                  members: { some: { userId: user.id, status: ChatGroupMemberStatus.active } },
                },
              },
            },
            select: { conversationId: true, lastReadMessageId: true, clearedBeforeMessageId: true },
          }),
        ]);
        const groupUnread = await Promise.all(groupStates.map((state) => this.prisma.chatMessage.count({
          where: {
            conversationId: state.conversationId,
            senderId: { not: user.id },
            deletions: { none: { userId: user.id } },
            id: { gt: Math.max(state.lastReadMessageId ?? 0, state.clearedBeforeMessageId ?? 0) },
          },
        })));
        return directUnread + groupUnread.reduce((total, count) => total + count, 0);
      })(),
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
          ...(pushDisabledChannels.length ? { channel: { notIn: pushDisabledChannels } } : {}),
        },
      }),
    ]);
    return { unreadMessages, pendingFriendRequests, unreadNotifications };
  }

  async listNotifications(
    user: AuthenticatedUser,
    query: ListNotificationsQueryDto,
  ): Promise<{
    items: UserNotificationResponse[];
    hasMore: boolean;
    hiddenChannels: UserNotificationChannel[];
    channelStates: NotificationChannelStateResponse[];
  }> {
    const [notifications, hiddenChannels, channelStates] = await Promise.all([
      this.prisma.userNotification.findMany({
        where: {
          userId: user.id,
          ...(query.channel ? { channel: query.channel as UserNotificationChannel } : {}),
          ...(query.beforeId ? { id: { lt: query.beforeId } } : {}),
        },
        orderBy: [{ id: "desc" }],
        take: query.limit + 1,
        include: notificationInclude,
      }),
      this.listHiddenNotificationChannels(user.id),
      this.listNotificationChannelStates(user.id),
    ]);
    const visibleNotifications = notifications.slice(0, query.limit);
    const contexts = await this.buildNotificationContexts(visibleNotifications);
    return {
      items: visibleNotifications.map((notification) => this.toNotification(notification, contexts.get(notification.id))),
      hasMore: notifications.length > query.limit,
      hiddenChannels,
      channelStates,
    };
  }

  async markNotificationRead(user: AuthenticatedUser, id: number): Promise<UserNotificationResponse> {
    const openedAt = new Date();
    const result = await this.prisma.userNotification.updateMany({
      where: { id, userId: user.id, OR: [{ readAt: null }, { openedAt: null }] },
      data: { readAt: openedAt, openedAt },
    });
    const notification = await this.prisma.userNotification.findFirst({
      where: { id, userId: user.id },
      include: notificationInclude,
    });
    if (!notification) {
      throw new NotFoundException("通知不存在。");
    }
    void result;
    const contexts = await this.buildNotificationContexts([notification]);
    return this.toNotification(notification, contexts.get(notification.id));
  }

  async markAllNotificationsRead(user: AuthenticatedUser, channel?: "system" | "subscription" | "interaction"): Promise<{ count: number; readAt: string }> {
    const readAt = new Date();
    const result = await this.prisma.userNotification.updateMany({
      where: { userId: user.id, readAt: null, ...(channel ? { channel: channel as UserNotificationChannel } : {}) },
      data: { readAt },
    });
    return { count: result.count, readAt: readAt.toISOString() };
  }

  async markSelectedNotificationsRead(user: AuthenticatedUser, notificationIds: number[]): Promise<{ count: number; readAt: string }> {
    const ids = this.normalizeNotificationIds(notificationIds);
    const readAt = new Date();
    const result = await this.prisma.userNotification.updateMany({
      where: { userId: user.id, id: { in: ids }, OR: [{ readAt: null }, { openedAt: null }] },
      data: { readAt, openedAt: readAt },
    });
    return { count: result.count, readAt: readAt.toISOString() };
  }

  async deleteNotification(user: AuthenticatedUser, id: number): Promise<{ count: number }> {
    const result = await this.prisma.userNotification.deleteMany({ where: { id, userId: user.id } });
    if (!result.count) throw new NotFoundException("通知不存在。");
    return { count: result.count };
  }

  async deleteSelectedNotifications(user: AuthenticatedUser, notificationIds: number[]): Promise<{ count: number }> {
    const ids = this.normalizeNotificationIds(notificationIds);
    const result = await this.prisma.userNotification.deleteMany({
      where: { userId: user.id, id: { in: ids } },
    });
    return { count: result.count };
  }

  async clearNotifications(
    user: AuthenticatedUser,
    channel?: "system" | "subscription" | "interaction",
  ): Promise<{ count: number }> {
    if (!channel) throw new BadRequestException("请选择要清空的通知频道。");
    const result = await this.prisma.userNotification.deleteMany({
      where: {
        userId: user.id,
        channel: channel as UserNotificationChannel,
        type: { not: UserNotificationType.friend_request_received },
      },
    });
    return { count: result.count };
  }

  async hideNotificationChannel(
    user: AuthenticatedUser,
    rawChannel: string,
  ): Promise<{ channel: UserNotificationChannel; hiddenThroughNotificationId: number; readAt: string }> {
    const channel = this.normalizeNotificationChannel(rawChannel);
    const contentWhere = this.notificationChannelContentWhere(user.id, channel);
    const latestNotification = await this.prisma.userNotification.findFirst({
      where: contentWhere,
      orderBy: [{ id: "desc" }],
      select: { id: true },
    });
    const hiddenThroughNotificationId = latestNotification?.id ?? 0;
    const readAt = new Date();
    await this.prisma.$transaction([
      this.prisma.userNotificationChannelState.upsert({
        where: { userId_channel: { userId: user.id, channel } },
        create: { userId: user.id, channel, hiddenThroughNotificationId },
        update: { hiddenThroughNotificationId },
      }),
      this.prisma.userNotification.updateMany({
        where: { ...contentWhere, readAt: null },
        data: { readAt },
      }),
    ]);
    return { channel, hiddenThroughNotificationId, readAt: readAt.toISOString() };
  }

  async updateNotificationChannelSettings(
    user: AuthenticatedUser,
    rawChannel: string,
    dto: UpdateNotificationChannelSettingsDto,
  ): Promise<NotificationChannelStateResponse> {
    const channel = this.normalizeNotificationChannel(rawChannel);
    const state = await this.prisma.userNotificationChannelState.upsert({
      where: { userId_channel: { userId: user.id, channel } },
      create: { userId: user.id, channel, pushEnabled: dto.pushEnabled },
      update: { pushEnabled: dto.pushEnabled },
      select: { channel: true, hiddenThroughNotificationId: true, pushEnabled: true },
    });
    return this.toNotificationChannelState(state);
  }

  private normalizeNotificationIds(notificationIds: number[]): number[] {
    const ids = [...new Set(notificationIds.filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length || ids.length > 100) {
      throw new BadRequestException("请选择 1 至 100 条通知。");
    }
    return ids;
  }

  private async listHiddenNotificationChannels(userId: number): Promise<UserNotificationChannel[]> {
    const states = await this.prisma.userNotificationChannelState.findMany({
      where: { userId },
      select: { channel: true, hiddenThroughNotificationId: true },
    });
    const hiddenChannels = await Promise.all(states.map(async (state) => {
      const newerNotification = await this.prisma.userNotification.findFirst({
        where: {
          ...this.notificationChannelContentWhere(userId, state.channel),
          id: { gt: state.hiddenThroughNotificationId },
        },
        select: { id: true },
      });
      return newerNotification ? null : state.channel;
    }));
    return hiddenChannels.filter((channel): channel is UserNotificationChannel => channel !== null);
  }

  private async listNotificationChannelStates(userId: number): Promise<NotificationChannelStateResponse[]> {
    const states = await this.prisma.userNotificationChannelState.findMany({
      where: { userId },
      select: { channel: true, hiddenThroughNotificationId: true, pushEnabled: true },
    });
    const byChannel = new Map(states.map((state) => [state.channel, state]));
    return Object.values(UserNotificationChannel).map((channel) =>
      this.toNotificationChannelState(byChannel.get(channel) ?? {
        channel,
        hiddenThroughNotificationId: 0,
        pushEnabled: true,
      }),
    );
  }

  private async listPushDisabledNotificationChannels(userId: number): Promise<UserNotificationChannel[]> {
    const states = await this.prisma.userNotificationChannelState.findMany({
      where: { userId, pushEnabled: false },
      select: { channel: true },
    });
    return states.map((state) => state.channel);
  }

  private notificationChannelContentWhere(
    userId: number,
    channel: UserNotificationChannel,
  ): Prisma.UserNotificationWhereInput {
    return {
      userId,
      channel,
      ...(channel === UserNotificationChannel.system
        ? { type: { not: UserNotificationType.friend_request_received } }
        : {}),
    };
  }

  private normalizeNotificationChannel(channel: string): UserNotificationChannel {
    if (!Object.values(UserNotificationChannel).includes(channel as UserNotificationChannel)) {
      throw new BadRequestException("通知频道无效。");
    }
    return channel as UserNotificationChannel;
  }

  private async getConversation(userId: number, conversationId: number): Promise<ConversationResponse> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        friendship: { include: friendshipInclude },
        group: { include: conversationGroupInclude },
        participantStates: { where: { userId }, take: 1 },
      },
    });
    if (!conversation) {
      throw new NotFoundException("会话不存在。");
    }
    await this.assertConversationMember(conversationId, userId);
    const participantState = conversation.participantStates[0];
    const clearedBeforeMessageId = participantState?.clearedBeforeMessageId ?? null;
    const visibleWhere = this.visibleMessageWhere(userId, conversationId, clearedBeforeMessageId);
    const [lastMessage, unreadCount] = await Promise.all([
      this.prisma.chatMessage.findFirst({
        where: visibleWhere,
        orderBy: [{ id: "desc" }],
        include: messageInclude,
      }),
      this.prisma.chatMessage.count({
        where: conversation.group
          ? {
              AND: [
                visibleWhere,
                { senderId: { not: userId } },
                ...(participantState?.lastReadMessageId ? [{ id: { gt: participantState.lastReadMessageId } }] : []),
              ],
            }
          : { ...visibleWhere, senderId: { not: userId }, readAt: null },
      }),
    ]);
    if (conversation.friendship) {
      const counterpart = this.counterpart(conversation.friendship, userId);
      return {
        id: conversation.id,
        kind: ConversationKind.direct,
        user: this.toSocialUser(counterpart),
        group: null,
        lastMessage: lastMessage ? this.toMessage(lastMessage) : null,
        unreadCount,
        muted: participantState?.muted ?? false,
        updatedAt: conversation.updatedAt.toISOString(),
      };
    }
    if (!conversation.group) throw new NotFoundException("会话关联数据不存在。");
    return {
      id: conversation.id,
      kind: conversation.kind,
      user: this.toSocialUser(conversation.group.owner),
      group: this.toGroupSummary(conversation.group, userId),
      lastMessage: lastMessage ? this.toMessage(lastMessage) : null,
      unreadCount,
      muted: participantState?.muted ?? false,
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private async assertConversationMember(conversationId: number, userId: number): Promise<ConversationMembership> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        kind: true,
        friendship: { select: { userOneId: true, userTwoId: true, status: true } },
        group: {
          select: {
            id: true,
            status: true,
            expiresAt: true,
            isBanned: true,
            bannedUntil: true,
            banReason: true,
            members: {
              where: { status: ChatGroupMemberStatus.active },
              select: { userId: true, role: true, alias: true, mutedUntil: true },
            },
          },
        },
      },
    });
    if (!conversation) throw new ForbiddenException("没有访问这个会话的权限。");
    if (
      conversation.friendship?.status === FriendshipStatus.accepted &&
      [conversation.friendship.userOneId, conversation.friendship.userTwoId].includes(userId)
    ) {
      return {
        kind: ConversationKind.direct,
        participantIds: [conversation.friendship.userOneId, conversation.friendship.userTwoId],
        friendship: {
          userOneId: conversation.friendship.userOneId,
          userTwoId: conversation.friendship.userTwoId,
        },
        group: null,
      };
    }
    const groupMember = conversation.group?.members.find((member) => member.userId === userId);
    if (
      conversation.group?.status === ChatGroupStatus.active &&
      (!conversation.group.expiresAt || conversation.group.expiresAt > new Date()) &&
      groupMember
    ) {
      return {
        kind: conversation.kind,
        participantIds: conversation.group.members.map((member) => member.userId),
        friendship: null,
        group: {
          id: conversation.group.id,
          role: groupMember.role,
          alias: groupMember.alias,
          mutedUntil: groupMember.mutedUntil,
          isBanned: conversation.group.isBanned,
          bannedUntil: conversation.group.bannedUntil,
          banReason: conversation.group.banReason,
        },
      };
    }
    throw new ForbiddenException("没有访问这个会话的权限。");
  }

  private async findFriendship(userId: number, targetId: number): Promise<FriendshipRecord | null> {
    const [userOneId, userTwoId] = this.normalizePair(userId, targetId);
    return this.prisma.friendship.findUnique({
      where: { userOneId_userTwoId: { userOneId, userTwoId } },
      include: friendshipInclude,
    });
  }

  private assertGroupCanSend(group: ConversationMembership["group"]): void {
    if (!group?.isBanned) return;
    if (group.bannedUntil && group.bannedUntil <= new Date()) return;
    const until = group.bannedUntil
      ? `至 ${group.bannedUntil.toLocaleString("zh-CN", { hour12: false })}`
      : "，当前为永久封禁";
    throw new ForbiddenException(`该群聊已被站点封禁${until}，暂时不能发送消息或文件。`);
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

  private normalizeMessageIds(rawMessageIds: number[]): number[] {
    const messageIds = Array.from(new Set(rawMessageIds.filter((id) => Number.isInteger(id) && id > 0)));
    if (!messageIds.length || messageIds.length > 100) {
      throw new BadRequestException("请选择 1 至 100 条消息。");
    }
    return messageIds;
  }

  private visibleMessageWhere(
    userId: number,
    conversationId: number,
    clearedBeforeMessageId: number | null,
  ): Prisma.ChatMessageWhereInput {
    return {
      conversationId,
      ...(clearedBeforeMessageId ? { id: { gt: clearedBeforeMessageId } } : {}),
      deletions: { none: { userId } },
    };
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
      isAdministrator: user.isAdministrator,
      role: {
        code: user.role.code,
        name: user.role.name,
        level: user.role.level,
      },
      createdAt: user.createdAt.toISOString(),
    };
  }

  private toGroupSummary(group: ConversationGroupRecord, userId: number): ChatGroupSummaryResponse {
    const member = group.members.find((item) => item.userId === userId && item.status === ChatGroupMemberStatus.active) ?? null;
    return {
      id: group.id,
      conversationId: group.conversationId,
      owner: this.toSocialUser(group.owner),
      name: group.name,
      avatarUrl: group.avatarStoredName ? `/social/groups/avatars/${group.avatarStoredName}` : group.avatarUrl,
      announcement: group.announcement,
      joinMode: group.joinMode,
      memberLimit: group.memberLimit,
      memberCount: group.members.filter((item) => item.status === ChatGroupMemberStatus.active).length,
      temporary: group.temporary,
      expiresAt: group.expiresAt?.toISOString() ?? null,
      status: group.status,
      isBanned: group.isBanned,
      bannedUntil: group.bannedUntil?.toISOString() ?? null,
      banReason: group.isBanned ? group.banReason : null,
      currentMemberRole: member?.role ?? null,
      currentAlias: member?.alias ?? null,
      canManage: Boolean(member && member.role !== ChatGroupMemberRole.member),
      canModerate: false,
      canInvite: Boolean(member && (member.role !== ChatGroupMemberRole.member || group.membersCanInvite)),
      membersCanInvite: group.membersCanInvite,
      pendingJoinRequestCount: member && member.role !== ChatGroupMemberRole.member ? group.joinRequests.length : 0,
      pendingReportCount: member && member.role !== ChatGroupMemberRole.member ? group.reports.length : 0,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  private toMessage(message: MessageRecord, senderDisplayName?: string): ChatMessageResponse {
    return {
      id: message.id,
      conversationId: message.conversationId,
      body: message.body,
      type: message.type,
      attachments: message.attachments.map((attachment) => this.chatAttachmentsService.toResponse(attachment)),
      call: message.callSession ? {
        id: message.callSession.id,
        type: message.callSession.type,
        status: message.callSession.status,
        durationSeconds: message.callSession.durationSeconds,
      } : null,
      sender: this.toSocialUser(message.sender),
      senderDisplayName: senderDisplayName || message.sender.nickname || message.sender.username,
      readAt: message.readAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private toNotification(notification: NotificationRecord, enrichedContext?: NotificationContext): UserNotificationResponse {
    const groupContext = this.groupNotificationContext(notification.actionUrl, notification.title);
    return {
      id: notification.id,
      type: notification.type,
      channel: notification.channel,
      title: notification.title,
      body: notification.body,
      actionUrl: notification.actionUrl,
      friendshipId: notification.friendshipId,
      commentReportId: notification.commentReportId,
      articleReportId: notification.articleReportId,
      announcementId: notification.announcementId,
      actor: notification.actor ? this.toSocialUser(notification.actor) : null,
      context: notification.articleReport ? {
        kind: "article_report",
        reportId: notification.articleReport.id,
        status: notification.articleReport.status,
        article: notification.articleReport.article,
      } : notification.commentReport ? {
        kind: "comment_report",
        commentId: notification.commentReport.comment.id,
        commentBody: notification.commentReport.comment.body,
        commentStatus: notification.commentReport.comment.status,
        article: notification.commentReport.comment.article,
      } : notification.comment ? {
        kind: "article_comment",
        commentId: notification.comment.id,
        commentBody: notification.comment.body,
        commentStatus: notification.comment.status,
        article: notification.comment.article,
      } : notification.article ? { kind: "article", article: notification.article } : notification.announcement ? {
        kind: "announcement",
        announcementId: notification.announcement.id,
        announcement: notification.announcement,
      } : enrichedContext ?? groupContext,
      aggregateCount: notification.aggregateCount,
      readAt: notification.readAt?.toISOString() ?? null,
      openedAt: notification.openedAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
      updatedAt: notification.updatedAt.toISOString(),
    };
  }

  private groupNotificationContext(
    actionUrl: string | null,
    title: string,
  ): UserNotificationResponse["context"] {
    if (actionUrl?.includes("groupBan=")) {
      const url = new URL(actionUrl, "https://local.invalid");
      const groupId = Number(url.searchParams.get("groupBan"));
      if (Number.isInteger(groupId) && groupId > 0) return { kind: "group_ban", groupId };
    }
    if (!actionUrl?.includes("groupApproval=")) return null;
    const url = new URL(actionUrl, "https://local.invalid");
    const groupId = Number(url.searchParams.get("groupApproval"));
    if (!Number.isInteger(groupId) || groupId < 1) return null;
    const reportId = Number(url.searchParams.get("report")) || undefined;
    const joinRequestId = Number(url.searchParams.get("joinRequest")) || undefined;
    if (reportId) return { kind: "group_report", groupId, reportId };
    if (joinRequestId || title.includes("入群申请")) {
      return { kind: "group_join_request", groupId, joinRequestId };
    }
    return { kind: "group_invitation", groupId };
  }

  private async buildNotificationContexts(notifications: NotificationRecord[]): Promise<Map<number, NotificationContext>> {
    const contexts = new Map<number, NotificationContext>();
    const friendshipIds = [...new Set(notifications.map((notification) => notification.friendshipId).filter((id): id is number => Boolean(id)))];
    const invitationKeys = [...new Set(notifications
      .filter((notification) => this.groupNotificationContext(notification.actionUrl, notification.title)?.kind === "group_invitation" && notification.actionUrl)
      .map((notification) => `${notification.userId}:${notification.actionUrl}`))];
    const [latestFriendNotifications, latestInvitationNotifications] = await Promise.all([
      friendshipIds.length ? this.prisma.userNotification.findMany({
        where: { friendshipId: { in: friendshipIds }, type: UserNotificationType.friend_request_received },
        orderBy: [{ id: "desc" }],
        select: { id: true, friendshipId: true, userId: true },
      }) : [],
      invitationKeys.length ? this.prisma.userNotification.findMany({
        where: {
          OR: invitationKeys.map((key) => {
            const separator = key.indexOf(":");
            return { userId: Number(key.slice(0, separator)), actionUrl: key.slice(separator + 1) };
          }),
        },
        orderBy: [{ id: "desc" }],
        select: { id: true, userId: true, actionUrl: true },
      }) : [],
    ]);
    const latestFriendNotificationId = new Map<string, number>();
    latestFriendNotifications.forEach((notification) => {
      const key = `${notification.userId}:${notification.friendshipId}`;
      if (!latestFriendNotificationId.has(key)) latestFriendNotificationId.set(key, notification.id);
    });
    const latestInvitationNotificationId = new Map<string, number>();
    latestInvitationNotifications.forEach((notification) => {
      const key = `${notification.userId}:${notification.actionUrl}`;
      if (!latestInvitationNotificationId.has(key)) latestInvitationNotificationId.set(key, notification.id);
    });
    const groupDescriptors = notifications
      .map((notification) => ({ notification, context: this.groupNotificationContext(notification.actionUrl, notification.title) }))
      .filter((item): item is { notification: NotificationRecord; context: NotificationContext } => Boolean(item.context));

    for (const notification of notifications) {
      if (notification.type !== UserNotificationType.friend_request_received || !notification.friendship) continue;
      contexts.set(notification.id, {
        kind: "friend_request",
        status: notification.friendship.status,
        actionable: notification.friendship.status === FriendshipStatus.pending &&
          notification.friendship.requestedById !== notification.userId &&
          latestFriendNotificationId.get(`${notification.userId}:${notification.friendshipId}`) === notification.id,
        requestNote: notification.friendship.requestNote,
      });
    }
    if (!groupDescriptors.length) return contexts;

    const groupIds = [...new Set(groupDescriptors.map((item) => item.context.groupId).filter((id): id is number => Boolean(id)))];
    const joinRequestIds = [...new Set(groupDescriptors.map((item) => item.context.joinRequestId).filter((id): id is number => Boolean(id)))];
    const reportIds = [...new Set(groupDescriptors.map((item) => item.context.reportId).filter((id): id is number => Boolean(id)))];
    const inviteeIds = [...new Set(groupDescriptors
      .filter((item) => item.context.kind === "group_invitation")
      .map((item) => item.notification.userId))];
    const [groups, invitations, joinRequests, reports] = await Promise.all([
      this.prisma.chatGroup.findMany({
        where: { id: { in: groupIds } },
        select: {
          id: true,
          conversationId: true,
          name: true,
          avatarStoredName: true,
          avatarUrl: true,
          status: true,
          members: { select: { userId: true, status: true, role: true } },
        },
      }),
      this.prisma.chatGroupInvitation.findMany({
        where: { groupId: { in: groupIds }, inviteeId: { in: inviteeIds } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { groupId: true, inviteeId: true, status: true, expiresAt: true },
      }),
      this.prisma.chatGroupJoinRequest.findMany({
        where: { id: { in: joinRequestIds } },
        select: { id: true, groupId: true, userId: true, status: true },
      }),
      this.prisma.chatGroupMessageReport.findMany({
        where: { id: { in: reportIds } },
        select: {
          id: true,
          status: true,
          group: {
            select: { id: true, conversationId: true, name: true, avatarStoredName: true, avatarUrl: true },
          },
          message: { include: messageInclude },
        },
      }),
    ]);
    const groupMap = new Map(groups.map((group) => [group.id, group]));
    const invitationMap = new Map<string, (typeof invitations)[number]>();
    invitations.forEach((invitation) => {
      const key = `${invitation.groupId}:${invitation.inviteeId}`;
      if (!invitationMap.has(key)) invitationMap.set(key, invitation);
    });
    const joinRequestMap = new Map(joinRequests.map((request) => [request.id, request]));
    const reportMap = new Map(reports.map((report) => [report.id, report]));

    for (const { notification, context } of groupDescriptors) {
      const group = context.groupId ? groupMap.get(context.groupId) : undefined;
      const groupSummary = group ? {
        id: group.id,
        conversationId: group.conversationId,
        name: group.name,
        avatarUrl: group.avatarStoredName ? `/social/groups/avatars/${group.avatarStoredName}` : group.avatarUrl,
      } : undefined;
      if (context.kind === "group_invitation" && context.groupId) {
        const membership = group?.members.find((member) => member.userId === notification.userId);
        const invitation = invitationMap.get(`${context.groupId}:${notification.userId}`);
        const status = membership?.status === ChatGroupMemberStatus.active
          ? "already_joined"
          : invitation?.status === ChatGroupInvitationStatus.pending && invitation.expiresAt <= new Date()
            ? ChatGroupInvitationStatus.expired
            : invitation?.status ?? ChatGroupInvitationStatus.cancelled;
        contexts.set(notification.id, {
          ...context,
          conversationId: group?.conversationId,
          group: groupSummary,
          status,
          actionable: status === ChatGroupInvitationStatus.pending &&
            group?.status === ChatGroupStatus.active &&
            latestInvitationNotificationId.get(`${notification.userId}:${notification.actionUrl}`) === notification.id,
        });
      } else if (context.kind === "group_join_request" && context.joinRequestId) {
        const request = joinRequestMap.get(context.joinRequestId);
        const targetMember = request ? group?.members.find((member) => member.userId === request.userId) : undefined;
        const manager = group?.members.find((member) => member.userId === notification.userId);
        const status = targetMember?.status === ChatGroupMemberStatus.active
          ? "already_joined"
          : request?.status ?? ChatGroupJoinRequestStatus.cancelled;
        const managerCanAct = manager?.status === ChatGroupMemberStatus.active && manager.role !== ChatGroupMemberRole.member;
        contexts.set(notification.id, {
          ...context,
          conversationId: group?.conversationId,
          group: groupSummary,
          status,
          actionable: status === ChatGroupJoinRequestStatus.pending && Boolean(managerCanAct) && group?.status === ChatGroupStatus.active,
        });
      } else if (context.kind === "group_report" && context.reportId) {
        const report = reportMap.get(context.reportId);
        const manager = group?.members.find((member) => member.userId === notification.userId);
        const managerCanAct = manager?.status === ChatGroupMemberStatus.active && manager.role !== ChatGroupMemberRole.member;
        contexts.set(notification.id, {
          ...context,
          conversationId: report?.group.conversationId ?? group?.conversationId,
          group: report ? {
            id: report.group.id,
            conversationId: report.group.conversationId,
            name: report.group.name,
            avatarUrl: report.group.avatarStoredName ? `/social/groups/avatars/${report.group.avatarStoredName}` : report.group.avatarUrl,
          } : groupSummary,
          status: report?.status ?? ChatGroupReportStatus.resolved,
          actionable: report?.status === ChatGroupReportStatus.pending && Boolean(managerCanAct),
          message: report ? this.toMessage(report.message) : undefined,
        });
      }
    }
    return contexts;
  }

  private toNotificationChannelState(state: {
    channel: UserNotificationChannel;
    hiddenThroughNotificationId: number;
    pushEnabled: boolean;
  }): NotificationChannelStateResponse {
    return {
      channel: state.channel,
      hiddenThroughNotificationId: state.hiddenThroughNotificationId,
      pushEnabled: state.pushEnabled,
    };
  }
}
