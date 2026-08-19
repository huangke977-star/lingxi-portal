import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  ChatGroupInvitationStatus,
  ChatGroupJoinMode,
  ChatGroupJoinRequestStatus,
  ChatGroupMemberRole,
  ChatGroupMemberStatus,
  ChatGroupReportStatus,
  ChatGroupStatus,
  ChatMessageType,
  ConversationKind,
  FriendshipStatus,
  GroupInvitationPolicy,
  Prisma,
  UserNotificationType,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { ChatAttachmentsService } from "./chat-attachments.service";
import {
  CreateChatGroupDto,
  HandleChatGroupReportDto,
  InviteChatGroupMembersDto,
  ListChatGroupReportsQueryDto,
  ReportChatGroupMessageDto,
  RequestChatGroupJoinDto,
  RespondChatGroupInvitationDto,
  RespondChatGroupJoinRequestDto,
  SearchChatGroupsQueryDto,
  TransferChatGroupOwnerDto,
  UpdateChatGroupAliasDto,
  UpdateChatGroupBanDto,
  UpdateChatGroupDto,
  UpdateChatGroupMemberDto,
} from "./dto/social.dto";
import {
  ChatGroupInvitationResponse,
  ChatGroupApprovalResponse,
  ChatGroupJoinRequestResponse,
  ChatGroupReportResponse,
  ChatGroupResponse,
  ChatGroupSummaryResponse,
  ChatMessageResponse,
  SocialUserResponse,
} from "./social.types";

const GROUP_AVATAR_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const GROUP_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GROUP_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const GROUP_BAN_CLEANUP_INTERVAL_MS = 60 * 1000;

type UploadedGroupAvatar = {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
};

const groupUserSelect = {
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
} satisfies Prisma.UserSelect;

type GroupUserRecord = Prisma.UserGetPayload<{ select: typeof groupUserSelect }>;

const groupInclude = {
  owner: { select: groupUserSelect },
  members: {
    include: { user: { select: groupUserSelect } },
    orderBy: [{ joinedAt: "asc" as const }, { userId: "asc" as const }],
  },
  joinRequests: {
    where: { status: ChatGroupJoinRequestStatus.pending },
    select: { id: true },
  },
  reports: {
    where: { status: ChatGroupReportStatus.pending },
    select: { id: true },
  },
  banRecords: {
    orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }],
    take: 30,
    include: {
      actor: { select: groupUserSelect },
      liftedBy: { select: groupUserSelect },
    },
  },
} satisfies Prisma.ChatGroupInclude;

type GroupRecord = Prisma.ChatGroupGetPayload<{ include: typeof groupInclude }>;

const groupMessageInclude = {
  sender: { select: groupUserSelect },
  attachments: { orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }] },
  callSession: { select: { id: true, type: true, status: true, durationSeconds: true } },
} satisfies Prisma.ChatMessageInclude;

type GroupMessageRecord = Prisma.ChatMessageGetPayload<{ include: typeof groupMessageInclude }>;

@Injectable()
export class ChatGroupsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ChatGroupsService.name);
  private readonly avatarDirectory = resolve(
    process.env.GROUP_AVATAR_UPLOAD_DIR?.trim() || resolve(process.cwd(), "uploads", "group-avatars"),
  );
  private readonly memberLimit = this.numberSetting("CHAT_GROUP_MEMBER_LIMIT", 100, 2, 500);
  private cleanupTimer: NodeJS.Timeout | null = null;
  private banCleanupTimer: NodeJS.Timeout | null = null;
  private cleanupRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatAttachmentsService: ChatAttachmentsService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.cleanupTimer = setInterval(() => this.runCleanupInBackground(), GROUP_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
    this.banCleanupTimer = setInterval(() => this.liftExpiredBansInBackground(), GROUP_BAN_CLEANUP_INTERVAL_MS);
    this.banCleanupTimer.unref();
    setTimeout(() => this.runCleanupInBackground(), 20_000).unref();
    setTimeout(() => this.liftExpiredBansInBackground(), 25_000).unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.banCleanupTimer) clearInterval(this.banCleanupTimer);
  }

  async listMine(user: AuthenticatedUser): Promise<{ items: ChatGroupSummaryResponse[]; memberLimit: number }> {
    const groups = await this.prisma.chatGroup.findMany({
      where: {
        status: ChatGroupStatus.active,
        members: { some: { userId: user.id, status: ChatGroupMemberStatus.active } },
      },
      orderBy: [{ conversation: { updatedAt: "desc" } }, { id: "desc" }],
      include: groupInclude,
    });
    return { items: groups.map((group) => this.toSummary(group, user.id)), memberLimit: this.memberLimit };
  }

  async listForAdministration(user: AuthenticatedUser, query: SearchChatGroupsQueryDto): Promise<{ items: ChatGroupSummaryResponse[] }> {
    this.assertSiteManager(user);
    await this.liftExpiredBans();
    const keyword = query.q.trim();
    const groups = await this.prisma.chatGroup.findMany({
      where: {
        status: ChatGroupStatus.active,
        ...(keyword ? { OR: [{ name: { contains: keyword } }, { announcement: { contains: keyword } }] } : {}),
      },
      orderBy: [{ isBanned: "desc" }, { updatedAt: "desc" }, { id: "desc" }],
      take: query.limit,
      include: groupInclude,
    });
    return { items: groups.map((group) => this.toSummary(group, user.id, true)) };
  }

  async search(user: AuthenticatedUser, query: SearchChatGroupsQueryDto): Promise<{ items: ChatGroupSummaryResponse[] }> {
    const keyword = query.q.trim();
    const groups = await this.prisma.chatGroup.findMany({
      where: {
        status: ChatGroupStatus.active,
        joinMode: ChatGroupJoinMode.approval,
        ...(keyword ? { name: { contains: keyword } } : {}),
        members: { none: { userId: user.id, status: ChatGroupMemberStatus.blocked } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: query.limit,
      include: groupInclude,
    });
    return { items: groups.map((group) => this.toSummary(group, user.id)) };
  }

  async get(user: AuthenticatedUser, groupId: number): Promise<ChatGroupResponse> {
    await this.liftExpiredBans();
    const group = await this.getActiveGroup(groupId);
    const siteManager = this.isSiteManager(user);
    if (!siteManager) this.requireActiveMember(group, user.id);
    return this.toGroup(group, user.id, siteManager);
  }

  async ban(user: AuthenticatedUser, groupId: number, dto: UpdateChatGroupBanDto): Promise<ChatGroupSummaryResponse> {
    this.assertSiteManager(user);
    if (!dto.permanent && !dto.durationMinutes) throw new BadRequestException("请选择封禁时长或永久封禁。");
    const group = await this.getActiveGroup(groupId);
    const now = new Date();
    const bannedUntil = dto.permanent ? null : new Date(now.getTime() + dto.durationMinutes! * 60 * 1000);
    const reason = dto.reason.trim();
    if (reason.length < 2) throw new BadRequestException("封禁理由至少需要 2 个字符。");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroupBanRecord.updateMany({
        where: { groupId, liftedAt: null },
        data: { liftedAt: now, liftedById: user.id },
      });
      await transaction.chatGroup.update({
        where: { id: groupId },
        data: { isBanned: true, bannedUntil, banReason: reason },
      });
      await transaction.chatGroupBanRecord.create({
        data: { groupId, actorId: user.id, reason, startsAt: now, expiresAt: bannedUntil },
      });
      await transaction.chatGroupActivityLog.create({
        data: {
          groupId,
          actorId: user.id,
          action: "group.banned",
          summary: dto.permanent ? "永久封禁群聊" : "限时封禁群聊",
          metadata: { bannedUntil: bannedUntil?.toISOString() ?? null, reason },
        },
      });
      const managerIds = group.members
        .filter((member) => member.status === ChatGroupMemberStatus.active && member.role !== ChatGroupMemberRole.member)
        .map((member) => member.userId);
      if (managerIds.length) {
        await transaction.userNotification.createMany({
          data: managerIds.map((userId) => ({
            userId,
            actorId: user.id,
            type: UserNotificationType.system,
            title: "群聊已被站点封禁",
            body: `群聊“${group.name}”已被${dto.permanent ? "永久" : `封禁至 ${this.formatMinute(bannedUntil!)}`}。原因：${reason}`,
            actionUrl: `/messages?groupBan=${groupId}`,
          })),
        });
      }
    });
    const updated = await this.prisma.chatGroup.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
    return this.toSummary(updated, user.id, true);
  }

  async liftBan(user: AuthenticatedUser, groupId: number): Promise<ChatGroupSummaryResponse> {
    this.assertSiteManager(user);
    const group = await this.getActiveGroup(groupId);
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroup.update({
        where: { id: groupId },
        data: { isBanned: false, bannedUntil: null, banReason: null },
      });
      await transaction.chatGroupBanRecord.updateMany({
        where: { groupId, liftedAt: null },
        data: { liftedAt: now, liftedById: user.id },
      });
      await transaction.chatGroupActivityLog.create({
        data: { groupId, actorId: user.id, action: "group.ban_lifted", summary: "解除群聊封禁" },
      });
      const managerIds = group.members
        .filter((member) => member.status === ChatGroupMemberStatus.active && member.role !== ChatGroupMemberRole.member)
        .map((member) => member.userId);
      if (managerIds.length) {
        await transaction.userNotification.createMany({
          data: managerIds.map((userId) => ({
            userId,
            actorId: user.id,
            type: UserNotificationType.system,
            title: "群聊封禁已解除",
            body: `群聊“${group.name}”已恢复正常发言。`,
            actionUrl: `/messages?groupBan=${groupId}`,
          })),
        });
      }
    });
    const updated = await this.prisma.chatGroup.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
    return this.toSummary(updated, user.id, true);
  }

  async listBanRecords(user: AuthenticatedUser, groupId: number) {
    const siteManager = this.isSiteManager(user);
    if (!siteManager) await this.assertManager(groupId, user.id);
    const records = await this.prisma.chatGroupBanRecord.findMany({
      where: { groupId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      include: { actor: { select: groupUserSelect }, liftedBy: { select: groupUserSelect } },
    });
    return { items: records.map((record) => this.toBanRecord(record)) };
  }

  async create(user: AuthenticatedUser, dto: CreateChatGroupDto): Promise<ChatGroupResponse> {
    const requestedIds = [...new Set((dto.memberIds ?? []).filter((id) => id !== user.id))];
    if (requestedIds.length >= this.memberLimit) throw new BadRequestException(`群成员最多 ${this.memberLimit} 人。`);
    const invitees = requestedIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: requestedIds }, status: "active" }, select: { id: true } })
      : [];
    if (invitees.length !== requestedIds.length) throw new BadRequestException("邀请列表中包含不存在或已停用的账号。");
    const expiresAt = dto.temporary
      ? new Date(Date.now() + dto.ttlDays * 24 * 60 * 60 * 1000)
      : null;
    const group = await this.prisma.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.create({
        data: { kind: dto.temporary ? ConversationKind.temporary : ConversationKind.group },
        select: { id: true },
      });
      const created = await transaction.chatGroup.create({
        data: {
          conversationId: conversation.id,
          ownerId: user.id,
          name: dto.name.trim(),
          joinMode: dto.joinMode === "invite_only" ? ChatGroupJoinMode.invite_only : ChatGroupJoinMode.approval,
          memberLimit: this.memberLimit,
          temporary: dto.temporary,
          expiresAt,
          members: { create: { userId: user.id, role: ChatGroupMemberRole.owner } },
        },
        select: { id: true },
      });
      await transaction.conversationParticipantState.create({
        data: { conversationId: conversation.id, userId: user.id },
      });
      await transaction.chatMessage.create({
        data: {
          conversationId: conversation.id,
          senderId: user.id,
          body: `${user.nickname || user.username} 创建了群聊。`,
          type: ChatMessageType.system,
        },
      });
      if (invitees.length) {
        await transaction.chatGroupInvitation.createMany({
          data: invitees.map(({ id }) => ({
            groupId: created.id,
            inviterId: user.id,
            inviteeId: id,
            expiresAt: new Date(Date.now() + GROUP_INVITATION_TTL_MS),
          })),
        });
        await transaction.userNotification.createMany({
          data: invitees.map(({ id }) => ({
            userId: id,
            actorId: user.id,
            type: UserNotificationType.system,
            title: "新的群聊邀请",
            body: `${user.nickname || user.username} 邀请你加入群聊“${dto.name.trim()}”。`,
            actionUrl: `/messages?groupApproval=${created.id}`,
          })),
        });
      }
      await transaction.chatGroupActivityLog.create({
        data: { groupId: created.id, actorId: user.id, action: "group.created", summary: "创建群聊" },
      });
      return created;
    });
    return this.get(user, group.id);
  }

  async update(user: AuthenticatedUser, groupId: number, dto: UpdateChatGroupDto): Promise<ChatGroupResponse> {
    const { group, member } = await this.assertManager(groupId, user.id);
    if (dto.joinMode && member.role !== ChatGroupMemberRole.owner) {
      throw new ForbiddenException("只有群主可以修改入群方式。");
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroup.update({
        where: { id: groupId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.announcement !== undefined ? { announcement: dto.announcement.trim() } : {}),
          ...(dto.joinMode !== undefined ? { joinMode: dto.joinMode } : {}),
          ...(dto.membersCanInvite !== undefined ? { membersCanInvite: dto.membersCanInvite } : {}),
          ...(dto.avatarUrl !== undefined ? {
            avatarUrl: dto.avatarUrl.trim(),
            avatarOriginalName: null,
            avatarStoredName: null,
            avatarMimeType: null,
            avatarSizeBytes: null,
          } : {}),
        },
      });
      await transaction.chatGroupActivityLog.create({
        data: { groupId, actorId: user.id, action: "group.updated", summary: "修改群资料" },
      });
    });
    if (dto.avatarUrl !== undefined) await this.deleteAvatar(group.avatarStoredName);
    return this.get(user, groupId);
  }

  async uploadAvatar(
    user: AuthenticatedUser,
    groupId: number,
    file: UploadedGroupAvatar | undefined,
  ): Promise<ChatGroupResponse> {
    const { group } = await this.assertManager(groupId, user.id);
    if (!file) throw new BadRequestException("请选择群头像。");
    if (file.size < 1 || file.size > GROUP_AVATAR_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException("群头像不能超过 8MB。");
    }
    const format = this.avatarFormat(file);
    const storedName = `group-${randomUUID()}${format.extension}`;
    const filePath = this.avatarPath(storedName);
    await mkdir(this.avatarDirectory, { recursive: true });
    try {
      await writeFile(filePath, file.buffer, { flag: "wx" });
      await this.prisma.chatGroup.update({
        where: { id: groupId },
        data: {
          avatarUrl: null,
          avatarOriginalName: basename(file.originalname).slice(0, 255),
          avatarStoredName: storedName,
          avatarMimeType: format.mimeType,
          avatarSizeBytes: file.size,
        },
      });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    await this.deleteAvatar(group.avatarStoredName);
    return this.get(user, groupId);
  }

  async getAvatar(storedName: string): Promise<{ filePath: string; mimeType: string }> {
    const group = await this.prisma.chatGroup.findUnique({
      where: { avatarStoredName: storedName },
      select: { avatarMimeType: true },
    });
    if (!group?.avatarMimeType) throw new NotFoundException("群头像不存在。");
    const filePath = this.avatarPath(storedName);
    await access(filePath).catch(() => { throw new NotFoundException("群头像不存在。"); });
    return { filePath, mimeType: group.avatarMimeType };
  }

  async updateAlias(user: AuthenticatedUser, groupId: number, dto: UpdateChatGroupAliasDto): Promise<ChatGroupResponse> {
    const group = await this.getActiveGroup(groupId);
    this.requireActiveMember(group, user.id);
    await this.prisma.chatGroupMember.update({
      where: { groupId_userId: { groupId, userId: user.id } },
      data: { alias: dto.alias?.trim() || null },
    });
    return this.get(user, groupId);
  }

  async invite(
    user: AuthenticatedUser,
    groupId: number,
    dto: InviteChatGroupMembersDto,
  ): Promise<{ count: number }> {
    const group = await this.getActiveGroup(groupId);
    const inviter = this.requireActiveMember(group, user.id);
    if (inviter.role === ChatGroupMemberRole.member && !group.membersCanInvite) {
      throw new ForbiddenException("群主尚未允许普通成员邀请新成员。");
    }
    const userIds = [...new Set(dto.userIds.filter((id) => id !== user.id))];
    if (!userIds.length) throw new BadRequestException("请选择要邀请的用户。");
    const activeCount = group.members.filter((item) => item.status === ChatGroupMemberStatus.active).length;
    if (activeCount + userIds.length > group.memberLimit) throw new BadRequestException(`群成员最多 ${group.memberLimit} 人。`);
    const targets = await this.prisma.user.findMany({
      where: { id: { in: userIds }, status: "active" },
      select: { id: true, profileSettings: { select: { groupInvitationPolicy: true } } },
    });
    if (targets.length !== userIds.length) throw new BadRequestException("邀请列表中包含不存在或已停用的账号。");
    const relationships = await this.prisma.friendship.findMany({
      where: {
        OR: [
          { userOneId: user.id, userTwoId: { in: userIds } },
          { userTwoId: user.id, userOneId: { in: userIds } },
        ],
      },
      select: { userOneId: true, userTwoId: true, status: true },
    });
    const relationshipByTarget = new Map(relationships.map((relationship) => [
      relationship.userOneId === user.id ? relationship.userTwoId : relationship.userOneId,
      relationship.status,
    ]));
    if (relationships.some((relationship) => relationship.status === FriendshipStatus.blocked)) {
      throw new ForbiddenException("邀请列表中包含当前不可联系的用户。");
    }
    const disallowed = targets.some((target) => {
      const policy = target.profileSettings?.groupInvitationPolicy ?? GroupInvitationPolicy.everyone;
      if (policy === GroupInvitationPolicy.none) return true;
      return policy === GroupInvitationPolicy.friends && relationshipByTarget.get(target.id) !== FriendshipStatus.accepted;
    });
    if (disallowed) throw new ForbiddenException("邀请列表中包含不接收当前邀请的用户。");
    const blocked = group.members.find((item) => userIds.includes(item.userId) && item.status === ChatGroupMemberStatus.blocked);
    if (blocked) throw new ForbiddenException("邀请列表中包含已被群聊拉黑的成员。");
    const existingActive = new Set(group.members.filter((item) => item.status === ChatGroupMemberStatus.active).map((item) => item.userId));
    const inviteeIds = userIds.filter((id) => !existingActive.has(id));
    const notificationBody = `${user.nickname || user.username} 邀请你加入群聊“${group.name}”。`;
    const [pendingInvitations, unreadNotifications] = inviteeIds.length
      ? await Promise.all([
          this.prisma.chatGroupInvitation.findMany({
            where: {
              groupId,
              inviteeId: { in: inviteeIds },
              status: ChatGroupInvitationStatus.pending,
              expiresAt: { gt: new Date() },
            },
            select: { inviteeId: true },
          }),
          this.prisma.userNotification.findMany({
            where: {
              userId: { in: inviteeIds },
              actorId: user.id,
              type: UserNotificationType.system,
              title: "新的群聊邀请",
              body: notificationBody,
              readAt: null,
            },
            select: { userId: true },
          }),
        ])
      : [[], []];
    const pendingInviteeIds = new Set(pendingInvitations.map((item) => item.inviteeId));
    const unreadNotificationUserIds = new Set(unreadNotifications.map((item) => item.userId));
    const newInvitationUserIds = inviteeIds.filter((id) => !pendingInviteeIds.has(id));
    const notificationUserIds = inviteeIds.filter(
      (id) => !pendingInviteeIds.has(id) || !unreadNotificationUserIds.has(id),
    );
    await this.prisma.$transaction(async (transaction) => {
      if (newInvitationUserIds.length) {
        await transaction.chatGroupInvitation.createMany({
          data: newInvitationUserIds.map((inviteeId) => ({
            groupId,
            inviterId: user.id,
            inviteeId,
            expiresAt: new Date(Date.now() + GROUP_INVITATION_TTL_MS),
          })),
        });
      }
      if (notificationUserIds.length) {
        await transaction.userNotification.createMany({
          data: notificationUserIds.map((inviteeId) => ({
            userId: inviteeId,
            actorId: user.id,
            type: UserNotificationType.system,
            title: "新的群聊邀请",
            body: notificationBody,
            actionUrl: `/messages?groupApproval=${groupId}`,
          })),
        });
      }
      await transaction.chatGroupActivityLog.create({
        data: { groupId, actorId: user.id, action: "members.invited", summary: `邀请 ${inviteeIds.length} 位成员` },
      });
    });
    return { count: notificationUserIds.length };
  }

  async listInvitations(user: AuthenticatedUser): Promise<{ items: ChatGroupInvitationResponse[] }> {
    await this.expireInvitations(user.id);
    const invitations = await this.prisma.chatGroupInvitation.findMany({
      where: { inviteeId: user.id, status: ChatGroupInvitationStatus.pending, expiresAt: { gt: new Date() } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { group: { include: groupInclude }, inviter: { select: groupUserSelect } },
    });
    return { items: invitations.map((invitation) => ({
      id: invitation.id,
      group: this.toSummary(invitation.group, user.id),
      inviter: this.toUser(invitation.inviter),
      status: invitation.status,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    })) };
  }

  async listApprovals(user: AuthenticatedUser): Promise<ChatGroupApprovalResponse> {
    await this.expireInvitations(user.id);
    const [invitationResult, requests] = await Promise.all([
      this.listInvitations(user),
      this.prisma.chatGroupJoinRequest.findMany({
        where: {
          status: ChatGroupJoinRequestStatus.pending,
          group: {
            status: ChatGroupStatus.active,
            members: {
              some: {
                userId: user.id,
                status: ChatGroupMemberStatus.active,
                role: { in: [ChatGroupMemberRole.owner, ChatGroupMemberRole.admin] },
              },
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          user: { select: groupUserSelect },
          group: { include: groupInclude },
        },
      }),
    ]);
    return {
      invitations: invitationResult.items,
      joinRequests: requests.map((request) => {
        const group = this.toSummary(request.group, user.id);
        return {
          id: request.id,
          groupId: request.groupId,
          group: {
            id: group.id,
            conversationId: group.conversationId,
            name: group.name,
            avatarUrl: group.avatarUrl,
          },
          user: this.toUser(request.user),
          note: request.note,
          status: request.status,
          createdAt: request.createdAt.toISOString(),
        };
      }),
    };
  }

  async respondInvitation(
    user: AuthenticatedUser,
    invitationId: number,
    dto: RespondChatGroupInvitationDto,
  ): Promise<{ group: ChatGroupResponse | null }> {
    const invitation = await this.prisma.chatGroupInvitation.findUnique({
      where: { id: invitationId },
      include: { group: { include: groupInclude } },
    });
    if (!invitation || invitation.inviteeId !== user.id || invitation.status !== ChatGroupInvitationStatus.pending) {
      throw new NotFoundException("群邀请不存在或已经处理。");
    }
    if (invitation.expiresAt <= new Date() || invitation.group.status !== ChatGroupStatus.active) {
      await this.prisma.chatGroupInvitation.update({
        where: { id: invitationId },
        data: { status: ChatGroupInvitationStatus.expired, respondedAt: new Date() },
      });
      throw new BadRequestException("群邀请已经过期。");
    }
    if (dto.status === "declined") {
      await this.prisma.chatGroupInvitation.update({
        where: { id: invitationId },
        data: { status: ChatGroupInvitationStatus.declined, respondedAt: new Date() },
      });
      return { group: null };
    }
    this.assertCapacity(invitation.group);
    const respondedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroupMember.upsert({
        where: { groupId_userId: { groupId: invitation.groupId, userId: user.id } },
        create: { groupId: invitation.groupId, userId: user.id },
        update: { status: ChatGroupMemberStatus.active, role: ChatGroupMemberRole.member, leftAt: null, mutedUntil: null },
      });
      await transaction.conversationParticipantState.upsert({
        where: { conversationId_userId: { conversationId: invitation.group.conversationId, userId: user.id } },
        create: { conversationId: invitation.group.conversationId, userId: user.id },
        update: { hidden: false },
      });
      await transaction.chatGroupInvitation.updateMany({
        where: {
          groupId: invitation.groupId,
          inviteeId: user.id,
          status: ChatGroupInvitationStatus.pending,
        },
        data: { status: ChatGroupInvitationStatus.cancelled, respondedAt },
      });
      await transaction.chatGroupInvitation.update({
        where: { id: invitationId },
        data: { status: ChatGroupInvitationStatus.accepted, respondedAt },
      });
      const cancelledRequests = await transaction.chatGroupJoinRequest.findMany({
        where: {
          groupId: invitation.groupId,
          userId: user.id,
          status: ChatGroupJoinRequestStatus.pending,
        },
        select: { id: true },
      });
      await transaction.chatGroupJoinRequest.updateMany({
        where: { id: { in: cancelledRequests.map((request) => request.id) } },
        data: { status: ChatGroupJoinRequestStatus.cancelled, respondedAt },
      });
      for (const request of cancelledRequests) {
        await transaction.userNotification.updateMany({
          where: { actionUrl: `/messages?groupApproval=${invitation.groupId}&joinRequest=${request.id}`, readAt: null },
          data: { readAt: respondedAt },
        });
      }
      await transaction.userNotification.updateMany({
        where: {
          userId: user.id,
          actionUrl: `/messages?groupApproval=${invitation.groupId}`,
          readAt: null,
        },
        data: { readAt: respondedAt },
      });
      await transaction.chatGroupActivityLog.create({
        data: { groupId: invitation.groupId, actorId: user.id, action: "member.joined", summary: "通过邀请加入群聊" },
      });
    });
    return { group: await this.get(user, invitation.groupId) };
  }

  async respondInvitationByGroup(
    user: AuthenticatedUser,
    groupId: number,
    dto: RespondChatGroupInvitationDto,
  ): Promise<{ group: ChatGroupResponse | null }> {
    await this.expireInvitations(user.id);
    const invitation = await this.prisma.chatGroupInvitation.findFirst({
      where: {
        groupId,
        inviteeId: user.id,
        status: ChatGroupInvitationStatus.pending,
        expiresAt: { gt: new Date() },
      },
      orderBy: { id: "desc" },
      select: { id: true },
    });
    if (!invitation) throw new NotFoundException("群邀请不存在或已经处理。");
    return this.respondInvitation(user, invitation.id, dto);
  }

  async requestJoin(user: AuthenticatedUser, groupId: number, dto: RequestChatGroupJoinDto) {
    const group = await this.getActiveGroup(groupId);
    if (group.joinMode !== ChatGroupJoinMode.approval) throw new ForbiddenException("这个群聊仅能通过邀请加入。");
    const member = group.members.find((item) => item.userId === user.id);
    if (member?.status === ChatGroupMemberStatus.active) return { status: "joined" as const };
    if (member?.status === ChatGroupMemberStatus.blocked) throw new ForbiddenException("当前无法申请加入这个群聊。");
    this.assertCapacity(group);
    const existing = await this.prisma.chatGroupJoinRequest.findFirst({
      where: { groupId, userId: user.id, status: ChatGroupJoinRequestStatus.pending },
      orderBy: { id: "desc" },
    });
    if (existing) {
      await this.prisma.chatGroupJoinRequest.update({
        where: { id: existing.id },
        data: { note: dto.note?.trim() || null },
      });
      return { status: "pending" as const, id: existing.id };
    }
    const request = await this.prisma.chatGroupJoinRequest.create({
      data: { groupId, userId: user.id, note: dto.note?.trim() || null },
    });
    const managerIds = group.members
      .filter((member) => member.status === ChatGroupMemberStatus.active && member.role !== ChatGroupMemberRole.member)
      .map((member) => member.userId);
    if (managerIds.length) {
      await this.prisma.userNotification.createMany({
        data: managerIds.map((managerId) => ({
          userId: managerId,
          actorId: user.id,
          type: UserNotificationType.system,
          title: "新的入群申请",
          body: `${user.nickname || user.username} 申请加入群聊“${group.name}”。`,
          actionUrl: `/messages?groupApproval=${groupId}&joinRequest=${request.id}`,
        })),
      });
    }
    return { status: "pending" as const, id: request.id };
  }

  async listJoinRequests(user: AuthenticatedUser, groupId: number): Promise<{ items: ChatGroupJoinRequestResponse[] }> {
    await this.assertManager(groupId, user.id);
    const requests = await this.prisma.chatGroupJoinRequest.findMany({
      where: { groupId, status: ChatGroupJoinRequestStatus.pending },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { user: { select: groupUserSelect } },
    });
    return { items: requests.map((request) => ({
      id: request.id,
      groupId,
      user: this.toUser(request.user),
      note: request.note,
      status: request.status,
      createdAt: request.createdAt.toISOString(),
    })) };
  }

  async respondJoinRequest(
    user: AuthenticatedUser,
    groupId: number,
    requestId: number,
    dto: RespondChatGroupJoinRequestDto,
  ): Promise<{ success: true }> {
    const { group } = await this.assertManager(groupId, user.id);
    const request = await this.prisma.chatGroupJoinRequest.findUnique({ where: { id: requestId } });
    if (!request || request.groupId !== groupId || request.status !== ChatGroupJoinRequestStatus.pending) {
      throw new NotFoundException("入群申请不存在或已经处理。");
    }
    if (dto.status === "approved") this.assertCapacity(group);
    const respondedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      if (dto.status === "approved") {
        await transaction.chatGroupMember.upsert({
          where: { groupId_userId: { groupId, userId: request.userId } },
          create: { groupId, userId: request.userId },
          update: { role: ChatGroupMemberRole.member, status: ChatGroupMemberStatus.active, leftAt: null, mutedUntil: null },
        });
        await transaction.conversationParticipantState.upsert({
          where: { conversationId_userId: { conversationId: group.conversationId, userId: request.userId } },
          create: { conversationId: group.conversationId, userId: request.userId },
          update: { hidden: false },
        });
      }
      await transaction.chatGroupJoinRequest.updateMany({
        where: {
          groupId,
          userId: request.userId,
          status: ChatGroupJoinRequestStatus.pending,
        },
        data: { status: ChatGroupJoinRequestStatus.cancelled, handledById: user.id, respondedAt },
      });
      await transaction.chatGroupJoinRequest.update({
        where: { id: requestId },
        data: { status: dto.status, handledById: user.id, respondedAt },
      });
      if (dto.status === "approved") {
        await transaction.chatGroupInvitation.updateMany({
          where: {
            groupId,
            inviteeId: request.userId,
            status: ChatGroupInvitationStatus.pending,
          },
          data: { status: ChatGroupInvitationStatus.cancelled, respondedAt },
        });
        await transaction.userNotification.updateMany({
          where: {
            userId: request.userId,
            actionUrl: `/messages?groupApproval=${groupId}`,
            readAt: null,
          },
          data: { readAt: respondedAt },
        });
      }
      await transaction.userNotification.updateMany({
        where: { actionUrl: `/messages?groupApproval=${groupId}&joinRequest=${requestId}`, readAt: null },
        data: { readAt: respondedAt },
      });
      await transaction.userNotification.create({
        data: {
          userId: request.userId,
          actorId: user.id,
          type: UserNotificationType.system,
          title: dto.status === "approved" ? "入群申请已通过" : "入群申请未通过",
          body: dto.status === "approved" ? `你已加入群聊“${group.name}”。` : `你申请加入群聊“${group.name}”的请求未通过。`,
          actionUrl: dto.status === "approved" ? `/messages?conversation=${group.conversationId}` : "/messages",
        },
      });
      await transaction.chatGroupActivityLog.create({
        data: {
          groupId,
          actorId: user.id,
          targetUserId: request.userId,
          action: dto.status === "approved" ? "join.approved" : "join.rejected",
          summary: dto.status === "approved" ? "通过入群申请" : "拒绝入群申请",
        },
      });
    });
    return { success: true };
  }

  async updateMember(
    user: AuthenticatedUser,
    groupId: number,
    targetUserId: number,
    dto: UpdateChatGroupMemberDto,
  ): Promise<ChatGroupResponse> {
    const context = await this.assertManager(groupId, user.id);
    const target = this.assertManageableTarget(context.group, context.member, targetUserId);
    if (dto.role !== undefined && context.member.role !== ChatGroupMemberRole.owner) {
      throw new ForbiddenException("只有群主可以设置群管理员。");
    }
    const mutedUntil = dto.mutedMinutes === undefined
      ? undefined
      : dto.mutedMinutes === 0 ? null : new Date(Date.now() + dto.mutedMinutes * 60 * 1000);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroupMember.update({
        where: { groupId_userId: { groupId, userId: targetUserId } },
        data: {
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(mutedUntil !== undefined ? { mutedUntil } : {}),
        },
      });
      await transaction.chatGroupActivityLog.create({
        data: {
          groupId,
          actorId: user.id,
          targetUserId,
          action: dto.role !== undefined ? "member.role_updated" : "member.mute_updated",
          summary: dto.role !== undefined ? `成员角色修改为 ${dto.role}` : mutedUntil ? "成员已被禁言" : "成员禁言已解除",
          metadata: { previousRole: target.role, mutedUntil: mutedUntil?.toISOString() ?? null },
        },
      });
    });
    return this.get(user, groupId);
  }

  async removeMember(user: AuthenticatedUser, groupId: number, targetUserId: number) {
    return this.changeMemberStatus(user, groupId, targetUserId, ChatGroupMemberStatus.removed);
  }

  async blockMember(user: AuthenticatedUser, groupId: number, targetUserId: number) {
    return this.changeMemberStatus(user, groupId, targetUserId, ChatGroupMemberStatus.blocked);
  }

  async unblockMember(user: AuthenticatedUser, groupId: number, targetUserId: number): Promise<ChatGroupResponse> {
    const context = await this.assertManager(groupId, user.id);
    const target = context.group.members.find((item) => item.userId === targetUserId);
    if (!target || target.status !== ChatGroupMemberStatus.blocked) throw new NotFoundException("被拉黑成员不存在。");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroupMember.update({
        where: { groupId_userId: { groupId, userId: targetUserId } },
        data: { status: ChatGroupMemberStatus.removed, leftAt: new Date(), mutedUntil: null },
      });
      await transaction.chatGroupActivityLog.create({
        data: { groupId, actorId: user.id, targetUserId, action: "member.unblocked", summary: "解除群聊拉黑" },
      });
    });
    return this.get(user, groupId);
  }

  async transferOwner(user: AuthenticatedUser, groupId: number, dto: TransferChatGroupOwnerDto): Promise<ChatGroupResponse> {
    const { group, member } = await this.assertManager(groupId, user.id);
    if (member.role !== ChatGroupMemberRole.owner) throw new ForbiddenException("只有群主可以转让群聊。");
    const target = group.members.find((item) => item.userId === dto.userId && item.status === ChatGroupMemberStatus.active);
    if (!target || target.role === ChatGroupMemberRole.owner) throw new BadRequestException("请选择其他在群成员接任群主。");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroup.update({ where: { id: groupId }, data: { ownerId: dto.userId } });
      await transaction.chatGroupMember.update({
        where: { groupId_userId: { groupId, userId: user.id } },
        data: { role: ChatGroupMemberRole.admin },
      });
      await transaction.chatGroupMember.update({
        where: { groupId_userId: { groupId, userId: dto.userId } },
        data: { role: ChatGroupMemberRole.owner },
      });
      await transaction.chatGroupActivityLog.create({
        data: { groupId, actorId: user.id, targetUserId: dto.userId, action: "owner.transferred", summary: "转让群主" },
      });
    });
    return this.get(user, groupId);
  }

  async leave(user: AuthenticatedUser, groupId: number): Promise<{ success: true }> {
    const group = await this.getActiveGroup(groupId);
    const member = this.requireActiveMember(group, user.id);
    if (member.role === ChatGroupMemberRole.owner) throw new BadRequestException("群主需要先转让群聊或解散群聊。");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroupMember.update({
        where: { groupId_userId: { groupId, userId: user.id } },
        data: { status: ChatGroupMemberStatus.left, leftAt: new Date(), mutedUntil: null },
      });
      await transaction.conversationParticipantState.updateMany({
        where: { conversationId: group.conversationId, userId: user.id },
        data: { hidden: true },
      });
      await transaction.chatGroupActivityLog.create({
        data: { groupId, actorId: user.id, action: "member.left", summary: "退出群聊" },
      });
    });
    return { success: true };
  }

  async dissolve(user: AuthenticatedUser, groupId: number): Promise<{ success: true }> {
    const { member } = await this.assertManager(groupId, user.id);
    if (member.role !== ChatGroupMemberRole.owner) throw new ForbiddenException("只有群主可以解散群聊。");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroupActivityLog.create({
        data: { groupId, actorId: user.id, action: "group.dissolved", summary: "解散群聊" },
      });
      await transaction.chatGroup.update({
        where: { id: groupId },
        data: { status: ChatGroupStatus.dissolved, dissolvedAt: new Date() },
      });
    });
    return { success: true };
  }

  async reportMessage(
    user: AuthenticatedUser,
    groupId: number,
    messageId: number,
    dto: ReportChatGroupMessageDto,
  ): Promise<{ id: number; status: "pending" }> {
    const group = await this.getActiveGroup(groupId);
    this.requireActiveMember(group, user.id);
    const message = await this.prisma.chatMessage.findFirst({
      where: { id: messageId, conversationId: group.conversationId },
      select: { id: true, senderId: true, type: true, body: true },
    });
    if (!message || message.type === ChatMessageType.system) throw new NotFoundException("可举报的群消息不存在。");
    if (message.senderId === user.id) throw new BadRequestException("不能举报自己发送的消息。");
    const report = await this.prisma.chatGroupMessageReport.upsert({
      where: { messageId_reporterId: { messageId, reporterId: user.id } },
      create: { groupId, messageId, reporterId: user.id, reason: dto.reason, detail: dto.detail?.trim() || null },
      update: {
        reason: dto.reason,
        detail: dto.detail?.trim() || null,
        status: ChatGroupReportStatus.pending,
        handledById: null,
        handledAt: null,
        resolution: null,
      },
    });
    const managerIds = group.members
      .filter((member) => member.status === ChatGroupMemberStatus.active && member.role !== ChatGroupMemberRole.member)
      .map((member) => member.userId)
      .filter((managerId) => managerId !== user.id);
    const excerpt = message.body.trim().slice(0, 180) || "附件消息";
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroupActivityLog.create({
        data: { groupId, actorId: user.id, action: "message.reported", summary: "举报群消息", metadata: { messageId } },
      });
      if (managerIds.length) {
        await transaction.userNotification.createMany({
          data: managerIds.map((managerId) => ({
            userId: managerId,
            actorId: user.id,
            type: UserNotificationType.system,
            title: `群消息待处理举报 · ${group.name}`,
            body: excerpt,
            actionUrl: `/messages?groupApproval=${groupId}&report=${report.id}`,
          })),
        });
      }
    });
    return { id: report.id, status: "pending" };
  }

  async listReports(
    user: AuthenticatedUser,
    query: ListChatGroupReportsQueryDto,
  ): Promise<{ items: ChatGroupReportResponse[] }> {
    const siteManager = user.isSuperAdmin || Boolean(user.isAdministrator);
    if (!siteManager && !query.groupId) throw new ForbiddenException("请选择你管理的群聊。");
    if (!siteManager && query.groupId) await this.assertManager(query.groupId, user.id);
    const reports = await this.prisma.chatGroupMessageReport.findMany({
      where: {
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: {
        group: { include: groupInclude },
        reporter: { select: groupUserSelect },
        message: { include: groupMessageInclude },
      },
    });
    return { items: reports.map((report) => this.toReport(report, user.id)) };
  }

  async handleReport(
    user: AuthenticatedUser,
    reportId: number,
    dto: HandleChatGroupReportDto,
  ): Promise<{ success: true }> {
    const report = await this.prisma.chatGroupMessageReport.findUnique({
      where: { id: reportId },
      include: {
        group: { include: groupInclude },
        message: { include: { attachments: { select: { storedName: true } } } },
      },
    });
    if (!report) throw new NotFoundException("群消息举报不存在。");
    if (!(user.isSuperAdmin || user.isAdministrator)) await this.assertManager(report.groupId, user.id);
    const storedNames = report.message.attachments.map((attachment) => attachment.storedName);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroupMessageReport.update({
        where: { id: reportId },
        data: {
          status: dto.status,
          handledById: user.id,
          handledAt: new Date(),
          resolution: dto.resolution?.trim() || null,
        },
      });
      await transaction.userNotification.updateMany({
        where: {
          actionUrl: `/messages?groupApproval=${report.groupId}&report=${report.id}`,
          readAt: null,
        },
        data: { readAt: new Date() },
      });
      await transaction.chatGroupActivityLog.create({
        data: {
          groupId: report.groupId,
          actorId: user.id,
          targetUserId: report.message.senderId,
          action: dto.status === "resolved" ? "report.resolved" : "report.rejected",
          summary: dto.status === "resolved" ? "处理群消息举报" : "驳回群消息举报",
          metadata: { reportId, messageId: report.messageId, deleted: dto.deleteMessage },
        },
      });
      await transaction.userNotification.createMany({
        data: [
          {
            userId: report.reporterId,
            actorId: user.id,
            type: UserNotificationType.system,
            title: "群消息举报处理结果",
            body: dto.status === "resolved" ? `你在群聊“${report.group.name}”提交的举报已处理。` : `你在群聊“${report.group.name}”提交的举报未发现违规。`,
            actionUrl: `/messages?conversation=${report.group.conversationId}`,
          },
          ...(dto.status === "resolved" ? [{
            userId: report.message.senderId,
            actorId: user.id,
            type: UserNotificationType.system,
            title: "群消息处理通知",
            body: `你在群聊“${report.group.name}”发送的消息已被管理员处理。`,
            actionUrl: `/messages?conversation=${report.group.conversationId}`,
          }] : []),
        ],
      });
      if (dto.status === "resolved" && dto.deleteMessage) {
        await transaction.chatMessage.delete({ where: { id: report.messageId } });
      }
    });
    if (dto.status === "resolved" && dto.deleteMessage) {
      await this.chatAttachmentsService.deleteStoredFiles(storedNames);
    }
    return { success: true };
  }

  async listActivity(user: AuthenticatedUser, groupId: number) {
    await this.assertManager(groupId, user.id);
    const items = await this.prisma.chatGroupActivityLog.findMany({
      where: { groupId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: {
        actor: { select: { id: true, nickname: true, username: true } },
        targetUser: { select: { id: true, nickname: true, username: true } },
      },
    });
    return { items: items.map((item) => ({
      id: item.id,
      action: item.action,
      summary: item.summary,
      metadata: item.metadata,
      actor: item.actor,
      targetUser: item.targetUser,
      createdAt: item.createdAt.toISOString(),
    })) };
  }

  async cleanupExpiredGroups(): Promise<void> {
    if (this.cleanupRunning) return;
    this.cleanupRunning = true;
    try {
      const groups = await this.prisma.chatGroup.findMany({
        where: { temporary: true, expiresAt: { lte: new Date() } },
        take: 20,
        select: {
          id: true,
          conversationId: true,
          avatarStoredName: true,
          conversation: { select: { attachments: { select: { storedName: true } } } },
        },
      });
      for (const group of groups) {
        await this.prisma.conversation.delete({ where: { id: group.conversationId } });
        await Promise.all([
          this.chatAttachmentsService.deleteStoredFiles(group.conversation.attachments.map((item) => item.storedName)),
          this.deleteAvatar(group.avatarStoredName),
        ]);
      }
    } finally {
      this.cleanupRunning = false;
    }
  }

  private async liftExpiredBansInBackground(): Promise<void> {
    await this.liftExpiredBans().catch((error) => {
      this.logger.warn(`Chat group ban cleanup failed: ${this.errorMessage(error)}`);
    });
  }

  private async liftExpiredBans(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.chatGroup.findMany({
      where: { isBanned: true, bannedUntil: { lte: now } },
      select: { id: true, name: true, conversationId: true },
      take: 30,
    });
    for (const group of expired) {
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.chatGroup.updateMany({
          where: { id: group.id, isBanned: true, bannedUntil: { lte: now } },
          data: { isBanned: false, bannedUntil: null, banReason: null },
        });
        if (!updated.count) return;
        await transaction.chatGroupBanRecord.updateMany({
          where: { groupId: group.id, liftedAt: null },
          data: { liftedAt: now },
        });
        await transaction.chatGroupActivityLog.create({
          data: { groupId: group.id, action: "group.ban_expired", summary: "群聊封禁到期自动解除" },
        });
        const managers = await transaction.chatGroupMember.findMany({
          where: { groupId: group.id, status: ChatGroupMemberStatus.active, role: { in: [ChatGroupMemberRole.owner, ChatGroupMemberRole.admin] } },
          select: { userId: true },
        });
        if (managers.length) {
          await transaction.userNotification.createMany({
            data: managers.map((manager) => ({
              userId: manager.userId,
              type: UserNotificationType.system,
              title: "群聊封禁已到期",
              body: `群聊“${group.name}”已恢复正常发言。`,
              actionUrl: `/messages?groupBan=${group.id}`,
            })),
          });
        }
      });
    }
  }

  private async changeMemberStatus(
    user: AuthenticatedUser,
    groupId: number,
    targetUserId: number,
    status: "removed" | "blocked",
  ): Promise<ChatGroupResponse> {
    const context = await this.assertManager(groupId, user.id);
    this.assertManageableTarget(context.group, context.member, targetUserId);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.chatGroupMember.update({
        where: { groupId_userId: { groupId, userId: targetUserId } },
        data: { status, leftAt: new Date(), mutedUntil: null },
      });
      await transaction.conversationParticipantState.updateMany({
        where: { conversationId: context.group.conversationId, userId: targetUserId },
        data: { hidden: true },
      });
      await transaction.chatGroupActivityLog.create({
        data: {
          groupId,
          actorId: user.id,
          targetUserId,
          action: status === ChatGroupMemberStatus.blocked ? "member.blocked" : "member.removed",
          summary: status === ChatGroupMemberStatus.blocked ? "拉黑群成员" : "移出群成员",
        },
      });
      await transaction.userNotification.create({
        data: {
          userId: targetUserId,
          actorId: user.id,
          type: UserNotificationType.system,
          title: status === ChatGroupMemberStatus.blocked ? "你已被移出并限制加入群聊" : "你已被移出群聊",
          body: status === ChatGroupMemberStatus.blocked
            ? `你已被移出群聊“${context.group.name}”，当前无法重新申请加入。`
            : `你已被移出群聊“${context.group.name}”。`,
          actionUrl: "/messages",
        },
      });
    });
    return this.get(user, groupId);
  }

  private async getActiveGroup(groupId: number): Promise<GroupRecord> {
    const group = await this.prisma.chatGroup.findUnique({ where: { id: groupId }, include: groupInclude });
    if (!group || group.status !== ChatGroupStatus.active) throw new NotFoundException("群聊不存在或已经解散。");
    if (group.temporary && group.expiresAt && group.expiresAt <= new Date()) {
      this.runCleanupInBackground();
      throw new BadRequestException("临时群聊已经到期。");
    }
    return group;
  }

  private isSiteManager(user: AuthenticatedUser): boolean {
    return user.isSuperAdmin || Boolean(user.isAdministrator);
  }

  private assertSiteManager(user: AuthenticatedUser): void {
    if (!this.isSiteManager(user)) throw new ForbiddenException("需要站点管理员权限。");
  }

  private async assertManager(groupId: number, userId: number) {
    const group = await this.getActiveGroup(groupId);
    const member = this.requireActiveMember(group, userId);
    if (member.role !== ChatGroupMemberRole.owner && member.role !== ChatGroupMemberRole.admin) {
      throw new ForbiddenException("需要群主或群管理员权限。");
    }
    return { group, member };
  }

  private requireActiveMember(group: GroupRecord, userId: number) {
    const member = group.members.find((item) => item.userId === userId && item.status === ChatGroupMemberStatus.active);
    if (!member) throw new ForbiddenException("你不是这个群聊的成员。");
    return member;
  }

  private assertManageableTarget(
    group: GroupRecord,
    actor: GroupRecord["members"][number],
    targetUserId: number,
  ) {
    if (targetUserId === actor.userId) throw new BadRequestException("不能对自己执行这个操作。");
    const target = group.members.find((item) => item.userId === targetUserId && item.status === ChatGroupMemberStatus.active);
    if (!target) throw new NotFoundException("群成员不存在。");
    const rank = { owner: 3, admin: 2, member: 1 } as const;
    if (rank[actor.role] <= rank[target.role]) throw new ForbiddenException("不能操作同级或更高角色的群成员。");
    return target;
  }

  private assertCapacity(group: GroupRecord): void {
    const count = group.members.filter((member) => member.status === ChatGroupMemberStatus.active).length;
    if (count >= group.memberLimit) throw new BadRequestException(`群成员已达到 ${group.memberLimit} 人上限。`);
  }

  private async expireInvitations(inviteeId: number): Promise<void> {
    await this.prisma.chatGroupInvitation.updateMany({
      where: { inviteeId, status: ChatGroupInvitationStatus.pending, expiresAt: { lte: new Date() } },
      data: { status: ChatGroupInvitationStatus.expired, respondedAt: new Date() },
    });
  }

  private toGroup(group: GroupRecord, userId: number, siteManager = false): ChatGroupResponse {
    return {
      ...this.toSummary(group, userId, siteManager),
      owner: this.toUser(group.owner),
      banRecords: group.banRecords.map((record) => this.toBanRecord(record)),
      members: group.members.map((member) => ({
        user: this.toUser(member.user),
        role: member.role,
        status: member.status,
        alias: member.alias,
        mutedUntil: member.mutedUntil?.toISOString() ?? null,
        joinedAt: member.joinedAt.toISOString(),
        isSelf: member.userId === userId,
      })),
    };
  }

  private toSummary(group: GroupRecord, userId: number, siteManager = false): ChatGroupSummaryResponse {
    const member = group.members.find((item) => item.userId === userId && item.status === ChatGroupMemberStatus.active) ?? null;
    return {
      id: group.id,
      conversationId: group.conversationId,
      owner: this.toUser(group.owner),
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
      banReason: group.isBanned && (siteManager || Boolean(member)) ? group.banReason : null,
      currentMemberRole: member?.role ?? null,
      currentAlias: member?.alias ?? null,
      canManage: Boolean(member && member.role !== ChatGroupMemberRole.member),
      canModerate: siteManager,
      canInvite: Boolean(member && (member.role !== ChatGroupMemberRole.member || group.membersCanInvite)),
      membersCanInvite: group.membersCanInvite,
      pendingJoinRequestCount: member && member.role !== ChatGroupMemberRole.member ? group.joinRequests.length : 0,
      pendingReportCount: member && member.role !== ChatGroupMemberRole.member ? group.reports.length : 0,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  }

  private toReport(report: {
    id: number;
    reason: string;
    detail: string | null;
    status: ChatGroupReportStatus;
    resolution: string | null;
    handledAt: Date | null;
    createdAt: Date;
    group: GroupRecord;
    message: GroupMessageRecord;
    reporter: GroupUserRecord;
  }, userId: number): ChatGroupReportResponse {
    const group = this.toSummary(report.group, userId);
    return {
      id: report.id,
      group: { id: group.id, conversationId: group.conversationId, name: group.name, avatarUrl: group.avatarUrl },
      message: this.toMessage(
        report.message,
        report.group.members.find((member) => member.userId === report.message.senderId)?.alias ?? undefined,
      ),
      reporter: this.toUser(report.reporter),
      reason: report.reason,
      detail: report.detail,
      status: report.status,
      resolution: report.resolution,
      handledAt: report.handledAt?.toISOString() ?? null,
      createdAt: report.createdAt.toISOString(),
    };
  }

  private toBanRecord(record: {
    id: number;
    reason: string;
    startsAt: Date;
    expiresAt: Date | null;
    liftedAt: Date | null;
    createdAt: Date;
    actor: GroupUserRecord;
    liftedBy: GroupUserRecord | null;
  }) {
    return {
      id: record.id,
      reason: record.reason,
      startsAt: record.startsAt.toISOString(),
      expiresAt: record.expiresAt?.toISOString() ?? null,
      liftedAt: record.liftedAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      actor: this.toUser(record.actor),
      liftedBy: record.liftedBy ? this.toUser(record.liftedBy) : null,
    };
  }

  private formatMinute(value: Date): string {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(value);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "unknown error";
  }

  private toMessage(message: GroupMessageRecord, senderDisplayName?: string): ChatMessageResponse {
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
      sender: this.toUser(message.sender),
      senderDisplayName: senderDisplayName || message.sender.nickname || message.sender.username,
      readAt: message.readAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private toUser(user: GroupUserRecord): SocialUserResponse {
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

  private avatarFormat(file: UploadedGroupAvatar): { extension: string; mimeType: string } {
    const buffer = file.buffer;
    const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const webp = buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
    if (jpeg && file.mimetype === "image/jpeg") return { extension: ".jpg", mimeType: "image/jpeg" };
    if (png && file.mimetype === "image/png") return { extension: ".png", mimeType: "image/png" };
    if (webp && file.mimetype === "image/webp") return { extension: ".webp", mimeType: "image/webp" };
    throw new BadRequestException("群头像只支持有效的 JPEG、PNG 或 WebP 图片。");
  }

  private avatarPath(storedName: string): string {
    if (!/^group-[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(storedName) || basename(storedName) !== storedName) {
      throw new NotFoundException("群头像不存在。");
    }
    const filePath = resolve(this.avatarDirectory, storedName);
    const prefix = `${this.avatarDirectory}${process.platform === "win32" ? "\\" : "/"}`;
    if (!filePath.startsWith(prefix)) throw new NotFoundException("群头像不存在。");
    return filePath;
  }

  private async deleteAvatar(storedName: string | null): Promise<void> {
    if (!storedName) return;
    await unlink(this.avatarPath(storedName)).catch(() => undefined);
  }

  private runCleanupInBackground(): void {
    void this.cleanupExpiredGroups().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to clean expired temporary groups: ${message}`, stack);
    });
  }

  private numberSetting(name: string, fallback: number, min: number, max: number): number {
    const parsed = Number(process.env[name]);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
  }
}

export { GROUP_AVATAR_MAX_FILE_SIZE_BYTES, type UploadedGroupAvatar };
