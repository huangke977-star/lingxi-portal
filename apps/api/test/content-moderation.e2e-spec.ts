import { BadRequestException } from "@nestjs/common";
import { ModerationRuleAction, ModerationRuleType } from "../src/generated/prisma/client";
import { ContentModerationService } from "../src/moderation/content-moderation.service";
import { PrismaService } from "../src/prisma/prisma.service";

describe("ContentModerationService", () => {
  it("records a sensitive-word hit but lets record-mode content continue", async () => {
    const prisma = {
      moderationRule: {
        findMany: jest.fn().mockResolvedValue([{
          id: 1, type: ModerationRuleType.sensitive_word, action: ModerationRuleAction.record,
          sources: "article", keywords: "推广, 违禁", threshold: 1, windowSeconds: 60,
        }]),
      },
      moderationRuleHit: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new ContentModerationService(prisma as unknown as PrismaService);

    await expect(service.enforce({ source: "article", actorId: 8, content: "这是推广内容" })).resolves.toBeUndefined();
    expect(prisma.moderationRuleHit.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ ruleId: 1, actorId: 8, action: ModerationRuleAction.record, detail: expect.stringContaining("推广") })],
    }));
  });

  it("records and blocks a configured sensitive word", async () => {
    const prisma = {
      moderationRule: {
        findMany: jest.fn().mockResolvedValue([{
          id: 2, type: ModerationRuleType.sensitive_word, action: ModerationRuleAction.block,
          sources: "comment", keywords: "违禁", threshold: 1, windowSeconds: 60,
        }]),
      },
      moderationRuleHit: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const service = new ContentModerationService(prisma as unknown as PrismaService);

    await expect(service.enforce({ source: "comment", actorId: 8, content: "包含违禁词" })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.moderationRuleHit.createMany).toHaveBeenCalledTimes(1);
  });

  it("excludes the current reference from duplicate checks and records accepted fingerprints", async () => {
    const prisma = {
      moderationRule: {
        findMany: jest.fn().mockResolvedValue([{
          id: 3, type: ModerationRuleType.duplicate_content, action: ModerationRuleAction.block,
          sources: "article", keywords: null, threshold: 1, windowSeconds: 3600,
        }]),
      },
      moderationContentRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 1 }),
      },
      moderationRuleHit: { createMany: jest.fn() },
    };
    const service = new ContentModerationService(prisma as unknown as PrismaService);

    await expect(service.enforce({ source: "article", actorId: 8, content: "相同正文", contentRef: "article:3" })).resolves.toBeUndefined();
    expect(prisma.moderationContentRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contentRef: { not: "article:3" } }),
    }));
    await service.recordAccepted({ source: "article", actorId: 8, content: "相同正文", contentRef: "article:3" });
    expect(prisma.moderationContentRecord.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { source_contentRef: { source: "article", contentRef: "article:3" } },
    }));
  });

  it("uses rolling content records for link-rate and high-frequency rules", async () => {
    const aggregate = jest.fn().mockResolvedValue({ _sum: { linkCount: 2 } });
    const count = jest.fn().mockResolvedValue(3);
    const prisma = {
      moderationRule: {
        findMany: jest.fn().mockResolvedValue([
          { id: 4, type: ModerationRuleType.link_rate, action: ModerationRuleAction.record, sources: "group_message", keywords: null, threshold: 2, windowSeconds: 60 },
          { id: 5, type: ModerationRuleType.high_frequency, action: ModerationRuleAction.record, sources: "group_message", keywords: null, threshold: 3, windowSeconds: 60 },
        ]),
      },
      moderationContentRecord: { aggregate, count },
      moderationRuleHit: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const service = new ContentModerationService(prisma as unknown as PrismaService);

    await service.enforce({ source: "group_message", actorId: 8, content: "https://example.com" });
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledTimes(1);
    expect(prisma.moderationRuleHit.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.arrayContaining([
      expect.objectContaining({ ruleId: 4 }), expect.objectContaining({ ruleId: 5 }),
    ]) }));
  });
});
