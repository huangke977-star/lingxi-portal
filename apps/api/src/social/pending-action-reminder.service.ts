import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  ChatGroupInvitationStatus,
  ChatGroupJoinRequestStatus,
  ChatGroupMemberRole,
  ChatGroupMemberStatus,
  ChatGroupReportStatus,
  FriendshipStatus,
  Prisma,
  UserNotificationType,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const REMINDER_INTERVAL_MS = 60 * 60 * 1000;
const REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;

type ReminderCandidate = {
  key: string;
  userId: number;
  actorId: number | null;
  type: UserNotificationType;
  title: string;
  body: string;
  actionUrl: string;
  friendshipId?: number;
  sourceUpdatedAt: Date;
};

/** Re-notifies unresolved social actions after a full quiet day without inflating current unread counts. */
@Injectable()
export class PendingActionReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PendingActionReminderService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.runInBackground(), REMINDER_INTERVAL_MS);
    this.timer.unref();
    setTimeout(() => void this.runInBackground(), 30_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async runInBackground(): Promise<void> {
    await this.run().catch((error) => {
      this.logger.warn(`Pending-action reminder task failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  async run(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const candidates = await this.listCandidates(now);
      let created = 0;
      for (const candidate of candidates) {
        if (await this.remind(candidate, now)) created += 1;
      }
      return created;
    } finally {
      this.running = false;
    }
  }

  private async listCandidates(now: Date): Promise<ReminderCandidate[]> {
    const [friendships, invitations, joinRequests, reports] = await Promise.all([
      this.prisma.friendship.findMany({
        where: { status: FriendshipStatus.pending },
        select: {
          id: true,
          requestedById: true,
          requestNote: true,
          updatedAt: true,
          userOneId: true,
          userTwoId: true,
          requestedBy: { select: { nickname: true, username: true } },
        },
      }),
      this.prisma.chatGroupInvitation.findMany({
        where: { status: ChatGroupInvitationStatus.pending, expiresAt: { gt: now } },
        select: {
          groupId: true,
          inviteeId: true,
          inviterId: true,
          updatedAt: true,
          group: { select: { name: true } },
          inviter: { select: { nickname: true, username: true } },
        },
      }),
      this.prisma.chatGroupJoinRequest.findMany({
        where: { status: ChatGroupJoinRequestStatus.pending },
        select: {
          id: true,
          groupId: true,
          userId: true,
          updatedAt: true,
          group: {
            select: {
              name: true,
              members: {
                where: {
                  status: ChatGroupMemberStatus.active,
                  role: { in: [ChatGroupMemberRole.owner, ChatGroupMemberRole.admin] },
                },
                select: { userId: true },
              },
            },
          },
          user: { select: { nickname: true, username: true } },
        },
      }),
      this.prisma.chatGroupMessageReport.findMany({
        where: { status: ChatGroupReportStatus.pending },
        select: {
          id: true,
          groupId: true,
          reporterId: true,
          updatedAt: true,
          message: { select: { body: true } },
          group: {
            select: {
              name: true,
              members: {
                where: {
                  status: ChatGroupMemberStatus.active,
                  role: { in: [ChatGroupMemberRole.owner, ChatGroupMemberRole.admin] },
                },
                select: { userId: true },
              },
            },
          },
        },
      }),
    ]);

    return [
      ...friendships.map((item): ReminderCandidate => ({
        key: `friend:${item.id}`,
        userId: item.requestedById === item.userOneId ? item.userTwoId : item.userOneId,
        actorId: item.requestedById,
        type: UserNotificationType.friend_request_received,
        title: "待处理的好友申请",
        body: `${item.requestedBy.nickname || item.requestedBy.username} 的好友申请仍在等待处理。${item.requestNote ? ` 备注：${item.requestNote}` : ""}`,
        actionUrl: `/messages?friendshipId=${item.id}`,
        friendshipId: item.id,
        sourceUpdatedAt: item.updatedAt,
      })),
      ...invitations.map((item): ReminderCandidate => ({
        key: `group-invitation:${item.groupId}:${item.inviteeId}`,
        userId: item.inviteeId,
        actorId: item.inviterId,
        type: UserNotificationType.system,
        title: "待处理的群聊邀请",
        body: `${item.inviter.nickname || item.inviter.username} 邀请你加入群聊“${item.group.name}”。`,
        actionUrl: `/messages?groupApproval=${item.groupId}`,
        sourceUpdatedAt: item.updatedAt,
      })),
      ...joinRequests.flatMap((item) => item.group.members.map((member): ReminderCandidate => ({
        key: `group-join:${item.id}:${member.userId}`,
        userId: member.userId,
        actorId: item.userId,
        type: UserNotificationType.system,
        title: "待处理的入群申请",
        body: `${item.user.nickname || item.user.username} 申请加入群聊“${item.group.name}”。`,
        actionUrl: `/messages?groupApproval=${item.groupId}&joinRequest=${item.id}`,
        sourceUpdatedAt: item.updatedAt,
      }))),
      ...reports.flatMap((item) => item.group.members
        .filter((member) => member.userId !== item.reporterId)
        .map((member): ReminderCandidate => ({
          key: `group-report:${item.id}:${member.userId}`,
          userId: member.userId,
          actorId: item.reporterId,
          type: UserNotificationType.system,
          title: `待处理的群消息举报 · ${item.group.name}`,
          body: item.message.body.trim().slice(0, 180) || "附件消息",
          actionUrl: `/messages?groupApproval=${item.groupId}&report=${item.id}`,
          sourceUpdatedAt: item.updatedAt,
        }))),
    ];
  }

  private async remind(candidate: ReminderCandidate, now: Date): Promise<boolean> {
    const latest = await this.prisma.userNotification.findFirst({
      where: {
        userId: candidate.userId,
        actionUrl: candidate.actionUrl,
        ...(candidate.friendshipId ? { friendshipId: candidate.friendshipId } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { readAt: true, updatedAt: true },
    });
    if (latest && !latest.readAt) return false;
    const quietSince = latest?.updatedAt ?? candidate.sourceUpdatedAt;
    if (now.getTime() - quietSince.getTime() < REMINDER_DELAY_MS) return false;

    const bucket = Math.floor((now.getTime() - candidate.sourceUpdatedAt.getTime()) / REMINDER_DELAY_MS);
    const generation = candidate.sourceUpdatedAt.getTime().toString(36);
    const dedupeKey = `pending:${candidate.key}:${generation}:${Math.max(1, bucket)}`;
    try {
      await this.prisma.userNotification.create({
        data: {
          userId: candidate.userId,
          actorId: candidate.actorId,
          type: candidate.type,
          title: candidate.title,
          body: candidate.body,
          actionUrl: candidate.actionUrl,
          friendshipId: candidate.friendshipId,
          dedupeKey,
        },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
      throw error;
    }
  }
}
