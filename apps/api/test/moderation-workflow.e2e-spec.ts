import { ModerationWorkflowService } from "../src/moderation/moderation-workflow.service";
import { AuthenticatedUser } from "../src/auth/auth.types";

const manager: AuthenticatedUser = {
  id: 1, username: "manager", nickname: "管理员", email: "manager@example.com", status: "active", isSuperAdmin: false, isAdministrator: true,
  avatarUrl: null, profileBio: "", createdAt: new Date(), appearance: { themeId: "sakura-mist", customAccent: "#db2777", customSurface: "#fff", customForeground: "#111", customMuted: "#666", cardAlpha: 50, glassBlur: 20, glassTint: "#fff", glassTintAlpha: 70 }, role: { code: "member", name: "成员", level: 1 },
};

describe("ModerationWorkflowService", () => {
  it("routes each source through the canonical moderation path and returns partial failures", async () => {
    const articles = { moderateArticleReport: jest.fn().mockResolvedValue({ success: true }), moderateCommentReport: jest.fn().mockRejectedValue(new Error("already handled")) };
    const groups = { handleReport: jest.fn().mockResolvedValue({ success: true }) };
    const service = new ModerationWorkflowService(articles as never, groups as never);

    const articleResult = await service.handleBatch(manager, { source: "article", reportIds: [3, 3, 4], status: "resolved", resolution: "已处理" });
    expect(articleResult).toEqual({ succeeded: [3, 4], failed: [] });
    expect(articles.moderateArticleReport).toHaveBeenCalledTimes(2);

    const commentResult = await service.handleBatch(manager, { source: "comment", reportIds: [5], status: "rejected", resolution: "未发现违规" });
    expect(commentResult.failed[0]).toMatchObject({ id: 5, message: "already handled" });

    await service.handleBatch(manager, { source: "group_message", reportIds: [7], status: "resolved", resolution: "已处理" });
    expect(groups.handleReport).toHaveBeenCalledWith(manager, 7, expect.objectContaining({ deleteMessage: false }));
  });
});
