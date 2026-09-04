import { ResourceDeliveryStatus } from "../src/generated/prisma/client";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { ReputationService } from "../src/reputation/reputation.service";
import { ResourcesService } from "../src/resources/resources.service";

const buyer: AuthenticatedUser = {
  id: 7,
  username: "reader",
  nickname: "读者",
  email: "reader@example.com",
  status: "active",
  isSuperAdmin: false,
  avatarUrl: null,
  profileBio: "",
  createdAt: new Date(),
  appearance: {
    themeId: "cloud-blue",
    customAccent: "#1814f0",
    customSurface: "#dfc8c8",
    customForeground: "#2b2530",
    customMuted: "#665867",
    cardAlpha: 50,
    glassBlur: 18,
    glassTint: "#fff3f6",
    glassTintAlpha: 0,
  },
  role: { code: "qi_refining", name: "练气", level: 10 },
};

function exchange(status: ResourceDeliveryStatus = ResourceDeliveryStatus.unlocked) {
  return {
    id: 31,
    articleId: 12,
    buyerId: buyer.id,
    authorId: 8,
    blockKey: "resource-1",
    pointCost: 10,
    deliveryStatus: status,
    attemptCount: 0,
    lastError: null,
    downloadedAt: null,
    refundedAt: null,
    sellerAvailableAt: new Date("2026-09-07T00:00:00.000Z"),
    sellerSettledAt: null,
  };
}

describe("resource delivery lifecycle", () => {
  it("records a download exactly once for the buyer", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const recordEvent = jest.fn(async () => undefined);
    const prisma = {
      articleResourceExchange: { findFirst: jest.fn(async () => exchange()) },
      $transaction: jest.fn(async (callback: (transaction: object) => Promise<void>) => callback({
        articleResourceExchange: { updateMany },
        articleResourceDeliveryEvent: { create: recordEvent },
      })),
    };
    const service = new ResourcesService(prisma as unknown as PrismaService, {} as ReputationService);

    await expect(service.download(31, buyer)).resolves.toMatchObject({ id: 31, status: ResourceDeliveryStatus.downloaded });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 31, buyerId: buyer.id, deliveryStatus: { not: ResourceDeliveryStatus.refunded } },
      data: expect.objectContaining({ deliveryStatus: ResourceDeliveryStatus.downloaded }),
    }));
    expect(recordEvent).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "downloaded", exchangeId: 31 }) });
  });

  it("retries only failed deliveries and advances the attempt", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const recordEvent = jest.fn(async () => undefined);
    const prisma = {
      articleResourceExchange: { findFirst: jest.fn(async () => exchange(ResourceDeliveryStatus.failed)) },
      $transaction: jest.fn(async (callback: (transaction: object) => Promise<void>) => callback({
        articleResourceExchange: { updateMany },
        articleResourceDeliveryEvent: { create: recordEvent },
      })),
    };
    const service = new ResourcesService(prisma as unknown as PrismaService, {} as ReputationService);

    await expect(service.retry(31, buyer)).resolves.toMatchObject({ id: 31, status: ResourceDeliveryStatus.unlocked, attemptCount: 1 });
    expect(recordEvent).toHaveBeenNthCalledWith(1, { data: expect.objectContaining({ type: "retry", attempt: 1 }) });
    expect(recordEvent).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ type: "unlocked", attempt: 1 }) });
  });

  it("does not refund an already refunded exchange twice", async () => {
    const reputation = { recordManualAdjustment: jest.fn() };
    const prisma = {
      articleResourceExchange: { findUnique: jest.fn(async () => exchange(ResourceDeliveryStatus.refunded)) },
    };
    const service = new ResourcesService(prisma as unknown as PrismaService, reputation as unknown as ReputationService);

    await expect(service.refund(31)).resolves.toMatchObject({ id: 31, status: ResourceDeliveryStatus.refunded, idempotent: true });
    expect(reputation.recordManualAdjustment).not.toHaveBeenCalled();
  });

  it("passes administrator point adjustments through the ledger with a stable event key", async () => {
    const recordManualAdjustment = jest.fn(async () => true);
    const prisma = { $transaction: jest.fn(async (callback: (transaction: object) => Promise<boolean>) => callback({})) };
    const service = new ResourcesService(prisma as unknown as PrismaService, { recordManualAdjustment } as unknown as ReputationService);

    await expect(service.topUp({ userId: 8, points: 20, eventKey: "case-1", note: "补发" })).resolves.toEqual({ applied: true });
    expect(recordManualAdjustment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      userId: 8,
      eventKey: "points-top-up:8:case-1",
      points: 20,
    }));
  });
});
