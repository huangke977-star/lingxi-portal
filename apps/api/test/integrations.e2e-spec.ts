import { createHash } from "node:crypto";
import { IntegrationsService } from "../src/integrations/integrations.service";

const actor = { id: 7, username: "owner", nickname: "Owner", email: "owner@example.com" } as never;

function createHarness() {
  const prisma = {
    externalWebhookEndpoint: { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
    externalWebhookDelivery: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    readOnlyApiToken: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    externalNotificationChannel: { findMany: jest.fn() },
    article: { findMany: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const redis = { incr: jest.fn(async () => 1), expire: jest.fn(async () => 1) };
  const crypto = { encrypt: jest.fn((value: string) => `encrypted:${value}`), decrypt: jest.fn(() => "webhook-secret") };
  return { prisma, redis, crypto, service: new IntegrationsService(prisma as never, redis as never, crypto as never) };
}

describe("P19 integrations", () => {
  it("stores only a hash for read-only API tokens and enforces their scope", async () => {
    const harness = createHarness();
    harness.prisma.readOnlyApiToken.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 1, ...data, createdAt: new Date(), lastUsedAt: null, revokedAt: null }));

    const created = await harness.service.createToken(actor, { name: "reader", scopes: ["read_articles"] });
    expect(created.token).toMatch(/^lvt_/);
    expect(harness.prisma.readOnlyApiToken.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tokenHash: createHash("sha256").update(created.token).digest("hex"), scopes: ["read_articles"] }) }));
    expect(JSON.stringify(harness.prisma.readOnlyApiToken.create.mock.calls[0][0])).not.toContain(created.token);

    harness.prisma.readOnlyApiToken.findUnique.mockResolvedValue({ id: 1, revokedAt: null, expiresAt: null, scopes: ["read_articles"], user: { id: 7, username: "owner", nickname: "Owner", email: "owner@example.com", status: "active" } });
    harness.prisma.readOnlyApiToken.update.mockResolvedValue({});
    await expect(harness.service.authenticateReadOnlyToken(`Bearer ${created.token}`, "read_articles")).resolves.toBeTruthy();
    await expect(harness.service.authenticateReadOnlyToken(`Bearer ${created.token}`, "read_profile")).rejects.toThrow("scope");
  });

  it("creates idempotent signed webhook deliveries with redacted payloads", async () => {
    const harness = createHarness();
    harness.prisma.externalWebhookEndpoint.findMany.mockResolvedValue([{ id: 4, enabled: true, events: ["article.published"] }]);
    harness.prisma.externalWebhookDelivery.create.mockResolvedValue({ id: 9 });
    const serviceWithPrivate = harness.service as unknown as { deliverOne: (id: number) => Promise<void> };
    const deliverOne = jest.spyOn(serviceWithPrivate, "deliverOne").mockResolvedValue(undefined);

    await harness.service.emit("article.published", { articleId: 12, password: "do-not-send", title: "Public title" }, "event-1");

    expect(harness.prisma.externalWebhookDelivery.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventId: "event-1", idempotencyKey: "article.published:event-1", payload: expect.objectContaining({ data: { articleId: 12, password: "[REDACTED]", title: "Public title" } }) }) }));
    expect(deliverOne).toHaveBeenCalledWith(9);
  });
});
