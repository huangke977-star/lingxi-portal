import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, ReputationReason } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  ReputationLevelResponse,
  ReputationSummaryResponse,
} from "./reputation.types";

interface ReputationRule {
  reason: ReputationReason;
  label: string;
  experience: number;
  points: number;
  dailyExperienceCap: number | null;
}

interface AwardInput {
  userId: number;
  reason: ReputationReason;
  eventKey: string;
  description: string;
  experience?: number;
  points?: number;
  dailyExperienceCap?: number | null;
  metadata?: Prisma.InputJsonValue;
}

export const REPUTATION_LEVELS: ReputationLevelResponse[] = [
  { code: "qi_refining", name: "练气", level: 10, minExperience: 0 },
  { code: "foundation_building", name: "筑基", level: 20, minExperience: 100 },
  { code: "golden_core", name: "金丹", level: 30, minExperience: 300 },
  { code: "nascent_soul", name: "元婴", level: 40, minExperience: 600 },
  {
    code: "spirit_transformation",
    name: "化神",
    level: 50,
    minExperience: 1000,
  },
  { code: "void_refining", name: "炼虚", level: 60, minExperience: 1500 },
  { code: "body_integration", name: "合体", level: 70, minExperience: 2200 },
  { code: "mahayana", name: "大乘", level: 80, minExperience: 3000 },
];

export const REPUTATION_RULES: ReputationRule[] = [
  {
    reason: ReputationReason.article_read,
    label: "首次阅读一篇文章",
    experience: 1,
    points: 0,
    dailyExperienceCap: 20,
  },
  {
    reason: ReputationReason.article_comment,
    label: "发布一条评论或回复",
    experience: 3,
    points: 0,
    dailyExperienceCap: 30,
  },
  {
    reason: ReputationReason.article_publish,
    label: "首次发布一篇文章",
    experience: 20,
    points: 10,
    dailyExperienceCap: null,
  },
  {
    reason: ReputationReason.article_liked,
    label: "文章首次获得一位用户点赞",
    experience: 0,
    points: 2,
    dailyExperienceCap: null,
  },
  {
    reason: ReputationReason.author_subscribed,
    label: "首次获得一位用户订阅",
    experience: 0,
    points: 5,
    dailyExperienceCap: null,
  },
];

@Injectable()
export class ReputationService {
  constructor(private readonly prisma: PrismaService) {}

  async getMySummary(userId: number): Promise<ReputationSummaryResponse> {
    const [user, recent] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { experience: true, points: true },
      }),
      this.prisma.userReputationLedger.findMany({
        where: {
          userId,
          OR: [{ experienceDelta: { not: 0 } }, { pointDelta: { not: 0 } }],
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
    ]);
    if (!user) throw new BadRequestException("用户不存在。");
    const { level, nextLevel, experienceToNext, progressPercent } =
      this.levelProgress(user.experience);
    return {
      experience: user.experience,
      points: user.points,
      level,
      nextLevel,
      experienceToNext,
      progressPercent,
      rules: REPUTATION_RULES.map((rule) => ({ ...rule })),
      recent: recent.map((item) => ({
        id: item.id,
        reason: item.reason,
        description: item.description,
        experienceDelta: item.experienceDelta,
        pointDelta: item.pointDelta,
        experienceAfter: item.experienceAfter,
        pointsAfter: item.pointsAfter,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  awardArticleRead(
    transaction: Prisma.TransactionClient,
    userId: number,
    articleId: number,
  ): Promise<boolean> {
    const rule = this.rule(ReputationReason.article_read);
    return this.award(transaction, {
      userId,
      reason: rule.reason,
      eventKey: `article-read:${articleId}`,
      description: "阅读文章",
      experience: rule.experience,
      dailyExperienceCap: rule.dailyExperienceCap,
      metadata: { articleId },
    });
  }

  awardArticleComment(
    transaction: Prisma.TransactionClient,
    userId: number,
    commentId: number,
    articleId: number,
  ): Promise<boolean> {
    const rule = this.rule(ReputationReason.article_comment);
    return this.award(transaction, {
      userId,
      reason: rule.reason,
      eventKey: `article-comment:${commentId}`,
      description: "发布文章评论",
      experience: rule.experience,
      dailyExperienceCap: rule.dailyExperienceCap,
      metadata: { articleId, commentId },
    });
  }

  awardArticlePublished(
    transaction: Prisma.TransactionClient,
    userId: number,
    articleId: number,
  ): Promise<boolean> {
    const rule = this.rule(ReputationReason.article_publish);
    return this.award(transaction, {
      userId,
      reason: rule.reason,
      eventKey: `article-publish:${articleId}`,
      description: "首次发布文章",
      experience: rule.experience,
      points: rule.points,
      metadata: { articleId },
    });
  }

  awardArticleLiked(
    transaction: Prisma.TransactionClient,
    authorId: number,
    articleId: number,
    likerId: number,
  ): Promise<boolean> {
    if (authorId === likerId) return Promise.resolve(false);
    const rule = this.rule(ReputationReason.article_liked);
    return this.award(transaction, {
      userId: authorId,
      reason: rule.reason,
      eventKey: `article-liked:${articleId}:${likerId}`,
      description: "文章获得点赞",
      points: rule.points,
      metadata: { articleId, likerId },
    });
  }

  awardAuthorSubscribed(
    transaction: Prisma.TransactionClient,
    authorId: number,
    subscriberId: number,
  ): Promise<boolean> {
    const rule = this.rule(ReputationReason.author_subscribed);
    return this.award(transaction, {
      userId: authorId,
      reason: rule.reason,
      eventKey: `author-subscribed:${subscriberId}`,
      description: "获得新的订阅者",
      points: rule.points,
      metadata: { subscriberId },
    });
  }

  async transferResourcePoints(
    transaction: Prisma.TransactionClient,
    input: {
      buyerId: number;
      authorId: number;
      articleId: number;
      pointCost: number;
    },
  ): Promise<void> {
    const buyer = await transaction.user.findUnique({
      where: { id: input.buyerId },
      select: { experience: true, points: true },
    });
    if (!buyer) throw new BadRequestException("用户不存在。");
    if (buyer.points < input.pointCost) {
      throw new BadRequestException(
        `积分不足，还差 ${input.pointCost - buyer.points} 积分。`,
      );
    }
    const deducted = await transaction.user.updateMany({
      where: { id: input.buyerId, points: { gte: input.pointCost } },
      data: { points: { decrement: input.pointCost } },
    });
    if (deducted.count !== 1)
      throw new BadRequestException("积分不足，请刷新后重试。");
    const buyerAfter = await transaction.user.findUnique({
      where: { id: input.buyerId },
      select: { points: true },
    });
    if (!buyerAfter) throw new BadRequestException("用户不存在。");
    await transaction.userReputationLedger.create({
      data: {
        userId: input.buyerId,
        reason: ReputationReason.resource_redeemed,
        eventKey: `resource-redeemed:${input.articleId}`,
        description: "兑换文章资源",
        pointDelta: -input.pointCost,
        experienceAfter: buyer.experience,
        pointsAfter: buyerAfter.points,
        metadata: { articleId: input.articleId, authorId: input.authorId },
      },
    });

    const author = await transaction.user.update({
      where: { id: input.authorId },
      data: { points: { increment: input.pointCost } },
      select: { experience: true, points: true },
    });
    await transaction.userReputationLedger.create({
      data: {
        userId: input.authorId,
        reason: ReputationReason.resource_sold,
        eventKey: `resource-sold:${input.articleId}:${input.buyerId}`,
        description: "文章资源被兑换",
        pointDelta: input.pointCost,
        experienceAfter: author.experience,
        pointsAfter: author.points,
        metadata: { articleId: input.articleId, buyerId: input.buyerId },
      },
    });
  }

  private async award(
    transaction: Prisma.TransactionClient,
    input: AwardInput,
  ): Promise<boolean> {
    const existing = await transaction.userReputationLedger.findUnique({
      where: {
        userId_eventKey: { userId: input.userId, eventKey: input.eventKey },
      },
      select: { id: true },
    });
    if (existing) return false;

    const requestedExperience = Math.max(0, input.experience ?? 0);
    let experienceDelta = requestedExperience;
    if (requestedExperience && input.dailyExperienceCap) {
      const aggregate = await transaction.userReputationLedger.aggregate({
        where: {
          userId: input.userId,
          reason: input.reason,
          createdAt: { gte: this.shanghaiDayStart() },
        },
        _sum: { experienceDelta: true },
      });
      const remaining = Math.max(
        0,
        input.dailyExperienceCap - (aggregate._sum.experienceDelta ?? 0),
      );
      experienceDelta = Math.min(requestedExperience, remaining);
    }
    const pointDelta = input.points ?? 0;
    const current = await transaction.user.findUnique({
      where: { id: input.userId },
      select: {
        experience: true,
        points: true,
        role: { select: { level: true } },
      },
    });
    if (!current) throw new BadRequestException("用户不存在。");
    const updated =
      experienceDelta || pointDelta
        ? await transaction.user.update({
            where: { id: input.userId },
            data: {
              experience: experienceDelta
                ? { increment: experienceDelta }
                : undefined,
              points: pointDelta ? { increment: pointDelta } : undefined,
            },
            select: { experience: true, points: true },
          })
        : { experience: current.experience, points: current.points };
    await transaction.userReputationLedger.create({
      data: {
        userId: input.userId,
        reason: input.reason,
        eventKey: input.eventKey,
        experienceDelta,
        pointDelta,
        experienceAfter: updated.experience,
        pointsAfter: updated.points,
        description: input.description,
        metadata: input.metadata,
      },
    });
    await this.promoteGrowthRole(
      transaction,
      input.userId,
      current.role.level,
      updated.experience,
    );
    return experienceDelta !== 0 || pointDelta !== 0;
  }

  private async promoteGrowthRole(
    transaction: Prisma.TransactionClient,
    userId: number,
    currentRoleLevel: number,
    experience: number,
  ): Promise<void> {
    if (currentRoleLevel >= 90) return;
    const target = this.levelForExperience(experience);
    if (target.level <= currentRoleLevel) return;
    const role = await transaction.role.findUnique({
      where: { code: target.code },
      select: { id: true },
    });
    if (role)
      await transaction.user.update({
        where: { id: userId },
        data: { roleId: role.id },
      });
  }

  private levelProgress(experience: number) {
    const level = this.levelForExperience(experience);
    const currentIndex = REPUTATION_LEVELS.findIndex(
      (item) => item.code === level.code,
    );
    const nextLevel = REPUTATION_LEVELS[currentIndex + 1] ?? null;
    if (!nextLevel) {
      return { level, nextLevel, experienceToNext: 0, progressPercent: 100 };
    }
    const span = nextLevel.minExperience - level.minExperience;
    const progressPercent = Math.max(
      0,
      Math.min(
        100,
        Math.round(((experience - level.minExperience) / span) * 100),
      ),
    );
    return {
      level,
      nextLevel,
      experienceToNext: Math.max(0, nextLevel.minExperience - experience),
      progressPercent,
    };
  }

  private levelForExperience(experience: number): ReputationLevelResponse {
    return (
      [...REPUTATION_LEVELS]
        .reverse()
        .find((level) => experience >= level.minExperience) ??
      REPUTATION_LEVELS[0]
    );
  }

  private rule(reason: ReputationReason): ReputationRule {
    const rule = REPUTATION_RULES.find((item) => item.reason === reason);
    if (!rule) throw new Error(`Missing reputation rule: ${reason}`);
    return rule;
  }

  private shanghaiDayStart(now = new Date()): Date {
    const shanghai = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const utcMidnight = Date.UTC(
      shanghai.getUTCFullYear(),
      shanghai.getUTCMonth(),
      shanghai.getUTCDate(),
    );
    return new Date(utcMidnight - 8 * 60 * 60 * 1000);
  }
}
