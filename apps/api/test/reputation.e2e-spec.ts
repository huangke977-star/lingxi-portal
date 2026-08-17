import { BadRequestException } from "@nestjs/common";
import { ReputationReason } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { ReputationService } from "../src/reputation/reputation.service";

describe("ReputationService", () => {
  it("awards an accepted article report only once for the same reporter and article", async () => {
    const ledgerFind = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 8 });
    const createLedger = jest.fn(async () => ({ id: 9 }));
    const transaction = {
      userReputationLedger: {
        findUnique: ledgerFind,
        create: createLedger,
      },
      user: {
        findUnique: jest.fn(async () => ({ experience: 10, points: 2, role: { level: 10 } })),
        update: jest.fn(async () => ({ experience: 30, points: 7 })),
      },
      role: { findUnique: jest.fn(async () => null) },
    };
    const service = new ReputationService({} as PrismaService);

    await expect(service.awardArticleReportAccepted(transaction as never, 7, 12, 8)).resolves.toBe(true);
    await expect(service.awardArticleReportAccepted(transaction as never, 7, 12, 8)).resolves.toBe(false);
    expect(createLedger).toHaveBeenCalledTimes(1);
    expect(createLedger).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventKey: "article-report-accepted:12:7",
        experienceDelta: 20,
        pointDelta: 5,
      }),
    });
  });

  it("returns balances, the earned growth level, progress and recent ledger entries", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ experience: 350, points: 42 })),
      },
      userReputationLedger: {
        findMany: jest.fn(async (args: { where?: { pendingPointDelta?: unknown } }) =>
          args.where?.pendingPointDelta
            ? []
            : [{
                id: 1,
                reason: ReputationReason.article_publish,
                description: "首次发布文章",
                experienceDelta: 20,
                pointDelta: 10,
                experienceAfter: 350,
                pointsAfter: 42,
                createdAt: new Date("2026-08-16T01:00:00.000Z"),
              }]),
        aggregate: jest.fn(async () => ({ _sum: { pendingPointDelta: 0 } })),
      },
      $transaction: jest.fn(),
    };
    const service = new ReputationService(prisma as unknown as PrismaService);

    await expect(service.getMySummary(7)).resolves.toMatchObject({
      experience: 350,
      points: 42,
      level: { code: "foundation_building", minExperience: 200 },
      nextLevel: { code: "golden_core", minExperience: 500 },
      experienceToNext: 150,
      progressPercent: 50,
      recent: [{ description: "首次发布文章", pointDelta: 10 }],
    });
  });

  it("awards only the remaining daily experience and promotes the growth role", async () => {
    const createLedger = jest.fn(async () => ({ id: 1 }));
    const updateUser = jest.fn(
      async (args: { data: { experience?: unknown; roleId?: number } }) =>
        args.data.roleId ? { id: 7 } : { experience: 200, points: 5 },
    );
    const transaction = {
      userReputationLedger: {
        findUnique: jest.fn(async () => null),
        aggregate: jest.fn(async () => ({ _sum: { experienceDelta: 19 } })),
        create: createLedger,
      },
      user: {
        findUnique: jest.fn(async () => ({
        experience: 199,
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
        experienceAfter: 200,
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
        blockKey: "resource-1-test",
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
      .mockResolvedValueOnce({ points: 20 })
      .mockResolvedValueOnce({ experience: 40, points: 55 });
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
      blockKey: "resource-1-test",
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
        pointDelta: 0,
        pendingPointDelta: 10,
        pointsAfter: 55,
      }),
    });
  });
});
