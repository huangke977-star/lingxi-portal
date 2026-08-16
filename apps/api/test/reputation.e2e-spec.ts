import { BadRequestException } from "@nestjs/common";
import { ReputationReason } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { ReputationService } from "../src/reputation/reputation.service";

describe("ReputationService", () => {
  it("returns balances, the earned growth level, progress and recent ledger entries", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ experience: 350, points: 42 })),
      },
      userReputationLedger: {
        findMany: jest.fn(async () => [
          {
            id: 1,
            reason: ReputationReason.article_publish,
            description: "首次发布文章",
            experienceDelta: 20,
            pointDelta: 10,
            experienceAfter: 350,
            pointsAfter: 42,
            createdAt: new Date("2026-08-16T01:00:00.000Z"),
          },
        ]),
      },
    };
    const service = new ReputationService(prisma as unknown as PrismaService);

    await expect(service.getMySummary(7)).resolves.toMatchObject({
      experience: 350,
      points: 42,
      level: { code: "golden_core", minExperience: 300 },
      nextLevel: { code: "nascent_soul", minExperience: 600 },
      experienceToNext: 250,
      progressPercent: 17,
      recent: [{ description: "首次发布文章", pointDelta: 10 }],
    });
  });

  it("awards only the remaining daily experience and promotes the growth role", async () => {
    const createLedger = jest.fn(async () => ({ id: 1 }));
    const updateUser = jest.fn(
      async (args: { data: { experience?: unknown; roleId?: number } }) =>
        args.data.roleId ? { id: 7 } : { experience: 100, points: 5 },
    );
    const transaction = {
      userReputationLedger: {
        findUnique: jest.fn(async () => null),
        aggregate: jest.fn(async () => ({ _sum: { experienceDelta: 19 } })),
        create: createLedger,
      },
      user: {
        findUnique: jest.fn(async () => ({
          experience: 99,
          points: 5,
          role: { level: 10 },
        })),
        update: updateUser,
      },
      role: {
        findUnique: jest.fn(async () => ({ id: 2 })),
      },
    };
    const service = new ReputationService({} as PrismaService);

    await expect(
      service.awardArticleRead(transaction as never, 7, 12),
    ).resolves.toBe(true);
    expect(createLedger).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reason: ReputationReason.article_read,
        experienceDelta: 1,
        experienceAfter: 100,
      }),
    });
    expect(transaction.role.findUnique).toHaveBeenCalledWith({
      where: { code: "foundation_building" },
      select: { id: true },
    });
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { roleId: 2 },
    });
  });

  it("records a capped event once without increasing the balance", async () => {
    const createLedger = jest.fn(async () => ({ id: 1 }));
    const updateUser = jest.fn();
    const transaction = {
      userReputationLedger: {
        findUnique: jest.fn(async () => null),
        aggregate: jest.fn(async () => ({ _sum: { experienceDelta: 20 } })),
        create: createLedger,
      },
      user: {
        findUnique: jest.fn(async () => ({
          experience: 80,
          points: 5,
          role: { level: 10 },
        })),
        update: updateUser,
      },
      role: { findUnique: jest.fn() },
    };
    const service = new ReputationService({} as PrismaService);

    await expect(
      service.awardArticleRead(transaction as never, 7, 13),
    ).resolves.toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
    expect(createLedger).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventKey: "article-read:13",
        experienceDelta: 0,
        experienceAfter: 80,
      }),
    });
  });

  it("rejects a resource exchange when the buyer has too few points", async () => {
    const transaction = {
      user: {
        findUnique: jest.fn(async () => ({ experience: 20, points: 4 })),
        updateMany: jest.fn(),
      },
    };
    const service = new ReputationService({} as PrismaService);

    await expect(
      service.transferResourcePoints(transaction as never, {
        buyerId: 7,
        authorId: 8,
        articleId: 12,
        pointCost: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction.user.updateMany).not.toHaveBeenCalled();
  });

  it("moves resource points to the author and writes both immutable ledgers", async () => {
    const createLedger = jest.fn(async () => ({ id: 1 }));
    const findUser = jest
      .fn()
      .mockResolvedValueOnce({ experience: 20, points: 30 })
      .mockResolvedValueOnce({ points: 20 });
    const transaction = {
      user: {
        findUnique: findUser,
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({ experience: 90, points: 55 })),
      },
      userReputationLedger: { create: createLedger },
    };
    const service = new ReputationService({} as PrismaService);

    await service.transferResourcePoints(transaction as never, {
      buyerId: 7,
      authorId: 8,
      articleId: 12,
      pointCost: 10,
    });
    expect(createLedger).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        userId: 7,
        reason: ReputationReason.resource_redeemed,
        pointDelta: -10,
        pointsAfter: 20,
      }),
    });
    expect(createLedger).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        userId: 8,
        reason: ReputationReason.resource_sold,
        pointDelta: 10,
        pointsAfter: 55,
      }),
    });
  });
});
