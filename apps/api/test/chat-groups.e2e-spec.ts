import { ForbiddenException } from "@nestjs/common";
import { AuthenticatedUser } from "../src/auth/auth.types";
import {
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

  it("creates one pending report for another member's message", async () => {
    const upsert = jest.fn(async () => ({ id: 31 }));
    const activity = jest.fn(async () => ({ id: 41 }));
    const service = createService({
      chatGroup: { findUnique: jest.fn(async () => groupRecord()) },
      chatMessage: { findFirst: jest.fn(async () => ({ id: 51, senderId: 8, type: "text" })) },
      chatGroupMessageReport: { upsert },
      chatGroupActivityLog: { create: activity },
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
