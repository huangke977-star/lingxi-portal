import { PrismaService } from "../src/prisma/prisma.service";
import { ModerationService } from "../src/moderation/moderation.service";

const user = (id: number, nickname: string) => ({
  id,
  nickname,
  username: `user-${id}`,
  avatarStoredName: null,
  isSuperAdmin: false,
  isAdministrator: false,
  role: { code: "member", name: "成员", level: 1 },
});

describe("ModerationService", () => {
  it("merges the three report sources into one time-ordered page", async () => {
    const prisma = {
      articleCommentReport: {
        findMany: jest.fn().mockResolvedValue([{
          id: 2,
          reason: "spam",
          detail: "评论广告",
          status: "pending",
          resolution: null,
          handledAt: null,
          createdAt: new Date("2026-08-21T10:02:00Z"),
          reporter: user(4, "评论举报人"),
          comment: {
            id: 8,
            body: "评论内容",
            status: "active",
            author: user(5, "评论作者"),
            article: { id: 11, title: "评论所属文章", slug: "comment-article", author: user(6, "文章作者") },
          },
        }]),
        count: jest.fn().mockResolvedValue(1),
      },
      articleReport: {
        findMany: jest.fn().mockResolvedValue([{
          id: 3,
          reason: "illegal",
          detail: null,
          status: "pending",
          resolution: null,
          handledAt: null,
          createdAt: new Date("2026-08-21T10:03:00Z"),
          reporter: user(7, "文章举报人"),
          article: { id: 12, title: "文章举报内容", slug: "article-report", author: user(8, "文章作者") },
        }]),
        count: jest.fn().mockResolvedValue(1),
      },
      chatGroupMessageReport: {
        findMany: jest.fn().mockResolvedValue([{
          id: 4,
          reason: "harassment",
          detail: null,
          status: "pending",
          resolution: null,
          handledAt: null,
          createdAt: new Date("2026-08-21T10:01:00Z"),
          reporter: user(9, "群举报人"),
          group: { id: 13, conversationId: 14, name: "测试群", avatarUrl: null, avatarStoredName: null },
          message: { id: 15, body: "群消息内容", type: "text", createdAt: new Date("2026-08-21T10:00:00Z"), sender: user(10, "消息发送者"), attachments: [] },
        }]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const service = new ModerationService(prisma as unknown as PrismaService);

    const result = await service.listReports({ status: "pending", page: 1, pageSize: 10 });

    expect(result.total).toBe(3);
    expect(result.items.map((item) => item.source)).toEqual(["article", "comment", "group_message"]);
    expect(result.items[0]).toMatchObject({ key: "article-3", sourceLabel: "文章举报", targetUser: { nickname: "文章作者" } });
    expect(result.items[2]).toMatchObject({ group: { name: "测试群" }, message: { body: "群消息内容" } });
  });

  it("can restrict the queue to one source without querying the other rows", async () => {
    const prisma = {
      articleCommentReport: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      articleReport: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      chatGroupMessageReport: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };
    const service = new ModerationService(prisma as unknown as PrismaService);

    await service.listReports({ status: "all", type: "group_message", page: 1, pageSize: 20 });

    expect(prisma.chatGroupMessageReport.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.articleCommentReport.findMany).not.toHaveBeenCalled();
    expect(prisma.articleReport.findMany).not.toHaveBeenCalled();
    expect(prisma.chatGroupMessageReport.count).toHaveBeenCalledTimes(1);
  });
});
