import { AnnouncementsService } from "../src/announcements/announcements.service";
import { AuthenticatedUser } from "../src/auth/auth.types";
import { AnnouncementStatus } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";

const user: AuthenticatedUser = {
  id: 7,
  username: "admin",
  nickname: "管理员",
  email: "admin@example.com",
  status: "active",
  isSuperAdmin: false,
  avatarUrl: null,
  profileBio: "",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  appearance: {
    themeId: "cloud-blue",
    customAccent: "#1814f0",
    customSurface: "#ffffff",
    customForeground: "#2b2530",
    customMuted: "#665867",
    cardAlpha: 50,
    glassBlur: 18,
    glassTint: "#fff3f6",
    glassTintAlpha: 0,
  },
  role: { code: "administrator", name: "管理员", level: 90 },
};

describe("AnnouncementsService", () => {
  it("does not turn a draft into a scheduled announcement because of a stale date", async () => {
    const service = new AnnouncementsService({
      role: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService);
    const normalizeInput = service as unknown as {
      normalizeInput(input: Record<string, unknown>): Promise<{ data: { status: AnnouncementStatus; scheduledAt: Date | null } }>;
    };

    await expect(normalizeInput.normalizeInput({
      title: "草稿公告",
      content: "公告内容",
      status: "draft",
      scheduledAt: "2099-01-01T00:00:00.000Z",
    })).resolves.toMatchObject({
      data: { status: AnnouncementStatus.draft, scheduledAt: null },
    });
  });

  it("confirms a visible announcement and marks its notification read", async () => {
    const readUpsert = jest.fn(async () => ({}));
    const notificationUpdate = jest.fn(async () => ({ count: 1 }));
    const prisma = {
      announcement: { findFirst: jest.fn(async () => ({ id: 11 })) },
      announcementRead: { upsert: readUpsert },
      userNotification: { updateMany: notificationUpdate },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const service = new AnnouncementsService(prisma as unknown as PrismaService);

    await expect(service.confirmRead(user, 11)).resolves.toEqual({ confirmedAt: expect.any(String) });
    expect(readUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { announcementId_userId: { announcementId: 11, userId: user.id } },
      update: expect.objectContaining({ confirmedAt: expect.any(Date) }),
    }));
    expect(notificationUpdate).toHaveBeenCalledWith({
      where: { userId: user.id, announcementId: 11, readAt: null },
      data: { readAt: expect.any(Date), openedAt: expect.any(Date) },
    });
  });

  it("publishes due announcements and expires ended announcements", async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const update = jest.fn(async () => ({}));
    const prisma = {
      announcement: {
        updateMany,
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: 21 }])
          .mockResolvedValueOnce([]),
        update,
        findUnique: jest.fn(async () => ({ id: 21, status: AnnouncementStatus.archived })),
      },
    };
    const service = new AnnouncementsService(prisma as unknown as PrismaService);

    await service.processLifecycle();

    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: AnnouncementStatus.published }),
      data: { status: AnnouncementStatus.expired },
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 21 },
      data: expect.objectContaining({ status: AnnouncementStatus.published, publishedAt: expect.any(Date) }),
    }));
  });
});
