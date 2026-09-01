import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, GoneException } from "@nestjs/common";
import { AccountPrivacyService } from "../src/account-privacy/account-privacy.service";
import { PasswordService } from "../src/auth/password.service";
import { AuthenticatedUser, RefreshSessionContext } from "../src/auth/auth.types";
import { TotpService } from "../src/account-privacy/totp.service";
import { DataExportJobStatus, UserStatus } from "../src/generated/prisma/client";

const context: RefreshSessionContext = {
  ip: "203.0.113.20",
  userAgent: "P15 test",
};

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 7,
    username: "writer",
    nickname: "Writer",
    email: "writer@example.com",
    status: UserStatus.active,
    isSuperAdmin: false,
    isAdministrator: false,
    avatarUrl: null,
    profileBio: "",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
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
    ...overrides,
  };
}

function service(
  prisma: Record<string, unknown>,
  dependencies: {
    accountSecurity?: {
      requestTotpDisableVerification?: jest.Mock;
      consumeTotpDisableVerification?: jest.Mock;
    };
    refreshTokens?: { revokeAllSessions?: jest.Mock };
  } = {},
): AccountPrivacyService {
  return new AccountPrivacyService(
    prisma as never,
    new PasswordService(),
    {
      isConfigured: () => true,
      encrypt: (value: string) => value,
      decrypt: (value: string) => value,
    } as never,
    new TotpService(),
    {
      requestTotpDisableVerification: dependencies.accountSecurity?.requestTotpDisableVerification ?? jest.fn(),
      consumeTotpDisableVerification: dependencies.accountSecurity?.consumeTotpDisableVerification ?? jest.fn(),
    } as never,
    {
      revokeAllSessions: dependencies.refreshTokens?.revokeAllSessions ?? jest.fn().mockResolvedValue(0),
    } as never,
  );
}

describe("account privacy", () => {
  it("starts and cancels the account deletion cooling-off period", async () => {
    const passwordService = new PasswordService();
    const passwordHash = await passwordService.hashPassword("Secret123!");
    const update = jest.fn().mockResolvedValue(undefined);
    const audit = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValueOnce({ status: UserStatus.active }).mockResolvedValueOnce({ status: UserStatus.active, passwordHash }),
        update,
      },
      privacyAuditRecord: { create: audit },
    };
    const account = user();
    const instance = service(prisma);

    const requested = await instance.requestDeletion(account, "Secret123!", context);

    expect(requested).toMatchObject({ pending: true, coolingOffDays: 7 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: account.id },
        data: expect.objectContaining({ status: UserStatus.deletion_pending }),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "account_deletion_requested" }),
      }),
    );

    prisma.user.findUnique.mockResolvedValueOnce({
      status: UserStatus.deletion_pending,
    });
    const cancelled = await instance.cancelDeletion(account, context);

    expect(cancelled).toEqual({ pending: false });
    expect(update).toHaveBeenLastCalledWith({
      where: { id: account.id },
      data: {
        status: UserStatus.active,
        deletionRequestedAt: null,
        deletionScheduledAt: null,
      },
    });
  });

  it("keeps deleted content linked while anonymizing public identity", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const audit = jest.fn().mockResolvedValue(undefined);
    const instance = service({
      user: { updateMany },
      privacyAuditRecord: { create: audit },
    });
    const finalize = (
      instance as unknown as {
        finalizeDeletion: (account: { id: number; username: string; nickname: string; email: string }) => Promise<void>;
      }
    ).finalizeDeletion;

    await finalize.call(instance, {
      id: 42,
      username: "former-writer",
      nickname: "Former Writer",
      email: "former@example.com",
    });

    const call = updateMany.mock.calls[0]?.[0] as {
      where: unknown;
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: 42, status: UserStatus.deletion_pending });
    expect(call.data).toMatchObject({
      nickname: "已注销用户",
      status: UserStatus.disabled,
      deletedOriginalUsername: "former-writer",
      deletedOriginalNickname: "Former Writer",
      deletedOriginalEmail: "former@example.com",
      avatarStoredName: null,
      isAdministrator: false,
      isSuperAdmin: false,
    });
    expect(call.data.username).toEqual(expect.stringMatching(/^deleted-42-/));
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "account_deleted" }),
      }),
    );
  });

  it("only allows managers to trace a deleted account and its content", async () => {
    const deletedUser = {
      id: 42,
      deletedOriginalUsername: "former-writer",
      deletedOriginalNickname: "Former Writer",
      deletedOriginalEmail: "former@example.com",
      deletedAt: new Date("2026-08-31T00:00:00.000Z"),
    };
    const prisma = {
      user: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([{ ...deletedUser, _count: { articles: 1, articleComments: 1 } }]),
        findFirst: jest.fn().mockResolvedValue(deletedUser),
      },
      article: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 91,
            title: "保留的文章",
            status: "published",
            createdAt: new Date("2026-08-20T00:00:00.000Z"),
            publishedAt: null,
          },
        ]),
      },
      articleComment: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 17,
            articleId: 91,
            article: { title: "保留的文章" },
            body: "保留的评论",
            status: "active",
            createdAt: new Date("2026-08-21T00:00:00.000Z"),
          },
        ]),
      },
    };
    const instance = service(prisma);

    await expect(instance.listDeletedUsers(user(), undefined, 1, 20)).rejects.toBeInstanceOf(ForbiddenException);

    const trace = await instance.getDeletedUserContent(user({ isAdministrator: true }), 42);

    expect(trace.user).toMatchObject({
      originalUsername: "former-writer",
      originalNickname: "Former Writer",
    });
    expect(trace.articles[0]).toMatchObject({ id: 91, title: "保留的文章" });
    expect(trace.comments[0]).toMatchObject({
      id: 17,
      body: "保留的评论",
      article: { title: "保留的文章" },
    });
  });

  it("does not reuse expired export jobs and reports cleaned exports as expired", async () => {
    const job = {
      id: 12,
      userId: 7,
      status: DataExportJobStatus.expired,
      payload: null,
      errorMessage: null,
      expiresAt: new Date(Date.now() - 1_000),
      completedAt: new Date(Date.now() - 2_000),
    };
    const prisma = {
      dataExportJob: {
        findFirst: jest.fn().mockResolvedValue(job),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    const instance = service(prisma);

    await expect(instance.downloadExport(user(), job.id)).rejects.toBeInstanceOf(GoneException);
    await expect(instance.getExport(user(), job.id)).resolves.toMatchObject({
      id: job.id,
      status: DataExportJobStatus.expired,
    });
  });

  it("rejects an incorrect deletion password", async () => {
    const passwordService = new PasswordService();
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({ status: UserStatus.active })
          .mockResolvedValueOnce({
            status: UserStatus.active,
            passwordHash: await passwordService.hashPassword("Secret123!"),
          }),
      },
    };
    await expect(service(prisma).requestDeletion(user(), "wrong-password", context)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("TOTP", () => {
  it("generates eight six-character recovery codes", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const audit = jest.fn().mockResolvedValue(undefined);
    const instance = service({
      userTotpCredential: {
        findUnique: jest.fn().mockResolvedValue({ encryptedSecret: "secret", enabled: false }),
        update,
      },
      privacyAuditRecord: { create: audit },
    });
    const verify = jest.spyOn(TotpService.prototype, "verify").mockReturnValue(true);
    const result = await instance.confirmTotp(user(), "123456", context);
    verify.mockRestore();

    expect(result.recoveryCodes).toHaveLength(8);
    expect(result.recoveryCodes.every((code) => /^[A-Z0-9]{6}$/.test(code))).toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recoveryCodeHashes: expect.arrayContaining(result.recoveryCodes.map((code) => createHash("sha256").update(code).digest("hex"))),
        }),
      }),
    );
  });

  it("rejects legacy ten-character recovery codes", async () => {
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    const update = jest.fn().mockResolvedValue(undefined);
    const instance = service({
      userTotpCredential: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 7,
          enabled: true,
          encryptedSecret: "secret",
          recoveryCodeHashes: [hash("ABC123"), hash("abcdef1234")],
        }),
        update,
      },
    });

    await expect(instance.verifyTotpForLogin(7, "abc123")).resolves.toBe(true);
    await expect(instance.verifyTotpForLogin(7, "abcdef1234")).resolves.toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("matches RFC 6238 SHA-1 vectors and accepts only a one-step clock window", () => {
    const instance = new TotpService();
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

    expect(instance.verify(secret, "287082", 59_000)).toBe(true);
    expect(instance.verify(secret, "081804", 1_111_111_109_000)).toBe(true);
    expect(instance.verify(secret, "wrong", 59_000)).toBe(false);
    expect(instance.verify(secret, "287082", 59_000 + 90_000)).toBe(false);
  });

  it("requires an email verification code before removing TOTP by email", async () => {
    const consumeTotpDisableVerification = jest.fn().mockResolvedValue(undefined);
    const removeCredential = jest.fn().mockResolvedValue(undefined);
    const audit = jest.fn().mockResolvedValue(undefined);
    const instance = service(
      {
        userTotpCredential: {
          findUnique: jest.fn().mockResolvedValue({ enabled: true }),
          delete: removeCredential,
        },
        privacyAuditRecord: { create: audit },
      },
      { accountSecurity: { consumeTotpDisableVerification } },
    );

    await expect(instance.disableTotpWithEmail(user(), "123456", context)).resolves.toEqual({ enabled: false });
    expect(consumeTotpDisableVerification).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), "123456");
    expect(removeCredential).toHaveBeenCalledWith({ where: { userId: 7 } });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "totp_disabled_by_email" }),
      }),
    );
  });

  it("allows only a super administrator to reset another user's TOTP and revokes sessions", async () => {
    const deleteCredential = jest.fn().mockResolvedValue(undefined);
    const updateUser = jest.fn().mockResolvedValue(undefined);
    const createAudit = jest.fn().mockResolvedValue(undefined);
    const revokeAllSessions = jest.fn().mockResolvedValue(3);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 8, isSuperAdmin: false }),
        update: updateUser,
      },
      userTotpCredential: {
        findUnique: jest.fn().mockResolvedValue({ enabled: true }),
        delete: deleteCredential,
      },
      privacyAuditRecord: { create: createAudit },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    const instance = service(prisma, { refreshTokens: { revokeAllSessions } });

    await expect(instance.resetTotpBySuperAdmin(user({ id: 1, isSuperAdmin: true }), 8, context)).resolves.toEqual({ enabled: false, revokedSessions: 3 });
    expect(deleteCredential).toHaveBeenCalledWith({ where: { userId: 8 } });
    expect(updateUser).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { authVersion: { increment: 1 } },
    });
    expect(revokeAllSessions).toHaveBeenCalledWith(8);
    await expect(instance.resetTotpBySuperAdmin(user(), 8, context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
