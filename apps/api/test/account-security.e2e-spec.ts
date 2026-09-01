import { HttpException } from "@nestjs/common";
import {
  EmailVerificationPurpose,
  EmailVerificationRequest,
  EmailVerificationStatus,
  LoginRiskLevel,
  LoginSecurityEventType,
  PasswordResetRequest,
  PasswordResetStatus,
  SecurityConfiguration,
} from "../src/generated/prisma/client";
import { AuthService } from "../src/auth/auth.service";
import { AuthenticatedUser, RefreshSessionContext } from "../src/auth/auth.types";
import { PrismaService } from "../src/prisma/prisma.service";
import { RedisService } from "../src/redis/redis.service";
import { AccountSecurityService } from "../src/security/account-security.service";
import { MailService } from "../src/security/mail.service";
import { SecretCryptoService } from "../src/security/secret-crypto.service";
import { SecurityConfigurationService } from "../src/security/security-configuration.service";
import { TurnstileService } from "../src/security/turnstile.service";

interface MailPayload {
  text: string;
}

interface VerificationWhere {
  id?: number;
  email?: string;
  purpose?: EmailVerificationPurpose;
  status?: EmailVerificationStatus;
  userId?: number;
  challengeTokenHash?: string;
}

interface VerificationData {
  status?: EmailVerificationStatus;
  attempts?: number | { increment: number };
  codeHash?: string;
  expiresAt?: Date;
  verifiedAt?: Date;
  consumedAt?: Date;
}

interface PasswordResetWhere {
  id?: number;
  tokenHash?: string;
  userId?: number;
  status?: PasswordResetStatus;
}

interface PasswordResetData {
  status?: PasswordResetStatus;
  consumedAt?: Date;
}

const encryptionKey = "31".repeat(32);
const sessionContext: RefreshSessionContext = {
  ip: "203.0.113.10",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0.0.0",
  deviceId: "browser-installation-1",
  trustedDeviceToken: "trusted-device-token-for-account-security-tests",
};

function securityConfiguration(overrides: Partial<SecurityConfiguration> = {}): SecurityConfiguration {
  const now = new Date("2026-08-06T00:00:00.000Z");
  return {
    id: 1,
    smtpEnabled: false,
    smtpHost: null,
    smtpPort: 587,
    smtpSecure: false,
    smtpUsername: null,
    smtpPasswordEncrypted: null,
    smtpFromName: "HLOVET",
    smtpFromEmail: null,
    registrationEmailVerificationEnabled: false,
    passwordRecoveryEnabled: false,
    untrustedDeviceEmailVerificationEnabled: false,
    turnstileSiteKey: null,
    turnstileSecretEncrypted: null,
    turnstileRegistrationEnabled: false,
    turnstileLoginEnabled: false,
    turnstileRecoveryEnabled: false,
    loginFailureTurnstileThreshold: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function authenticatedUser(): AuthenticatedUser {
  return {
    id: 17,
    username: "security-user",
    nickname: "安全测试用户",
    email: "security@example.com",
    emailVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
    status: "active",
    isSuperAdmin: false,
    avatarUrl: null,
    profileBio: "测试账号安全行为",
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
}

function matchesVerification(request: EmailVerificationRequest, where: VerificationWhere): boolean {
  return (
    (where.id === undefined || request.id === where.id) &&
    (where.email === undefined || request.email === where.email) &&
    (where.purpose === undefined || request.purpose === where.purpose) &&
    (where.status === undefined || request.status === where.status) &&
    (where.userId === undefined || request.userId === where.userId) &&
    (where.challengeTokenHash === undefined || request.challengeTokenHash === where.challengeTokenHash)
  );
}

function matchesPasswordReset(request: PasswordResetRequest, where: PasswordResetWhere): boolean {
  return (
    (where.id === undefined || request.id === where.id) &&
    (where.tokenHash === undefined || request.tokenHash === where.tokenHash) &&
    (where.userId === undefined || request.userId === where.userId) &&
    (where.status === undefined || request.status === where.status)
  );
}

function createAccountSecurityHarness(options?: {
  configuration?: Partial<SecurityConfiguration>;
  recoveryUser?: {
    id: number;
    email: string;
    nickname: string;
    status: string;
    emailVerifiedAt: Date | null;
  } | null;
}) {
  const verificationRequests: EmailVerificationRequest[] = [];
  const passwordResetRequests: PasswordResetRequest[] = [];
  const counters = new Map<string, number>();
  const expire = jest.fn(async () => 1);
  const redis = {
    incr: jest.fn(async (key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    expire,
  };
  const sendMail = jest.fn(async () => undefined);
  const verifyTurnstile = jest.fn(async () => undefined);
  const configuration = securityConfiguration({
    smtpEnabled: true,
    untrustedDeviceEmailVerificationEnabled: true,
    ...options?.configuration,
  });
  const recoveryUser =
    options?.recoveryUser === undefined
      ? {
          id: 17,
          email: "security@example.com",
          nickname: "安全测试用户",
          status: "active",
          emailVerifiedAt: new Date("2026-08-01T00:00:00.000Z"),
        }
      : options.recoveryUser;

  const emailVerificationRequest = {
    create: jest.fn(
      async ({
        data,
      }: {
        data: {
          userId?: number;
          purpose: EmailVerificationPurpose;
          email: string;
          codeHash: string;
          challengeTokenHash?: string;
          targetId?: number;
          deviceFingerprint?: string;
          ip: string;
          expiresAt: Date;
        };
      }) => {
        const now = new Date();
        const request: EmailVerificationRequest = {
          id: verificationRequests.length + 1,
          userId: data.userId ?? null,
          purpose: data.purpose,
          email: data.email,
          codeHash: data.codeHash,
          challengeTokenHash: data.challengeTokenHash ?? null,
          targetId: data.targetId ?? null,
          deviceFingerprint: data.deviceFingerprint ?? null,
          status: EmailVerificationStatus.pending,
          attempts: 0,
          ip: data.ip,
          expiresAt: data.expiresAt,
          verifiedAt: null,
          consumedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        verificationRequests.push(request);
        return request;
      },
    ),
    findFirst: jest.fn(
      async ({ where }: { where: VerificationWhere }) => [...verificationRequests].reverse().find((request) => matchesVerification(request, where)) ?? null,
    ),
    findUnique: jest.fn(async ({ where }: { where: VerificationWhere }) => {
      const request = verificationRequests.find((item) => matchesVerification(item, where));
      return request ? { ...request, user: recoveryUser } : null;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: number }; data: VerificationData }) => {
      const request = verificationRequests.find((item) => item.id === where.id);
      if (!request) throw new Error("Verification request not found in test store.");
      if (data.status !== undefined) request.status = data.status;
      if (typeof data.attempts === "number") request.attempts = data.attempts;
      else if (data.attempts) request.attempts += data.attempts.increment;
      if (data.codeHash !== undefined) request.codeHash = data.codeHash;
      if (data.expiresAt !== undefined) request.expiresAt = data.expiresAt;
      if (data.verifiedAt !== undefined) request.verifiedAt = data.verifiedAt;
      if (data.consumedAt !== undefined) request.consumedAt = data.consumedAt;
      request.updatedAt = new Date();
      return request;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: VerificationWhere; data: VerificationData }) => {
      const matches = verificationRequests.filter((request) => matchesVerification(request, where));
      for (const request of matches) {
        if (data.status !== undefined) request.status = data.status;
        if (typeof data.attempts === "number") request.attempts = data.attempts;
        else if (data.attempts) request.attempts += data.attempts.increment;
        if (data.codeHash !== undefined) request.codeHash = data.codeHash;
        if (data.expiresAt !== undefined) request.expiresAt = data.expiresAt;
        if (data.verifiedAt !== undefined) request.verifiedAt = data.verifiedAt;
        if (data.consumedAt !== undefined) request.consumedAt = data.consumedAt;
        request.updatedAt = new Date();
      }
      return { count: matches.length };
    }),
  };

  const passwordResetRequest = {
    create: jest.fn(
      async ({
        data,
      }: {
        data: {
          userId: number;
          tokenHash: string;
          ip: string;
          expiresAt: Date;
        };
      }) => {
        const now = new Date();
        const request: PasswordResetRequest = {
          id: passwordResetRequests.length + 1,
          userId: data.userId,
          tokenHash: data.tokenHash,
          status: PasswordResetStatus.pending,
          ip: data.ip,
          expiresAt: data.expiresAt,
          consumedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        passwordResetRequests.push(request);
        return request;
      },
    ),
    findUnique: jest.fn(
      async ({ where }: { where: PasswordResetWhere }) => passwordResetRequests.find((request) => matchesPasswordReset(request, where)) ?? null,
    ),
    update: jest.fn(async ({ where, data }: { where: { id: number }; data: PasswordResetData }) => {
      const request = passwordResetRequests.find((item) => item.id === where.id);
      if (!request) throw new Error("Password reset request not found in test store.");
      if (data.status !== undefined) request.status = data.status;
      if (data.consumedAt !== undefined) request.consumedAt = data.consumedAt;
      request.updatedAt = new Date();
      return request;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: PasswordResetWhere; data: PasswordResetData }) => {
      const matches = passwordResetRequests.filter((request) => matchesPasswordReset(request, where));
      for (const request of matches) {
        if (data.status !== undefined) request.status = data.status;
        if (data.consumedAt !== undefined) request.consumedAt = data.consumedAt;
        request.updatedAt = new Date();
      }
      return { count: matches.length };
    }),
  };

  const trustedDeviceUpsert = jest.fn(async () => undefined);
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { email: string } }) => {
        if (where.email === recoveryUser?.email) return recoveryUser;
        return null;
      }),
      update: jest.fn(async () => undefined),
    },
    knownLoginDevice: {
      upsert: trustedDeviceUpsert,
    },
    emailVerificationRequest,
    passwordResetRequest,
  } as Record<string, unknown>;
  prisma.$transaction = jest.fn(async (operation: unknown) =>
    typeof operation === "function" ? (operation as (transaction: typeof prisma) => Promise<unknown>)(prisma) : Promise.all(operation as Promise<unknown>[]),
  );
  const configurationService = {
    getConfiguration: jest.fn(async () => configuration),
  };
  const turnstile = { verify: verifyTurnstile };
  const mail = { send: sendMail };
  const service = new AccountSecurityService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    configurationService as unknown as SecurityConfigurationService,
    turnstile as unknown as TurnstileService,
    mail as unknown as MailService,
  );

  return {
    service,
    verificationRequests,
    passwordResetRequests,
    redis,
    sendMail,
    verifyTurnstile,
    trustedDeviceUpsert,
  };
}

function latestMailText(sendMail: jest.Mock): string {
  const payload = sendMail.mock.calls.at(-1)?.[0] as MailPayload | undefined;
  if (!payload) throw new Error("Expected an email to be sent.");
  return payload.text;
}

function verificationCodeFrom(text: string): string {
  const match = text.match(/\b(\d{6})\b/);
  if (!match) throw new Error("Verification code was not present in email text.");
  return match[1];
}

function resetTokenFrom(text: string): string {
  const match = text.match(/[?&]token=([^\s<]+)/);
  if (!match) throw new Error("Password reset token was not present in email text.");
  return decodeURIComponent(match[1]);
}

describe("P2 account security", () => {
  const originalEncryptionKey = process.env.BACKUP_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.BACKUP_ENCRYPTION_KEY = encryptionKey;
    process.env.REFRESH_TOKEN_SECRET = "account-security-test-secret";
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.BACKUP_ENCRYPTION_KEY;
    } else {
      process.env.BACKUP_ENCRYPTION_KEY = originalEncryptionKey;
    }
  });

  describe("SecretCryptoService", () => {
    it("encrypts without retaining plaintext and decrypts the ciphertext", () => {
      const service = new SecretCryptoService();
      const plaintext = "smtp-password-with-sensitive-value";

      const ciphertext = service.encrypt(plaintext);

      expect(ciphertext).toMatch(/^v1\./);
      expect(ciphertext).not.toContain(plaintext);
      expect(service.decrypt(ciphertext)).toBe(plaintext);
    });
  });

  describe("SecurityConfigurationService", () => {
    it("reports configured credentials without echoing secrets or ciphertext", async () => {
      const crypto = new SecretCryptoService();
      const stored = securityConfiguration({
        smtpEnabled: true,
        smtpHost: "smtp.example.com",
        smtpUsername: "mailer",
        smtpPasswordEncrypted: crypto.encrypt("smtp-secret"),
        smtpFromEmail: "no-reply@example.com",
        turnstileSiteKey: "public-site-key",
        turnstileSecretEncrypted: crypto.encrypt("turnstile-secret"),
      });
      const prisma = {
        securityConfiguration: {
          upsert: jest.fn(async () => stored),
        },
      } as unknown as PrismaService;
      const service = new SecurityConfigurationService(prisma, crypto);

      const response = await service.getAdminConfiguration();

      expect(response).toMatchObject({
        smtpPasswordConfigured: true,
        turnstileSecretConfigured: true,
        encryptionConfigured: true,
      });
      expect(response).not.toHaveProperty("smtpPasswordEncrypted");
      expect(response).not.toHaveProperty("turnstileSecretEncrypted");
      expect(response).not.toHaveProperty("smtpPassword");
      expect(response).not.toHaveProperty("turnstileSecret");
      expect(JSON.stringify(response)).not.toContain("smtp-secret");
      expect(JSON.stringify(response)).not.toContain("turnstile-secret");
    });

    it("rejects enabling SMTP-backed features without complete credentials", async () => {
      const stored = securityConfiguration();
      const update = jest.fn(async () => stored);
      const prisma = {
        securityConfiguration: {
          upsert: jest.fn(async () => stored),
          update,
        },
      } as unknown as PrismaService;
      const service = new SecurityConfigurationService(prisma, new SecretCryptoService());

      await expect(service.update({ smtpEnabled: true, passwordRecoveryEnabled: true })).rejects.toThrow("完整配置 SMTP");
      expect(update).not.toHaveBeenCalled();
    });

    it("turns off every SMTP-backed feature when the mail service is disabled", async () => {
      const crypto = new SecretCryptoService();
      const stored = securityConfiguration({
        smtpEnabled: true,
        smtpHost: "smtp.example.com",
        smtpUsername: "mailer",
        smtpPasswordEncrypted: crypto.encrypt("smtp-secret"),
        smtpFromEmail: "no-reply@example.com",
        registrationEmailVerificationEnabled: true,
        passwordRecoveryEnabled: true,
        untrustedDeviceEmailVerificationEnabled: true,
        turnstileRecoveryEnabled: true,
      });
      const update = jest.fn(async ({ data }: { data: Partial<SecurityConfiguration> }) => ({ ...stored, ...data }));
      const prisma = {
        securityConfiguration: {
          upsert: jest.fn(async () => stored),
          update,
        },
      } as unknown as PrismaService;
      const service = new SecurityConfigurationService(prisma, crypto);

      const response = await service.update({ smtpEnabled: false });

      expect(update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: expect.objectContaining({
          smtpEnabled: false,
          registrationEmailVerificationEnabled: false,
          passwordRecoveryEnabled: false,
          untrustedDeviceEmailVerificationEnabled: false,
          turnstileRecoveryEnabled: false,
        }),
      });
      expect(response).toMatchObject({
        smtpEnabled: false,
        registrationEmailVerificationEnabled: false,
        passwordRecoveryEnabled: false,
        untrustedDeviceEmailVerificationEnabled: false,
        turnstileRecoveryEnabled: false,
      });
    });

    it("rejects enabling Turnstile without both site and secret credentials", async () => {
      const stored = securityConfiguration();
      const update = jest.fn(async () => stored);
      const prisma = {
        securityConfiguration: {
          upsert: jest.fn(async () => stored),
          update,
        },
      } as unknown as PrismaService;
      const service = new SecurityConfigurationService(prisma, new SecretCryptoService());

      await expect(
        service.update({
          turnstileLoginEnabled: true,
          turnstileSiteKey: "site-key-only",
        }),
      ).rejects.toThrow("完整配置 Site Key 和 Secret Key");
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe("AccountSecurityService verification and recovery", () => {
    it("blocks mail-backed flows while the mail service is disabled", async () => {
      const harness = createAccountSecurityHarness({
        configuration: {
          smtpEnabled: false,
          registrationEmailVerificationEnabled: true,
          passwordRecoveryEnabled: true,
          untrustedDeviceEmailVerificationEnabled: true,
        },
      });

      await expect(
        harness.service.requestRegistrationCode("new-user@example.com", undefined, sessionContext),
      ).rejects.toThrow("注册邮箱验证当前未启用");
      await expect(
        harness.service.requestPasswordReset("security@example.com", undefined, sessionContext),
      ).rejects.toThrow("密码找回当前未启用");
      await expect(
        harness.service.requestDeviceLoginVerification(authenticatedUser(), sessionContext),
      ).rejects.toThrow("非信任设备邮箱验证当前未启用");
      await expect(
        harness.service.sendAccountEmailCode(authenticatedUser(), sessionContext),
      ).rejects.toThrow("邮件服务当前未启用");
      expect(harness.sendMail).not.toHaveBeenCalled();
    });

    it("consumes a registration code exactly once", async () => {
      const harness = createAccountSecurityHarness({
        configuration: { registrationEmailVerificationEnabled: true },
        recoveryUser: null,
      });
      const email = "new-user@example.com";

      await harness.service.requestRegistrationCode(email, "turnstile-token", sessionContext);
      const code = verificationCodeFrom(latestMailText(harness.sendMail));
      await harness.service.consumeRegistrationCode(email, code);

      expect(harness.verificationRequests[0]).toMatchObject({
        status: EmailVerificationStatus.consumed,
        attempts: 0,
      });
      await expect(harness.service.consumeRegistrationCode(email, code)).rejects.toThrow("验证码无效或已过期");
    });

    it("expires an elapsed verification code", async () => {
      const harness = createAccountSecurityHarness({
        configuration: { registrationEmailVerificationEnabled: true },
        recoveryUser: null,
      });
      const email = "expired@example.com";
      await harness.service.requestRegistrationCode(email, undefined, sessionContext);
      const code = verificationCodeFrom(latestMailText(harness.sendMail));
      harness.verificationRequests[0].expiresAt = new Date(Date.now() - 1);

      await expect(harness.service.consumeRegistrationCode(email, code)).rejects.toThrow("验证码无效或已过期");
      expect(harness.verificationRequests[0].status).toBe(EmailVerificationStatus.expired);
    });

    it("expires a verification code after five failed attempts", async () => {
      const harness = createAccountSecurityHarness({
        configuration: { registrationEmailVerificationEnabled: true },
        recoveryUser: null,
      });
      const email = "attempts@example.com";
      await harness.service.requestRegistrationCode(email, undefined, sessionContext);
      const correctCode = verificationCodeFrom(latestMailText(harness.sendMail));

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(harness.service.consumeRegistrationCode(email, "000000")).rejects.toThrow("验证码不正确");
      }
      expect(harness.verificationRequests[0].attempts).toBe(5);
      await expect(harness.service.consumeRegistrationCode(email, correctCode)).rejects.toThrow("验证码尝试次数过多");
      expect(harness.verificationRequests[0].status).toBe(EmailVerificationStatus.expired);
    });

    it("enforces Redis email and IP frequency limits with TTLs", async () => {
      const harness = createAccountSecurityHarness({
        configuration: { registrationEmailVerificationEnabled: true },
        recoveryUser: null,
      });
      const email = "limited@example.com";

      await harness.service.requestRegistrationCode(email, undefined, sessionContext);
      const secondRequest = harness.service.requestRegistrationCode(email, undefined, sessionContext);

      await expect(secondRequest).rejects.toBeInstanceOf(HttpException);
      await expect(secondRequest).rejects.toMatchObject({ status: 429 });
      expect(harness.redis.expire).toHaveBeenCalledWith(`security:code:email:registration:${email}`, 60);
      expect(harness.redis.expire).toHaveBeenCalledWith(`security:code:ip:registration:${sessionContext.ip}`, 3600);
      expect(harness.sendMail).toHaveBeenCalledTimes(1);
    });

    it("stores a password reset token as a hash and consumes it once", async () => {
      const harness = createAccountSecurityHarness({
        configuration: { passwordRecoveryEnabled: true },
      });

      await harness.service.requestPasswordReset("security@example.com", undefined, sessionContext);
      const token = resetTokenFrom(latestMailText(harness.sendMail));

      expect(harness.passwordResetRequests[0].tokenHash).not.toBe(token);
      await expect(harness.service.consumePasswordResetToken(token)).resolves.toEqual({ userId: 17 });
      expect(harness.passwordResetRequests[0].status).toBe(PasswordResetStatus.consumed);
      await expect(harness.service.consumePasswordResetToken(token)).rejects.toThrow("重置链接无效或已过期");
    });

    it("binds a new-device email code to the browser credential and trusts it after verification", async () => {
      const harness = createAccountSecurityHarness();
      const challenge = await harness.service.requestDeviceLoginVerification(authenticatedUser(), sessionContext);
      const code = verificationCodeFrom(latestMailText(harness.sendMail));

      await expect(harness.service.consumeDeviceLoginVerification(challenge.challengeToken, code, sessionContext)).resolves.toEqual({ userId: 17 });

      expect(harness.verificationRequests[0]).toMatchObject({
        purpose: EmailVerificationPurpose.device_login,
        status: EmailVerificationStatus.consumed,
      });
      expect(harness.trustedDeviceUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            userId: 17,
            trustedAt: expect.any(Date),
          }),
          update: expect.objectContaining({ trustedAt: expect.any(Date) }),
        }),
      );
    });

    it("rejects a device verification code from another browser credential", async () => {
      const harness = createAccountSecurityHarness();
      const challenge = await harness.service.requestDeviceLoginVerification(authenticatedUser(), sessionContext);
      const code = verificationCodeFrom(latestMailText(harness.sendMail));

      await expect(
        harness.service.consumeDeviceLoginVerification(challenge.challengeToken, code, {
          ...sessionContext,
          trustedDeviceToken: "another-browser-device-token-value",
        }),
      ).rejects.toThrow("设备验证信息不匹配");
      expect(harness.trustedDeviceUpsert).not.toHaveBeenCalled();
    });
  });

  describe("AccountSecurityService login risk recognition", () => {
    it.each([
      {
        name: "new device",
        knownDevice: null,
        knownIp: 1,
        recentLogins: 0,
        expectedType: LoginSecurityEventType.new_device,
        expectedRisk: LoginRiskLevel.medium,
      },
      {
        name: "unfamiliar IP",
        knownDevice: { id: 1 },
        knownIp: 0,
        recentLogins: 0,
        expectedType: LoginSecurityEventType.new_ip,
        expectedRisk: LoginRiskLevel.low,
      },
      {
        name: "unusual frequency",
        knownDevice: { id: 1 },
        knownIp: 1,
        recentLogins: 5,
        expectedType: LoginSecurityEventType.unusual_frequency,
        expectedRisk: LoginRiskLevel.high,
      },
    ])("identifies $name and emits enabled notifications", async ({ knownDevice, knownIp, recentLogins, expectedType, expectedRisk }) => {
      const createEvent = jest.fn(async ({ data }: { data: { type: LoginSecurityEventType } }) => data);
      const createNotification = jest.fn(async () => undefined);
      const sendMail = jest.fn(async () => undefined);
      const prisma = {
        knownLoginDevice: {
          findUnique: jest.fn(async () => knownDevice),
          count: jest.fn(async () => knownIp),
          upsert: jest.fn(async () => undefined),
        },
        loginSecurityEvent: {
          count: jest.fn(async () => recentLogins),
          create: createEvent,
        },
        userSecurityPreference: {
          upsert: jest.fn(async () => ({
            loginAlertsEnabled: true,
            emailAlertsEnabled: true,
            newDeviceAlertsEnabled: true,
          })),
        },
        userNotification: { create: createNotification },
        $transaction: jest.fn(async (operations: unknown[]) => Promise.all(operations)),
      };
      const service = new AccountSecurityService(
        prisma as unknown as PrismaService,
        {} as RedisService,
        {
          getConfiguration: jest.fn(async () => ({
            smtpEnabled: true,
            turnstileRecoveryEnabled: false,
          })),
        } as unknown as SecurityConfigurationService,
        {
          verify: jest.fn(async () => undefined),
        } as unknown as TurnstileService,
        { send: sendMail } as unknown as MailService,
      );

      await service.recordLogin(authenticatedUser(), sessionContext);

      expect(createEvent).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: expectedType,
          riskLevel: expectedRisk,
          metadata: expect.objectContaining({
            recentLoginCount: recentLogins + 1,
          }),
        }),
      });
      expect(createNotification).toHaveBeenCalledTimes(1);
      expect(sendMail).toHaveBeenCalledTimes(1);
    });

    it("honors disabled new-device notification preferences", async () => {
      const createNotification = jest.fn(async () => undefined);
      const sendMail = jest.fn(async () => undefined);
      const prisma = {
        knownLoginDevice: {
          findUnique: jest.fn(async () => null),
          count: jest.fn(async () => 0),
          upsert: jest.fn(async () => undefined),
        },
        loginSecurityEvent: {
          count: jest.fn(async () => 0),
          create: jest.fn(async () => undefined),
        },
        userSecurityPreference: {
          upsert: jest.fn(async () => ({
            loginAlertsEnabled: true,
            emailAlertsEnabled: true,
            newDeviceAlertsEnabled: false,
          })),
        },
        userNotification: { create: createNotification },
        $transaction: jest.fn(async (operations: unknown[]) => Promise.all(operations)),
      };
      const service = new AccountSecurityService(
        prisma as unknown as PrismaService,
        {} as RedisService,
        {} as SecurityConfigurationService,
        {} as TurnstileService,
        { send: sendMail } as unknown as MailService,
      );

      await service.recordLogin(authenticatedUser(), sessionContext);

      expect(createNotification).not.toHaveBeenCalled();
      expect(sendMail).not.toHaveBeenCalled();
    });
  });

  describe("AuthService password reset", () => {
    it("revokes every refresh session after updating the reset password", async () => {
      const updateOwnPassword = jest.fn(async () => undefined);
      const revokeAllSessions = jest.fn(async () => 4);
      const consumePasswordResetToken = jest.fn(async () => ({ userId: 17 }));
      const recordPasswordEvent = jest.fn(async () => undefined);
      const accountSecurity = {
        consumePasswordResetToken,
        recordPasswordEvent,
      };
      const service = new AuthService(
        { updateOwnPassword } as never,
        {} as never,
        { revokeAllSessions } as never,
        {} as never,
        {} as never,
        {} as never,
        accountSecurity as unknown as AccountSecurityService,
        {
          getConfiguration: jest.fn(async () => ({
            smtpEnabled: true,
            passwordRecoveryEnabled: true,
            turnstileRecoveryEnabled: false,
          })),
        } as unknown as SecurityConfigurationService,
        {
          verify: jest.fn(async () => undefined),
        } as unknown as TurnstileService,
        {} as never,
      );

      const result = await service.resetPassword(
        {
          token: "one-time-password-reset-token",
          newPassword: "NewSecret123!",
        },
        sessionContext,
      );

      expect(result).toEqual({ success: true, revokedSessions: 4 });
      expect(updateOwnPassword).toHaveBeenCalledWith(17, "NewSecret123!", true);
      expect(revokeAllSessions).toHaveBeenCalledWith(17);
      expect(recordPasswordEvent).toHaveBeenCalledWith(17, LoginSecurityEventType.password_reset, sessionContext);
      expect(updateOwnPassword.mock.invocationCallOrder[0]).toBeLessThan(revokeAllSessions.mock.invocationCallOrder[0]);
    });
  });
});
