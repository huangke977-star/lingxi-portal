import { ForbiddenException } from "@nestjs/common";
import { AuthenticatedUser } from "../src/auth/auth.types";
import {
  ChatGroupInvitationStatus,
  ChatGroupJoinRequestStatus,
  ChatGroupMemberRole,
  ChatGroupMemberStatus,
  ChatGroupStatus,
} from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { ChatAttachmentsService } from "../src/social/chat-attachments.service";
import { ChatGroupsService } from "../src/social/chat-groups.service";

const owner: AuthenticatedUser = {
  id: 7,
  username: "owner",
  nickname: "群主",
  email: "owner@example.com",
  status: "active",
  isSuperAdmin: false,
  avatarUrl: null,
  profileBio: "",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
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

const groupUser = (id: number) => ({
  id,
  nickname: `用户${id}`,
  username: `user-${id}`,
  avatarStoredName: null,
  profileBio: "介绍",
  isSuperAdmin: false,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  status: "active",
  role: { code: "qi_refining", name: "练气", level: 10 },
});

function groupRecord(currentRole: "owner" | "admin" | "member" = "owner") {
  return {
    id: 11,
    conversationId: 21,
    ownerId: 7,
    owner: groupUser(7),
    name: "测试群聊",
    announcement: "公告",
    avatarUrl: null,
    avatarOriginalName: null,
    avatarStoredName: null,
    avatarMimeType: null,
    avatarSizeBytes: null,
    joinMode: "approval",
    membersCanInvite: false,
    memberLimit: 100,
    temporary: false,
    expiresAt: null,
    status: ChatGroupStatus.active,
    dissolvedAt: null,
    members: [
      {
        groupId: 11,
        userId: 7,
        user: groupUser(7),
        role: currentRole,
        status: ChatGroupMemberStatus.active,
        alias: null,
        mutedUntil: null,
        joinedAt: new Date("2026-08-01T00:00:00.000Z"),
        leftAt: null,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
      {
        groupId: 11,
        userId: 8,
        user: groupUser(8),
        role: ChatGroupMemberRole.member,
        status: ChatGroupMemberStatus.active,
        alias: "成员八",
        mutedUntil: null,
        joinedAt: new Date("2026-08-02T00:00:00.000Z"),
        leftAt: null,
        createdAt: new Date("2026-08-02T00:00:00.000Z"),
        updatedAt: new Date("2026-08-02T00:00:00.000Z"),
      },
    ],
    joinRequests: [],
    reports: [],
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
  };
}

const attachments = {
  deleteStoredFiles: jest.fn(async () => undefined),
  toResponse: jest.fn(),
};

function createService(prisma: object) {
  return new ChatGroupsService(
    prisma as PrismaService,
    attachments as unknown as ChatAttachmentsService,
  );
}

function createInviteFixture({ pending, unread }: { pending: boolean; unread: boolean }) {
  const createInvitations = jest.fn(async () => ({ count: 1 }));
  const createNotifications = jest.fn(async () => ({ count: 1 }));
  const createActivity = jest.fn(async () => ({ id: 41 }));
  const transaction = {
    chatGroupInvitation: { createMany: createInvitations },
    userNotification: { createMany: createNotifications },
    chatGroupActivityLog: { create: createActivity },
  };
  const service = createService({
    chatGroup: { findUnique: jest.fn(async () => groupRecord()) },
    user: { findMany: jest.fn(async () => [{ id: 9 }]) },
    chatGroupInvitation: {
      findMany: jest.fn(async () => pending ? [{ inviteeId: 9 }] : []),
    },
    userNotification: {
      findMany: jest.fn(async () => unread ? [{ userId: 9 }] : []),
    },
    chatGroupActivityLog: { create: createActivity },
    $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
  });
  return { createActivity, createInvitations, createNotifications, service };
}

describe("ChatGroupsService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists active groups with the current member role and member count", async () => {
    const service = createService({ chatGroup: { findMany: jest.fn(async () => [groupRecord()]) } });

    const result = await service.listMine(owner);

    expect(result.memberLimit).toBe(100);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 11,
        conversationId: 21,
        memberCount: 2,
        currentMemberRole: "owner",
        canManage: true,
      }),
    ]);
  });

  it("does not let a regular member modify group settings", async () => {
    const service = createService({ chatGroup: { findUnique: jest.fn(async () => groupRecord("member")) } });

    await expect(service.update(owner, 11, { name: "新名称" })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("creates an invitation and notification for a newly invited user", async () => {
    const fixture = createInviteFixture({ pending: false, unread: false });

    await expect(fixture.service.invite(owner, 11, { userIds: [9] })).resolves.toEqual({ count: 1 });
    expect(fixture.createInvitations).toHaveBeenCalledWith({
      data: [expect.objectContaining({ groupId: 11, inviterId: owner.id, inviteeId: 9 })],
    });
    expect(fixture.createNotifications).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 9, title: "新的群聊邀请" })],
    });
  });

  it("does not repeat an unread notification for an existing pending invitation", async () => {
    const fixture = createInviteFixture({ pending: true, unread: true });

    await expect(fixture.service.invite(owner, 11, { userIds: [9] })).resolves.toEqual({ count: 0 });
    expect(fixture.createInvitations).not.toHaveBeenCalled();
    expect(fixture.createNotifications).not.toHaveBeenCalled();
    expect(fixture.createActivity).toHaveBeenCalledTimes(1);
  });

  it("sends a fresh notification when the pending invitation was already read", async () => {
    const fixture = createInviteFixture({ pending: true, unread: false });

    await expect(fixture.service.invite(owner, 11, { userIds: [9] })).resolves.toEqual({ count: 1 });
    expect(fixture.createInvitations).not.toHaveBeenCalled();
    expect(fixture.createNotifications).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 9, title: "新的群聊邀请" })],
    });
  });

  it("cancels a pending join request when an invitation is accepted", async () => {
    const invitee = { ...owner, id: 9, username: "invitee", nickname: "受邀用户" };
    const invitation = {
      id: 61,
      groupId: 11,
      inviterId: owner.id,
      inviteeId: invitee.id,
      status: ChatGroupInvitationStatus.pending,
      expiresAt: new Date(Date.now() + 60_000),
      group: groupRecord(),
    };
    const cancelRequests = jest.fn(async () => ({ count: 1 }));
    const updateNotifications = jest.fn(async () => ({ count: 1 }));
    const transaction = {
      chatGroupMember: { upsert: jest.fn(async () => ({})) },
      conversationParticipantState: { upsert: jest.fn(async () => ({})) },
      chatGroupInvitation: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => invitation),
      },
      chatGroupJoinRequest: {
        findMany: jest.fn(async () => [{ id: 71 }]),
        updateMany: cancelRequests,
      },
      userNotification: { updateMany: updateNotifications },
      chatGroupActivityLog: { create: jest.fn(async () => ({})) },
    };
    const service = createService({
      chatGroupInvitation: { findUnique: jest.fn(async () => invitation) },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    });
    jest.spyOn(service, "get").mockResolvedValue({ id: 11 } as never);

    await service.respondInvitation(invitee, invitation.id, { status: "accepted" });

    expect(cancelRequests).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ChatGroupJoinRequestStatus.cancelled }),
      where: { id: { in: [71] } },
    }));
    expect(updateNotifications).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ actionUrl: "/messages?groupApproval=11&joinRequest=71" }),
    }));
  });

  it("cancels pending invitations when a join request is approved", async () => {
    const cancelInvitations = jest.fn(async () => ({ count: 1 }));
    const transaction = {
      chatGroupMember: { upsert: jest.fn(async () => ({})) },
      conversationParticipantState: { upsert: jest.fn(async () => ({})) },
      chatGroupJoinRequest: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({})),
      },
      chatGroupInvitation: { updateMany: cancelInvitations },
      userNotification: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        create: jest.fn(async () => ({})),
      },
      chatGroupActivityLog: { create: jest.fn(async () => ({})) },
    };
    const service = createService({
      chatGroup: { findUnique: jest.fn(async () => groupRecord()) },
      chatGroupJoinRequest: {
        findUnique: jest.fn(async () => ({ id: 72, groupId: 11, userId: 9, status: ChatGroupJoinRequestStatus.pending })),
      },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    });

    await service.respondJoinRequest(owner, 11, 72, { status: "approved" });

    expect(cancelInvitations).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: ChatGroupInvitationStatus.cancelled }),
      where: expect.objectContaining({ groupId: 11, inviteeId: 9, status: ChatGroupInvitationStatus.pending }),
    }));
  });

  it("creates one pending report for another member's message", async () => {
    const upsert = jest.fn(async () => ({ id: 31 }));
    const activity = jest.fn(async () => ({ id: 41 }));
    const notifications = jest.fn(async () => ({ count: 1 }));
    const transaction = {
      chatGroupActivityLog: { create: activity },
      userNotification: { createMany: notifications },
    };
    const service = createService({
      chatGroup: { findUnique: jest.fn(async () => groupRecord()) },
      chatMessage: { findFirst: jest.fn(async () => ({ id: 51, senderId: 8, type: "text", body: "一条待举报消息" })) },
      chatGroupMessageReport: { upsert },
      chatGroupActivityLog: { create: activity },
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction)),
    });

    await expect(service.reportMessage(owner, 11, 51, { reason: "spam", detail: "重复广告" }))
      .resolves.toEqual({ id: 31, status: "pending" });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { messageId_reporterId: { messageId: 51, reporterId: owner.id } },
      create: expect.objectContaining({ groupId: 11, messageId: 51, reason: "spam" }),
    }));
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "message.reported" }) }));
  });

  it("physically cleans expired temporary conversations and their attachments", async () => {
    const deleteConversation = jest.fn(async () => ({ id: 21 }));
    const service = createService({
      chatGroup: { findMany: jest.fn(async () => [{
        id: 11,
        conversationId: 21,
        avatarStoredName: null,
        conversation: { attachments: [{ storedName: "expired.webp" }] },
      }]) },
      conversation: { delete: deleteConversation },
    });

    await service.cleanupExpiredGroups();

    expect(deleteConversation).toHaveBeenCalledWith({ where: { id: 21 } });
    expect(attachments.deleteStoredFiles).toHaveBeenCalledWith(["expired.webp"]);
  });
});
