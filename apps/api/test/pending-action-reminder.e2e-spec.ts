import { PrismaService } from "../src/prisma/prisma.service";
import { PendingActionReminderService } from "../src/social/pending-action-reminder.service";

function createFixture(latest: { readAt: Date | null; updatedAt: Date } | null) {
  const create = jest.fn(async () => ({ id: 91 }));
  const prisma = {
    friendship: {
      findMany: jest.fn(async () => [{
        id: 12,
        requestedById: 7,
        requestNote: "一起交流",
        updatedAt: new Date("2026-08-10T00:00:00.000Z"),
        userOneId: 7,
        userTwoId: 8,
        requestedBy: { nickname: "申请人", username: "requester" },
      }]),
    },
    chatGroupInvitation: { findMany: jest.fn(async () => []) },
    chatGroupJoinRequest: { findMany: jest.fn(async () => []) },
    chatGroupMessageReport: { findMany: jest.fn(async () => []) },
    userNotification: { findFirst: jest.fn(async () => latest), create },
  };
  return { create, service: new PendingActionReminderService(prisma as unknown as PrismaService) };
}

describe("PendingActionReminderService", () => {
  it("creates one unread reminder after a full quiet day", async () => {
    const { create, service } = createFixture({
      readAt: new Date("2026-08-10T01:00:00.000Z"),
      updatedAt: new Date("2026-08-10T01:00:00.000Z"),
    });

    await expect(service.run(new Date("2026-08-12T02:00:00.000Z"))).resolves.toBe(1);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 8,
        friendshipId: 12,
        title: "待处理的好友申请",
        dedupeKey: `pending:friend:12:${new Date("2026-08-10T00:00:00.000Z").getTime().toString(36)}:2`,
      }),
    });
  });

  it("does not repeat an existing unread reminder", async () => {
    const { create, service } = createFixture({
      readAt: null,
      updatedAt: new Date("2026-08-11T01:00:00.000Z"),
    });

    await expect(service.run(new Date("2026-08-12T02:00:00.000Z"))).resolves.toBe(0);
    expect(create).not.toHaveBeenCalled();
  });
});
