import { ForbiddenException } from "@nestjs/common";
import { FeedbackService } from "../src/feedback/feedback.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";

const user = {
  id: 7,
  nickname: "反馈用户",
  username: "feedback-user",
  isSuperAdmin: false,
  role: { code: "qi_refining", name: "练气", level: 10 },
} as AuthenticatedUser;

const manager = {
  id: 99,
  nickname: "管理员",
  username: "admin",
  isSuperAdmin: false,
  role: { code: "administrator", name: "管理员", level: 90 },
} as AuthenticatedUser;

function feedbackRecord(status = "pending") {
  return {
    id: 12,
    userId: user.id,
    category: "bug",
    title: "页面异常",
    content: "这里有一个问题。",
    status,
    reviewedAt: null,
    user: { id: user.id, username: user.username, nickname: user.nickname, avatarStoredName: null },
    reviewedBy: null,
    replies: [],
    createdAt: new Date("2026-08-17T01:00:00.000Z"),
    updatedAt: new Date("2026-08-17T01:00:00.000Z"),
  };
}

describe("FeedbackService", () => {
  it("only allows managers to open the private feedback inbox", async () => {
    const service = new FeedbackService({} as PrismaService);

    expect(() => service.listInbox(user, { page: 1, pageSize: 12 })).toThrow(ForbiddenException);
  });

  it("updates status and notifies the feedback owner", async () => {
    const item = feedbackRecord();
    const updated = { ...item, status: "in_progress" };
    const update = jest.fn(async () => updated);
    const createNotification = jest.fn(async () => ({ id: 31 }));
    const prisma = {
      userFeedback: {
        findUnique: jest.fn(async () => item),
        update,
      },
      userNotification: { create: createNotification },
    };
    const service = new FeedbackService(prisma as unknown as PrismaService);

    await expect(service.updateStatus(manager, item.id, { status: "in_progress" })).resolves.toMatchObject({ status: "in_progress" });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: item.id },
      data: expect.objectContaining({ status: "in_progress", reviewedById: manager.id }),
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: user.id, type: "feedback_updated" }),
    }));
  });

  it("stores manager replies and notifies the feedback owner", async () => {
    const item = feedbackRecord();
    const createReply = jest.fn(async () => ({ id: 44 }));
    const updated = { ...item, replies: [{ id: 44, content: "已收到。", author: { id: manager.id, username: manager.username, nickname: manager.nickname, avatarStoredName: null }, createdAt: new Date("2026-08-17T02:00:00.000Z") }] };
    const updateFeedback = jest.fn(async () => updated);
    const prisma = {
      userFeedback: { findUnique: jest.fn(async () => item), update: updateFeedback },
      userFeedbackReply: { create: createReply },
      $transaction: jest.fn(async (callback: (client: object) => Promise<unknown>) => callback({ userFeedbackReply: { create: createReply }, userFeedback: { update: updateFeedback } })),
      userNotification: { create: jest.fn(async () => ({ id: 32 })) },
    };
    const service = new FeedbackService(prisma as unknown as PrismaService);

    await expect(service.reply(manager, item.id, { content: "已收到。" })).resolves.toMatchObject({ replies: [{ content: "已收到。" }] });
    expect(createReply).toHaveBeenCalledWith({ data: { feedbackId: item.id, authorId: manager.id, content: "已收到。" } });
    expect(prisma.userNotification.create).toHaveBeenCalled();
  });
});
