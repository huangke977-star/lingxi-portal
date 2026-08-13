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
  it("keeps immediate drafts from carrying a scheduled publish time", async () => {
    const service = new AnnouncementsService({
      role: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService);
    const normalizeInput = service as unknown as {
      normalizeInput(input: Record<string, unknown>): Promise<{ data: { status: AnnouncementStatus; scheduledAt: Date | null } }>;
    };

    await expect(normalizeInput.normalizeInput({
      title: "草稿公告",
      content: "公告内容",
      publishMode: "immediate",
      scheduledAt: "2099-01-01T00:00:00.000Z",
    })).resolves.toMatchObject({
      data: { publishMode: "immediate", scheduledAt: null },
    });
  });

  it("normalizes announcement schedule times to whole minutes", async () => {
    const service = new AnnouncementsService({
      role: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService);
    const normalizeInput = service as unknown as {
      normalizeInput(input: Record<string, unknown>): Promise<{ data: { scheduledAt: Date | null; expiresAt: Date | null } }>;
    };

    await expect(normalizeInput.normalizeInput({
      title: "定时公告",
      content: "公告内容",
      publishMode: "scheduled",
      scheduledAt: "2099-01-01T08:30:45.123Z",
      expiresAt: "2099-01-01T09:30:59.999Z",
    })).resolves.toMatchObject({
      data: {
        scheduledAt: new Date("2099-01-01T08:30:00.000Z"),
        expiresAt: new Date("2099-01-01T09:30:00.000Z"),
      },
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

  it("returns an edited scheduled announcement to draft", async () => {
    const update = jest.fn(async () => ({}));
    const prisma = {
      announcement: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: 12, status: AnnouncementStatus.scheduled })
          .mockResolvedValueOnce({ id: 12 }),
        update,
      },
      role: { findMany: jest.fn(async () => []) },
    };
    const service = new AnnouncementsService(prisma as unknown as PrismaService);
    jest.spyOn(service, "getAdmin").mockResolvedValue({ id: 12 } as never);

    await service.update(user, 12, {
      title: "重新编辑",
      content: "正文",
      publishMode: "scheduled",
      scheduledAt: "2099-01-01T00:00:00.000Z",
    });

    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: AnnouncementStatus.draft }),
    }));
  });

  it("allows an administrator to delete only drafts", async () => {
    const remove = jest.fn(async () => ({}));
    const findUnique = jest.fn<Promise<{ status: AnnouncementStatus }>, []>(async () => ({ status: AnnouncementStatus.archived }));
    const service = new AnnouncementsService({ announcement: { findUnique, delete: remove } } as unknown as PrismaService);

    await expect(service.delete(user, 13)).rejects.toThrow("Administrators can only delete announcement drafts.");
    findUnique.mockResolvedValueOnce({ status: AnnouncementStatus.draft });
    await expect(service.delete(user, 13)).resolves.toEqual({ success: true });
    expect(remove).toHaveBeenCalledWith({ where: { id: 13 } });
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
