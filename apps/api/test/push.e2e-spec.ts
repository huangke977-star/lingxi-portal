import { BadRequestException } from "@nestjs/common";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { PushService } from "../src/push/push.service";

const user: AuthenticatedUser = {
  id: 7,
  username: "member",
  nickname: "成员",
  email: "member@example.com",
  status: "active",
  isSuperAdmin: false,
  avatarUrl: null,
  profileBio: "",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  appearance: {
    themeId: "sakura-mist",
    customAccent: "#db2777",
    customSurface: "#ffffff",
    customForeground: "#2b2530",
    customMuted: "#665867",
    cardAlpha: 52,
    glassBlur: 22,
    glassTint: "#fff3f6",
    glassTintAlpha: 72,
  },
  role: { code: "qi_refining", name: "练气", level: 10 },
};

describe("browser push subscriptions", () => {
  const originalEnv = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  };

  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = "test-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-private-key";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
  });

  afterAll(() => {
    process.env.VAPID_PUBLIC_KEY = originalEnv.publicKey;
    process.env.VAPID_PRIVATE_KEY = originalEnv.privateKey;
    process.env.VAPID_SUBJECT = originalEnv.subject;
  });

  it("requires an HTTPS endpoint and stores the subscription for the current user", async () => {
    const prisma = {
      pushSubscription: {
        upsert: jest.fn(async () => undefined),
        count: jest.fn(async () => 1),
      },
    };
    const service = new PushService(prisma as unknown as PrismaService);
    const keys = { p256dh: "p256dh-key", auth: "auth-key" };

    await expect(service.subscribe(user, { endpoint: "http://push.example.test/id", keys }, "test-browser"))
      .rejects.toBeInstanceOf(BadRequestException);

    await expect(service.subscribe(user, { endpoint: "https://push.example.test/id", keys }, "test-browser"))
      .resolves.toMatchObject({ enabled: true, subscriptionCount: 1 });
    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ userId: user.id, endpoint: "https://push.example.test/id" }),
      update: expect.objectContaining({ userId: user.id, endpoint: "https://push.example.test/id" }),
    }));
  });

  it("only removes the current user's matching subscription", async () => {
    const prisma = {
      pushSubscription: {
        deleteMany: jest.fn(async () => ({ count: 1 })),
        count: jest.fn(async () => 0),
      },
    };
    const service = new PushService(prisma as unknown as PrismaService);
    const endpoint = "https://push.example.test/id";

    await service.unsubscribe(user, { endpoint, keys: { p256dh: "key", auth: "auth" } });

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: user.id, endpointHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
  });
});
