import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  ModerationContentSource,
  ModerationRuleAction,
  ModerationRuleType,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export type ModeratedContentSource = "article" | "comment" | "group_message";

interface ContentInput {
  source: ModeratedContentSource;
  actorId: number;
  content: string;
  contentRef?: string;
  attachmentOnly?: boolean;
}

interface RuleMatch {
  ruleId: number;
  action: ModerationRuleAction;
  detail: string;
}

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>()]+/gi;

@Injectable()
export class ContentModerationService {
  constructor(private readonly prisma: PrismaService) {}

  async enforce(input: ContentInput): Promise<void> {
    const rules = await this.prisma.moderationRule.findMany({
      where: { enabled: true },
      orderBy: [{ id: "asc" }],
    });
    if (!rules.length) return;

    const normalized = this.normalizeContent(input.content);
    const contentHash = this.hashContent(normalized);
    const linkCount = this.countLinks(input.content);
    const matches: RuleMatch[] = [];
    for (const rule of rules) {
      if (!this.ruleApplies(rule.sources, input.source)) continue;
      const detail = await this.matchRule(rule, input, normalized, contentHash, linkCount);
      if (detail) matches.push({ ruleId: rule.id, action: rule.action, detail });
    }
    if (!matches.length) return;

    await this.prisma.moderationRuleHit.createMany({
      data: matches.map((match) => ({
        ruleId: match.ruleId,
        actorId: input.actorId,
        source: input.source as ModerationContentSource,
        action: match.action,
        contentPreview: this.preview(input.content),
        detail: match.detail,
      })),
    });
    const blocking = matches.filter((match) => match.action === ModerationRuleAction.block);
    if (blocking.length) {
      throw new BadRequestException(`内容未提交：${blocking.map((match) => match.detail).join("；")}`);
    }
  }

  async recordAccepted(input: ContentInput & { contentRef: string }): Promise<void> {
    const normalized = this.normalizeContent(input.content);
    await this.prisma.moderationContentRecord.upsert({
      where: {
        source_contentRef: {
          source: input.source as ModerationContentSource,
          contentRef: input.contentRef,
        },
      },
      create: {
        userId: input.actorId,
        source: input.source as ModerationContentSource,
        contentRef: input.contentRef,
        contentHash: this.hashContent(normalized),
        linkCount: this.countLinks(input.content),
      },
      update: {
        contentHash: this.hashContent(normalized),
        linkCount: this.countLinks(input.content),
      },
    });
  }

  private async matchRule(
    rule: {
      id: number;
      type: ModerationRuleType;
      keywords: string | null;
      threshold: number;
      windowSeconds: number;
    },
    input: ContentInput,
    normalized: string,
    contentHash: string,
    linkCount: number,
  ): Promise<string | null> {
    if (input.attachmentOnly && rule.type !== ModerationRuleType.high_frequency) return null;
    if (rule.type === ModerationRuleType.sensitive_word) {
      const matched = this.keywords(rule.keywords).filter((word) => normalized.includes(word));
      return matched.length ? `命中敏感词：${matched.slice(0, 3).join("、")}` : null;
    }
    const since = new Date(Date.now() - rule.windowSeconds * 1_000);
    if (rule.type === ModerationRuleType.link_rate) {
      if (!linkCount) return null;
      const aggregate = await this.prisma.moderationContentRecord.aggregate({
        where: { userId: input.actorId, source: input.source as ModerationContentSource, createdAt: { gte: since } },
        _sum: { linkCount: true },
      });
      return (aggregate._sum.linkCount ?? 0) + linkCount > rule.threshold
        ? `${rule.windowSeconds} 秒内链接数量超过 ${rule.threshold}`
        : null;
    }
    if (rule.type === ModerationRuleType.duplicate_content) {
      if (!normalized) return null;
      const existing = await this.prisma.moderationContentRecord.findFirst({
        where: {
          userId: input.actorId,
          source: input.source as ModerationContentSource,
          contentHash,
          createdAt: { gte: since },
          ...(input.contentRef ? { contentRef: { not: input.contentRef } } : {}),
        },
        select: { id: true },
      });
      return existing ? `${rule.windowSeconds} 秒内存在重复内容` : null;
    }
    const count = await this.prisma.moderationContentRecord.count({
      where: { userId: input.actorId, source: input.source as ModerationContentSource, createdAt: { gte: since } },
    });
    return count >= rule.threshold ? `${rule.windowSeconds} 秒内发送次数超过 ${rule.threshold}` : null;
  }

  private ruleApplies(rawSources: string, source: ModeratedContentSource): boolean {
    return rawSources.split(",").map((item) => item.trim()).includes(source);
  }

  private keywords(raw: string | null): string[] {
    return [...new Set((raw ?? "").split(/[\n,，]/).map((item) => this.normalizeContent(item)).filter(Boolean))];
  }

  private normalizeContent(value: string): string {
    return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
  }

  private hashContent(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private countLinks(value: string): number {
    return value.match(URL_PATTERN)?.length ?? 0;
  }

  private preview(value: string): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized ? normalized.slice(0, 240) : "[附件消息]";
  }
}
