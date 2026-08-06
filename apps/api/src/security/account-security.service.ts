import { BadRequestException, ConflictException, HttpException, Injectable } from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  EmailVerificationPurpose,
  EmailVerificationStatus,
  LoginRiskLevel,
  LoginSecurityEventType,
  MailJobType,
  PasswordResetStatus,
  Prisma,
  UserNotificationChannel,
  UserNotificationType,
} from "../generated/prisma/client";
import { AuthenticatedUser, RefreshSessionContext } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { ConfirmEmailVerificationDto, UpdateSecurityPreferencesDto } from "./dto/security.dto";
import { MailService } from "./mail.service";
import { SecurityConfigurationService } from "./security-configuration.service";
import { TurnstileService } from "./turnstile.service";

@Injectable()
export class AccountSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configuration: SecurityConfigurationService,
    private readonly turnstile: TurnstileService,
    private readonly mail: MailService,
  ) {}

  async requestRegistrationCode(email: string, turnstileToken: string | undefined, context: RefreshSessionContext) {
    const config = await this.configuration.getConfiguration();
    if (!config.registrationEmailVerificationEnabled) {
      throw new BadRequestException("注册邮箱验证当前未启用。");
    }
    await this.turnstile.verify(turnstileToken, context.ip, config.turnstileRegistrationEnabled);
    await this.assertCodeRateLimit(email, context.ip, "registration");
    if (await this.prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException("该邮箱已被使用。");
    }
    const code = this.createCode();
    await this.expirePendingCodes(email, EmailVerificationPurpose.registration);
    const request = await this.prisma.emailVerificationRequest.create({
      data: {
        purpose: EmailVerificationPurpose.registration,
        email,
        codeHash: this.hashCode(email, code),
        ip: context.ip,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    try {
      await this.mail.send({
        type: MailJobType.registration_verification,
        recipient: email,
        subject: "HLOVET 注册验证码",
        text: `你的 HLOVET 注册验证码是 ${code}，10 分钟内有效。请勿将验证码告诉他人。`,
        html: `<p>你的 HLOVET 注册验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 10 分钟内有效，请勿将验证码告诉他人。</p>`,
        metadata: { verificationRequestId: request.id, purpose: "registration" },
      });
    } catch (error) {
      await this.prisma.emailVerificationRequest.update({ where: { id: request.id }, data: { status: EmailVerificationStatus.expired } });
      throw error;
    }
    return { success: true as const, retryAfterSeconds: 60 };
  }

  async consumeRegistrationCode(email: string, code: string): Promise<void> {
    const config = await this.configuration.getConfiguration();
    if (!config.registrationEmailVerificationEnabled) return;
    const request = await this.requireValidCode(email, EmailVerificationPurpose.registration, code);
    const consumed = await this.prisma.emailVerificationRequest.updateMany({
      where: { id: request.id, status: EmailVerificationStatus.pending },
      data: { status: EmailVerificationStatus.consumed, verifiedAt: new Date(), consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException("验证码已使用，请重新获取。");
  }

  async sendAccountEmailCode(user: AuthenticatedUser, context: RefreshSessionContext) {
    await this.assertCodeRateLimit(user.email, context.ip, "account");
    const code = this.createCode();
    await this.expirePendingCodes(user.email, EmailVerificationPurpose.account_email);
    const request = await this.prisma.emailVerificationRequest.create({
      data: {
        userId: user.id,
        purpose: EmailVerificationPurpose.account_email,
        email: user.email,
        codeHash: this.hashCode(user.email, code),
        ip: context.ip,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    try {
      await this.mail.send({
        type: MailJobType.account_email_verification,
        recipient: user.email,
        subject: "HLOVET 邮箱验证",
        text: `你的 HLOVET 邮箱验证码是 ${code}，10 分钟内有效。`,
        html: `<p>你的 HLOVET 邮箱验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>验证码 10 分钟内有效。</p>`,
        userId: user.id,
        metadata: { verificationRequestId: request.id, purpose: "account_email" },
      });
    } catch (error) {
      await this.prisma.emailVerificationRequest.update({ where: { id: request.id }, data: { status: EmailVerificationStatus.expired } });
      throw error;
    }
    return { success: true as const, retryAfterSeconds: 60 };
  }

  async confirmAccountEmail(user: AuthenticatedUser, dto: ConfirmEmailVerificationDto, context: RefreshSessionContext) {
    const request = await this.requireValidCode(user.email, EmailVerificationPurpose.account_email, dto.code, user.id);
    await this.prisma.$transaction([
      this.prisma.emailVerificationRequest.update({
        where: { id: request.id },
        data: { status: EmailVerificationStatus.consumed, verifiedAt: new Date(), consumedAt: new Date() },
      }),
      this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } }),
      this.prisma.loginSecurityEvent.create({
        data: this.eventData(user.id, LoginSecurityEventType.email_verified, LoginRiskLevel.info, "账号邮箱验证完成", context),
      }),
    ]);
    return { success: true as const, emailVerifiedAt: new Date().toISOString() };
  }

  async requestPasswordReset(email: string, turnstileToken: string | undefined, context: RefreshSessionContext) {
    const config = await this.configuration.getConfiguration();
    if (!config.passwordRecoveryEnabled) throw new BadRequestException("密码找回当前未启用。");
    await this.turnstile.verify(turnstileToken, context.ip, config.turnstileRecoveryEnabled);
    await this.assertRecoveryRateLimit(email, context.ip);
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, nickname: true, status: true, emailVerifiedAt: true },
    });
    if (!user || user.status !== "active" || !user.emailVerifiedAt) return { success: true as const };
    await this.prisma.passwordResetRequest.updateMany({
      where: { userId: user.id, status: PasswordResetStatus.pending },
      data: { status: PasswordResetStatus.expired },
    });
    const token = randomBytes(32).toString("base64url");
    const request = await this.prisma.passwordResetRequest.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(token),
        ip: context.ip,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    const origin = (process.env.WEB_ORIGIN ?? `https://${process.env.SITE_DOMAIN ?? "5200918.xyz"}`).replace(/\/$/, "");
    const resetUrl = `${origin}/forgot-password?token=${encodeURIComponent(token)}`;
    await this.mail.send({
      type: MailJobType.password_reset,
      recipient: user.email,
      subject: "重置你的 HLOVET 密码",
      text: `请在 30 分钟内打开以下地址重置密码：${resetUrl}\n如果不是你本人操作，请忽略这封邮件。`,
      html: `<p>${this.escapeHtml(user.nickname)}，你好：</p><p>请在 30 分钟内打开下面的地址重置密码：</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>如果不是你本人操作，请忽略这封邮件。</p>`,
      userId: user.id,
      metadata: { passwordResetRequestId: request.id },
    });
    return { success: true as const };
  }

  async consumePasswordResetToken(token: string): Promise<{ userId: number }> {
    const request = await this.prisma.passwordResetRequest.findUnique({
      where: { tokenHash: this.hashToken(token) },
      select: { id: true, userId: true, status: true, expiresAt: true },
    });
    if (!request || request.status !== PasswordResetStatus.pending || request.expiresAt.getTime() <= Date.now()) {
      if (request?.status === PasswordResetStatus.pending) {
        await this.prisma.passwordResetRequest.update({ where: { id: request.id }, data: { status: PasswordResetStatus.expired } });
      }
      throw new BadRequestException("重置链接无效或已过期。");
    }
    const consumed = await this.prisma.passwordResetRequest.updateMany({
      where: { id: request.id, status: PasswordResetStatus.pending },
      data: { status: PasswordResetStatus.consumed, consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException("重置链接已使用。");
    return { userId: request.userId };
  }

  async getMySecurity(userId: number) {
    const [user, preferences, events, devices] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerifiedAt: true } }),
      this.ensurePreferences(userId),
      this.prisma.loginSecurityEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 }),
      this.prisma.knownLoginDevice.findMany({ where: { userId }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
    ]);
    return {
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      preferences: this.preferenceResponse(preferences),
      events: events.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() })),
      trustedDevices: devices.map((device) => ({
        id: device.id,
        label: device.label,
        firstIp: device.firstIp,
        lastIp: device.lastIp,
        firstSeenAt: device.firstSeenAt.toISOString(),
        lastSeenAt: device.lastSeenAt.toISOString(),
      })),
    };
  }

  async updatePreferences(userId: number, dto: UpdateSecurityPreferencesDto) {
    const preferences = await this.prisma.userSecurityPreference.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
    return this.preferenceResponse(preferences);
  }

  async recordLogin(user: AuthenticatedUser, context: RefreshSessionContext): Promise<void> {
    const fingerprint = this.deviceFingerprint(context);
    const deviceLabel = this.deviceLabel(context.userAgent);
    const [knownDevice, knownIp, recentLogins, preferences] = await Promise.all([
      this.prisma.knownLoginDevice.findUnique({ where: { userId_fingerprint: { userId: user.id, fingerprint } } }),
      this.prisma.knownLoginDevice.count({ where: { userId: user.id, OR: [{ firstIp: context.ip }, { lastIp: context.ip }] } }),
      this.prisma.loginSecurityEvent.count({
        where: {
          userId: user.id,
          type: { in: [
            LoginSecurityEventType.login_success,
            LoginSecurityEventType.new_device,
            LoginSecurityEventType.new_ip,
            LoginSecurityEventType.unusual_frequency,
          ] },
          createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
        },
      }),
      this.ensurePreferences(user.id),
    ]);
    const isNewDevice = !knownDevice;
    const isNewIp = knownIp === 0;
    const unusualFrequency = recentLogins >= 5;
    const type = unusualFrequency
      ? LoginSecurityEventType.unusual_frequency
      : isNewDevice
        ? LoginSecurityEventType.new_device
        : isNewIp
          ? LoginSecurityEventType.new_ip
          : LoginSecurityEventType.login_success;
    const riskLevel = unusualFrequency ? LoginRiskLevel.high : isNewDevice ? LoginRiskLevel.medium : isNewIp ? LoginRiskLevel.low : LoginRiskLevel.info;
    const summary = unusualFrequency ? "短时间内出现多次登录" : isNewDevice ? "新设备登录" : isNewIp ? "陌生 IP 登录" : "账号登录成功";
    await this.prisma.$transaction([
      this.prisma.knownLoginDevice.upsert({
        where: { userId_fingerprint: { userId: user.id, fingerprint } },
        create: { userId: user.id, fingerprint, label: deviceLabel, userAgent: context.userAgent.slice(0, 500), firstIp: context.ip, lastIp: context.ip },
        update: { label: deviceLabel, userAgent: context.userAgent.slice(0, 500), lastIp: context.ip, lastSeenAt: new Date() },
      }),
      this.prisma.loginSecurityEvent.create({
        data: {
          ...this.eventData(user.id, type, riskLevel, summary, context),
          metadata: { isNewDevice, isNewIp, recentLoginCount: recentLogins + 1 },
        },
      }),
    ]);
    if (type !== LoginSecurityEventType.login_success && preferences.loginAlertsEnabled && (!isNewDevice || preferences.newDeviceAlertsEnabled)) {
      await this.prisma.userNotification.create({
        data: {
          userId: user.id,
          type: UserNotificationType.system,
          channel: UserNotificationChannel.system,
          title: summary,
          body: `${deviceLabel} · ${context.ip} · ${this.formatDateTime(new Date())}`,
          actionUrl: "/profile#account-security",
        },
      });
    }
    if (type !== LoginSecurityEventType.login_success && preferences.emailAlertsEnabled && (!isNewDevice || preferences.newDeviceAlertsEnabled)) {
      void this.mail.send({
        type: MailJobType.login_risk,
        recipient: user.email,
        subject: `HLOVET 安全提醒：${summary}`,
        text: `${summary}\n设备：${deviceLabel}\nIP：${context.ip}\n时间：${this.formatDateTime(new Date())}\n如非本人操作，请立即修改密码并退出其他设备。`,
        userId: user.id,
        metadata: { eventType: type, ip: context.ip },
      }).catch(() => undefined);
    }
  }

  async recordBlockedLogin(userId: number, context: RefreshSessionContext): Promise<void> {
    await this.prisma.loginSecurityEvent.create({
      data: this.eventData(userId, LoginSecurityEventType.login_blocked, LoginRiskLevel.high, "登录失败次数过多，已临时限制", context),
    });
  }

  async recordPasswordEvent(userId: number, type: LoginSecurityEventType, context: RefreshSessionContext): Promise<void> {
    await this.prisma.loginSecurityEvent.create({
      data: this.eventData(userId, type, LoginRiskLevel.medium, type === LoginSecurityEventType.password_reset ? "通过邮箱重置密码" : "账号密码已修改", context),
    });
  }

  async listAdminOverview(query: { tab: "mail" | "verification" | "risk"; page: number; pageSize: number; search?: string; status?: string }) {
    const skip = (query.page - 1) * query.pageSize;
    const search = query.search?.trim();
    if (query.tab === "verification") {
      const where: Prisma.EmailVerificationRequestWhereInput = {
        ...(query.status ? { status: query.status as EmailVerificationStatus } : {}),
        ...(search ? { OR: [{ email: { contains: search } }, { ip: { contains: search } }] } : {}),
      };
      const [total, items] = await Promise.all([
        this.prisma.emailVerificationRequest.count({ where }),
        this.prisma.emailVerificationRequest.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: query.pageSize,
          select: {
            id: true,
            userId: true,
            purpose: true,
            email: true,
            status: true,
            attempts: true,
            ip: true,
            expiresAt: true,
            verifiedAt: true,
            consumedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);
      return this.page(items, total, query.page, query.pageSize);
    }
    if (query.tab === "risk") {
      const where: Prisma.LoginSecurityEventWhereInput = {
        ...(query.status ? { riskLevel: query.status as LoginRiskLevel } : {}),
        ...(search ? { OR: [{ summary: { contains: search } }, { ip: { contains: search } }, { deviceLabel: { contains: search } }, { user: { is: { OR: [{ username: { contains: search } }, { nickname: { contains: search } }] } } }] } : {}),
      };
      const [total, items] = await Promise.all([
        this.prisma.loginSecurityEvent.count({ where }),
        this.prisma.loginSecurityEvent.findMany({ where, include: { user: { select: { username: true, nickname: true } } }, orderBy: { createdAt: "desc" }, skip, take: query.pageSize }),
      ]);
      return this.page(items, total, query.page, query.pageSize);
    }
    const where: Prisma.MailJobWhereInput = {
      ...(query.status ? { status: query.status as never } : {}),
      ...(search ? { OR: [{ recipient: { contains: search } }, { subject: { contains: search } }, { lastError: { contains: search } }] } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.mailJob.count({ where }),
      this.prisma.mailJob.findMany({ where, orderBy: { createdAt: "desc" }, skip, take: query.pageSize }),
    ]);
    return this.page(items, total, query.page, query.pageSize);
  }

  private async requireValidCode(email: string, purpose: EmailVerificationPurpose, code: string, userId?: number) {
    const request = await this.prisma.emailVerificationRequest.findFirst({
      where: { email, purpose, status: EmailVerificationStatus.pending, ...(userId ? { userId } : {}) },
      orderBy: { createdAt: "desc" },
    });
    if (!request || request.expiresAt.getTime() <= Date.now()) {
      if (request) await this.prisma.emailVerificationRequest.update({ where: { id: request.id }, data: { status: EmailVerificationStatus.expired } });
      throw new BadRequestException("验证码无效或已过期。");
    }
    if (request.attempts >= 5) {
      await this.prisma.emailVerificationRequest.update({ where: { id: request.id }, data: { status: EmailVerificationStatus.expired } });
      throw new BadRequestException("验证码尝试次数过多，请重新获取。");
    }
    const expected = Buffer.from(request.codeHash, "hex");
    const actual = Buffer.from(this.hashCode(email, code), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await this.prisma.emailVerificationRequest.update({ where: { id: request.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException("验证码不正确。");
    }
    return request;
  }

  private async expirePendingCodes(email: string, purpose: EmailVerificationPurpose): Promise<void> {
    await this.prisma.emailVerificationRequest.updateMany({
      where: { email, purpose, status: EmailVerificationStatus.pending },
      data: { status: EmailVerificationStatus.expired },
    });
  }

  private async assertCodeRateLimit(email: string, ip: string, purpose: string): Promise<void> {
    await this.assertRate(`security:code:email:${purpose}:${email}`, 1, 60);
    await this.assertRate(`security:code:ip:${purpose}:${ip}`, 10, 3600);
  }

  private async assertRecoveryRateLimit(email: string, ip: string): Promise<void> {
    await this.assertRate(`security:recovery:email:${email}`, 3, 3600);
    await this.assertRate(`security:recovery:ip:${ip}`, 10, 3600);
  }

  private async assertRate(key: string, limit: number, ttl: number): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, ttl);
    if (count > limit) throw new HttpException("操作过于频繁，请稍后再试。", 429);
  }

  private async ensurePreferences(userId: number) {
    return this.prisma.userSecurityPreference.upsert({ where: { userId }, create: { userId }, update: {} });
  }

  private preferenceResponse(preferences: { loginAlertsEnabled: boolean; emailAlertsEnabled: boolean; newDeviceAlertsEnabled: boolean }) {
    return {
      loginAlertsEnabled: preferences.loginAlertsEnabled,
      emailAlertsEnabled: preferences.emailAlertsEnabled,
      newDeviceAlertsEnabled: preferences.newDeviceAlertsEnabled,
    };
  }

  private eventData(userId: number, type: LoginSecurityEventType, riskLevel: LoginRiskLevel, summary: string, context: RefreshSessionContext) {
    return {
      userId,
      type,
      riskLevel,
      summary,
      ip: context.ip,
      userAgent: context.userAgent.slice(0, 500),
      deviceFingerprint: this.deviceFingerprint(context),
      deviceLabel: this.deviceLabel(context.userAgent),
    };
  }

  private deviceFingerprint(context: RefreshSessionContext): string {
    return createHash("sha256").update(context.deviceId?.trim() || context.userAgent || "unknown").digest("hex");
  }

  private deviceLabel(userAgent: string): string {
    const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "未知浏览器";
    const system = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS X/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "未知系统";
    return `${browser} · ${system}`;
  }

  private createCode(): string {
    return randomInt(100000, 1000000).toString();
  }

  private hashCode(email: string, code: string): string {
    return createHmac("sha256", process.env.REFRESH_TOKEN_SECRET ?? "dev-security-code-secret").update(`${email}:${code}`).digest("hex");
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private formatDateTime(value: Date): string {
    return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value);
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character));
  }

  private page<T>(items: T[], total: number, page: number, pageSize: number) {
    return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
  }
}
