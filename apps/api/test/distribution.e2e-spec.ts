import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ArticleStatus, ArticleVisibility } from "../src/generated/prisma/client";
import { DistributionService } from "../src/distribution/distribution.service";

describe("P17 public content distribution", () => {
  function createService(overrides: Record<string, unknown> = {}) {
    const prisma = {
      article: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      user: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      articleTopic: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      articleCollection: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      subscriptionEmailPreference: {
        upsert: jest.fn().mockResolvedValue({ enabled: false, unsubscribedAt: null }),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      subscriptionEmailDelivery: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides,
    };
    const redis = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn().mockResolvedValue(1) };
    const mail = { send: jest.fn() };
    const security = { getConfiguration: jest.fn().mockResolvedValue({ smtpEnabled: false }) };
    const siteSettings = { getPublicSettings: jest.fn().mockResolvedValue({ siteName: "测试站点" }) };
    return {
      service: new DistributionService(prisma as never, redis as never, mail as never, security as never, siteSettings as never),
      prisma,
      redis,
      security,
    };
  }

  it("renders a public-only RSS feed and escapes article text", async () => {
    const { service, prisma } = createService({
      article: {
        findMany: jest.fn().mockResolvedValue([{
          id: 9,
          title: "A < B",
          summary: "safe & visible",
          slug: "public-article",
          publishedAt: new Date("2026-09-03T00:00:00.000Z"),
          updatedAt: new Date("2026-09-03T01:00:00.000Z"),
          author: { nickname: "作者", username: "writer" },
        }]),
      },
    });

    const xml = await service.renderFeed({ kind: "site", path: "/api/distribution/feeds/site.rss", title: "ignored" }, "rss", "127.0.0.1");

    expect(prisma.article.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: ArticleStatus.published, visibility: ArticleVisibility.public }),
    }));
    expect(xml).toContain("测试站点");
    expect(xml).toContain("A &lt; B");
    expect(xml).toContain("safe &amp; visible");
  });

  it("does not expose an author feed when the public profile is unavailable", async () => {
    const { service } = createService();
    await expect(service.renderFeed({ kind: "author", path: "/api/distribution/feeds/authors/private.rss", title: "private", username: "private" }, "rss", "127.0.0.1"))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it("does not allow an email digest to be enabled before SMTP is configured", async () => {
    const { service } = createService();
    await expect(service.updateEmailSettings({ id: 7 } as never, { enabled: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects malformed unauthenticated unsubscribe tokens", async () => {
    const { service } = createService();
    await expect(service.unsubscribeByToken("not-a-token")).rejects.toBeInstanceOf(NotFoundException);
  });
});
