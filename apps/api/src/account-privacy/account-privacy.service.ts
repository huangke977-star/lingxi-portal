import { BadRequestException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException, forwardRef, Inject } from "@nestjs/common";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { Prisma, UserStatus, DataExportJobStatus } from "../generated/prisma/client";
import { AuthenticatedUser, RefreshSessionContext } from "../auth/auth.types";
import { PasswordService } from "../auth/password.service";
import { PrismaService } from "../prisma/prisma.service";
import { SecretCryptoService } from "../security/secret-crypto.service";
import { FriendshipStatus } from "../generated/prisma/client";
import { TotpService } from "./totp.service";
import { AccountSecurityService } from "../security/account-security.service";
import { RefreshTokenService } from "../auth/refresh-token.service";
import { parseSensitiveAction, SensitiveAction } from "../security/sensitive-action";

const DELETION_COOLING_OFF_MS = 7 * 24 * 60 * 60 * 1000;
const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
const EXPORT_RATE_LIMIT_MS = 10 * 60 * 1000;
const RECOVERY_CODE_LENGTH = 6;
const RECOVERY_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

@Injectable()
export class AccountPrivacyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountPrivacyService.name);
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly exportJobs = new Set<number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly secretCrypto: SecretCryptoService,
    private readonly totp: TotpService,
    private readonly accountSecurity: AccountSecurityService,
    @Inject(forwardRef(() => RefreshTokenService))
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    this.cleanupTimer = setInterval(() => void this.runCleanup(), 60_000);
    this.cleanupTimer.unref();
    setTimeout(() => void this.runCleanup(), 5_000).unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async getOverview(user: AuthenticatedUser, context?: RefreshSessionContext) {
    const [account, credential, blocked] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.id },
        select: {
          status: true,
          deletionRequestedAt: true,
          deletionScheduledAt: true,
          deletedAt: true,
        },
      }),
      this.prisma.userTotpCredential.findUnique({
        where: { userId: user.id },
        select: { enabled: true, confirmedAt: true },
      }),
      this.listBlockedUsers(user.id),
    ]);
    if (!account) throw new NotFoundException("用户不存在。");
    if (context) await this.recordAudit(user.id, "privacy_overview_viewed", undefined, context);
    return {
      deletion: {
        pending: account.status === UserStatus.deletion_pending,
        requestedAt: account.deletionRequestedAt?.toISOString() ?? null,
        scheduledAt: account.deletionScheduledAt?.toISOString() ?? null,
        deletedAt: account.deletedAt?.toISOString() ?? null,
      },
      totp: {
        enabled: Boolean(credential?.enabled),
        confirmedAt: credential?.confirmedAt?.toISOString() ?? null,
      },
      blocked,
    };
  }

  async requestExport(user: AuthenticatedUser, context: RefreshSessionContext): Promise<{ id: number; status: string; expiresAt: string }> {
    await this.assertNotDeletionPending(user.id);
    const recent = await this.prisma.dataExportJob.findFirst({
      where: {
        userId: user.id,
        createdAt: { gte: new Date(Date.now() - EXPORT_RATE_LIMIT_MS) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, expiresAt: true },
    });
    if (recent && (recent.status === DataExportJobStatus.queued || recent.status === DataExportJobStatus.processing || recent.status === DataExportJobStatus.completed)) {
      return {
        id: recent.id,
        status: recent.status,
        expiresAt: recent.expiresAt.toISOString(),
      };
    }
    const job = await this.prisma.dataExportJob.create({
      data: {
        userId: user.id,
        status: DataExportJobStatus.queued,
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
      },
      select: { id: true, status: true, expiresAt: true },
    });
    await this.recordAudit(user.id, "data_export_requested", { jobId: job.id }, context);
    void this.processExport(job.id);
    return {
      id: job.id,
      status: job.status,
      expiresAt: job.expiresAt.toISOString(),
    };
  }

  async getExport(user: AuthenticatedUser, id: number) {
    const job = await this.prisma.dataExportJob.findFirst({
      where: { id, userId: user.id },
    });
    if (!job) throw new NotFoundException("导出任务不存在。");
    if (job.expiresAt <= new Date() && job.status !== DataExportJobStatus.expired) {
      await this.prisma.dataExportJob.update({
        where: { id },
        data: { status: DataExportJobStatus.expired, payload: Prisma.JsonNull },
      });
      throw new GoneException("导出文件已过期，请重新申请。");
    }
    return {
      id: job.id,
      status: job.status,
      error: job.errorMessage,
      expiresAt: job.expiresAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
    };
  }

  async downloadExport(user: AuthenticatedUser, id: number, context?: RefreshSessionContext): Promise<Record<string, unknown>> {
    const job = await this.prisma.dataExportJob.findFirst({
      where: { id, userId: user.id },
    });
    if (!job) throw new NotFoundException("导出任务不存在。");
    if (job.expiresAt <= new Date()) throw new GoneException("导出文件已过期，请重新申请。");
    if (job.status !== DataExportJobStatus.completed || !job.payload) throw new BadRequestException("导出文件尚未生成完成。");
    await this.prisma.dataExportJob.update({
      where: { id },
      data: { downloadedAt: new Date() },
    });
    await this.recordAudit(user.id, "data_export_downloaded", { jobId: id }, context);
    return job.payload as Record<string, unknown>;
  }

  async requestDeletionAfterVerification(user: AuthenticatedUser, verificationToken: string, context: RefreshSessionContext) {
    await this.accountSecurity.consumeSensitiveActionGrant(user.id, "account_deletion", verificationToken, context);
    await this.assertNotDeletionPending(user.id);
    return this.scheduleDeletion(user, context);
  }

  async cancelDeletion(user: AuthenticatedUser, context: RefreshSessionContext) {
    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { status: true },
    });
    if (!account || account.status !== UserStatus.deletion_pending) throw new BadRequestException("当前没有待执行的注销申请。");
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: UserStatus.active,
        deletionRequestedAt: null,
        deletionScheduledAt: null,
      },
    });
    await this.recordAudit(user.id, "account_deletion_cancelled", undefined, context);
    return { pending: false };
  }

  async beginTotpEnrollment(user: AuthenticatedUser, context: RefreshSessionContext) {
    await this.assertNotDeletionPending(user.id);
    if (!this.secretCrypto.isConfigured()) throw new BadRequestException("服务器尚未配置安全凭据加密密钥。");
    const secret = this.totp.generateSecret();
    await this.prisma.userTotpCredential.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        encryptedSecret: this.secretCrypto.encrypt(secret),
        enabled: false,
      },
      update: {
        encryptedSecret: this.secretCrypto.encrypt(secret),
        enabled: false,
        confirmedAt: null,
        recoveryCodeHashes: Prisma.JsonNull,
      },
    });
    await this.recordAudit(user.id, "totp_enrollment_started", undefined, context);
    return {
      secret,
      otpAuthUri: this.totp.buildOtpAuthUri(secret, user.email || user.username),
    };
  }

  async beginTotpEnrollmentAfterVerification(user: AuthenticatedUser, verificationToken: string, context: RefreshSessionContext) {
    await this.accountSecurity.consumeSensitiveActionGrant(user.id, "totp_enrollment", verificationToken, context);
    return this.beginTotpEnrollment(user, context);
  }

  async requestSensitiveActionEmail(user: AuthenticatedUser, action: string, context: RefreshSessionContext) {
    return this.accountSecurity.requestSensitiveActionVerification(user, this.requireSensitiveAction(action), context);
  }

  async verifySensitiveActionEmail(user: AuthenticatedUser, action: string, challengeToken: string, code: string, context: RefreshSessionContext) {
    const normalizedAction = this.requireSensitiveAction(action);
    const verificationToken = await this.accountSecurity.consumeSensitiveActionVerification(user, normalizedAction, challengeToken, code, context);
    return { success: true as const, verificationToken };
  }

  async verifySensitiveActionPassword(user: AuthenticatedUser, action: string, currentPassword: string, context: RefreshSessionContext) {
    const normalizedAction = this.requireSensitiveAction(action);
    const stored = await this.prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true, status: true } });
    if (!stored || stored.status !== UserStatus.active || !(await this.passwordService.verifyPassword(currentPassword, stored.passwordHash))) {
      throw new UnauthorizedException("当前密码不正确。\nThe current password is incorrect.");
    }
    return { success: true as const, verificationToken: await this.accountSecurity.issueSensitiveActionGrant(user.id, normalizedAction, context) };
  }

  async verifySensitiveActionTotp(user: AuthenticatedUser, action: string, code: string, context: RefreshSessionContext) {
    const normalizedAction = this.requireSensitiveAction(action);
    if ((await this.verifyTotpForLogin(user.id, code)) !== true) {
      throw new UnauthorizedException("双因素验证码不正确。\nThe authenticator code is incorrect.");
    }
    return { success: true as const, verificationToken: await this.accountSecurity.issueSensitiveActionGrant(user.id, normalizedAction, context) };
  }

  async confirmTotp(user: AuthenticatedUser, code: string, context: RefreshSessionContext) {
    const credential = await this.prisma.userTotpCredential.findUnique({
      where: { userId: user.id },
    });
    if (!credential) throw new BadRequestException("请先开始双因素认证绑定。");
    if (!this.totp.verify(this.secretCrypto.decrypt(credential.encryptedSecret), code)) throw new BadRequestException("验证码无效或已过期。");
    const recoveryCodes = Array.from({ length: 8 }, () => this.generateRecoveryCode());
    await this.prisma.userTotpCredential.update({
      where: { userId: user.id },
      data: {
        enabled: true,
        confirmedAt: new Date(),
        recoveryCodeHashes: recoveryCodes.map((item) => this.hash(item)),
      },
    });
    await this.recordAudit(user.id, "totp_enabled", undefined, context);
    return { enabled: true, recoveryCodes };
  }

  async disableTotp(user: AuthenticatedUser, code: string, context: RefreshSessionContext) {
    const credential = await this.prisma.userTotpCredential.findUnique({
      where: { userId: user.id },
    });
    if (!credential?.enabled) return { enabled: false };
    const valid = this.totp.verify(this.secretCrypto.decrypt(credential.encryptedSecret), code) || (await this.consumeRecoveryCode(credential.userId, credential.recoveryCodeHashes, code));
    if (!valid) throw new BadRequestException("验证码无效。");
    await this.prisma.userTotpCredential.delete({ where: { userId: user.id } });
    await this.recordAudit(user.id, "totp_disabled", undefined, context);
    return { enabled: false };
  }

  async disableTotpWithPassword(user: AuthenticatedUser, currentPassword: string, context: RefreshSessionContext) {
    const credential = await this.prisma.userTotpCredential.findUnique({
      where: { userId: user.id },
      select: { enabled: true },
    });
    if (!credential?.enabled) return { enabled: false };
    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!account || !(await this.passwordService.verifyPassword(currentPassword, account.passwordHash))) {
      throw new UnauthorizedException("当前密码不正确。\nThe current password is incorrect.");
    }
    return this.disableTotpAfterVerification(user, context);
  }

  async disableTotpAfterVerification(user: AuthenticatedUser, context: RefreshSessionContext) {
    const credential = await this.prisma.userTotpCredential.findUnique({
      where: { userId: user.id },
      select: { enabled: true },
    });
    if (!credential?.enabled) return { enabled: false as const };
    await this.prisma.userTotpCredential.delete({ where: { userId: user.id } });
    await this.recordAudit(user.id, "totp_disabled", undefined, context);
    return { enabled: false as const };
  }

  async requestTotpDisableVerification(user: AuthenticatedUser, context: RefreshSessionContext) {
    const credential = await this.prisma.userTotpCredential.findUnique({
      where: { userId: user.id },
      select: { enabled: true },
    });
    if (!credential?.enabled) throw new BadRequestException("当前未启用双因素认证。");
    return this.accountSecurity.requestTotpDisableVerification(user, context);
  }

  async disableTotpWithEmail(user: AuthenticatedUser, code: string, context: RefreshSessionContext) {
    const credential = await this.prisma.userTotpCredential.findUnique({
      where: { userId: user.id },
      select: { enabled: true },
    });
    if (!credential?.enabled) return { enabled: false };
    await this.accountSecurity.consumeTotpDisableVerification(user, code);
    await this.prisma.userTotpCredential.delete({ where: { userId: user.id } });
    await this.recordAudit(user.id, "totp_disabled_by_email", undefined, context);
    return { enabled: false };
  }

  async resetTotpBySuperAdmin(actor: AuthenticatedUser, targetUserId: number, context: RefreshSessionContext) {
    if (!actor.isSuperAdmin) throw new ForbiddenException("仅超级管理员可以解除用户的双因素认证。");
    if (actor.id === targetUserId) throw new ForbiddenException("请在隐私与数据页面解除自己的双因素认证。");
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, isSuperAdmin: true },
    });
    if (!target) throw new NotFoundException("用户不存在。");
    if (target.isSuperAdmin) throw new ForbiddenException("不能从用户管理中解除超级管理员的双因素认证。");
    const credential = await this.prisma.userTotpCredential.findUnique({
      where: { userId: targetUserId },
      select: { enabled: true },
    });
    if (!credential?.enabled) return { enabled: false, revokedSessions: 0 };

    await this.prisma.$transaction([
      this.prisma.userTotpCredential.delete({
        where: { userId: targetUserId },
      }),
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { authVersion: { increment: 1 } },
      }),
      this.prisma.privacyAuditRecord.create({
        data: {
          userId: targetUserId,
          action: "totp_reset_by_super_admin",
          metadata: { actorUserId: actor.id },
          ip: context.ip,
          userAgent: context.userAgent,
        },
      }),
      this.prisma.privacyAuditRecord.create({
        data: {
          userId: actor.id,
          action: "totp_reset_for_user",
          metadata: { targetUserId },
          ip: context.ip,
          userAgent: context.userAgent,
        },
      }),
    ]);
    const revokedSessions = await this.refreshTokens.revokeAllSessions(targetUserId);
    return { enabled: false, revokedSessions };
  }

  async verifyTotpForLogin(userId: number, code?: string): Promise<boolean | "required"> {
    const credentialDelegate = this.prisma.userTotpCredential;
    if (!credentialDelegate) return true;
    const credential = await credentialDelegate.findUnique({
      where: { userId },
      select: {
        userId: true,
        enabled: true,
        encryptedSecret: true,
        recoveryCodeHashes: true,
      },
    });
    if (!credential?.enabled) return true;
    if (!code) return "required";
    if (this.totp.verify(this.secretCrypto.decrypt(credential.encryptedSecret), code)) return true;
    return this.consumeRecoveryCode(credential.userId, credential.recoveryCodeHashes, code);
  }

  async verifyCurrentTotp(userId: number, code: string): Promise<boolean> {
    const credential = await this.prisma.userTotpCredential.findUnique({
      where: { userId },
      select: { enabled: true, encryptedSecret: true },
    });
    if (!credential?.enabled) return false;
    return this.totp.verify(this.secretCrypto.decrypt(credential.encryptedSecret), code);
  }

  async listAudit(user: AuthenticatedUser, limit: number) {
    const records = await this.prisma.privacyAuditRecord.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(limit, 100),
    });
    return records.map((record) => ({
      id: record.id,
      action: record.action,
      metadata: record.metadata,
      createdAt: record.createdAt.toISOString(),
    }));
  }

  async listBlockedUsers(userId: number) {
    const records = await this.prisma.friendship.findMany({
      where: {
        status: FriendshipStatus.blocked,
        OR: [{ userOneId: userId }, { userTwoId: userId }],
      },
      include: {
        userOne: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatarStoredName: true,
          },
        },
        userTwo: {
          select: {
            id: true,
            username: true,
            nickname: true,
            avatarStoredName: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    return records.map((record) => {
      const target = record.userOneId === userId ? record.userTwo : record.userOne;
      return {
        friendshipId: record.id,
        user: {
          id: target.id,
          username: target.username,
          nickname: target.nickname,
          avatarUrl: target.avatarStoredName ? `/auth/avatars/${target.avatarStoredName}` : null,
        },
      };
    });
  }

  async listDeletedUsers(actor: AuthenticatedUser, search: string | undefined, page: number, pageSize: number) {
    this.assertManager(actor);
    const keyword = search?.trim();
    const where: Prisma.UserWhereInput = {
      deletedAt: { not: null },
      ...(keyword
        ? {
            OR: [{ deletedOriginalUsername: { contains: keyword } }, { deletedOriginalNickname: { contains: keyword } }, { deletedOriginalEmail: { contains: keyword } }],
          }
        : {}),
    };
    const total = await this.prisma.user.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const actualPage = Math.min(page, totalPages);
    const items = await this.prisma.user.findMany({
      where,
      orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
      skip: (actualPage - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        deletedOriginalUsername: true,
        deletedOriginalNickname: true,
        deletedOriginalEmail: true,
        deletedAt: true,
        _count: { select: { articles: true, articleComments: true } },
      },
    });
    return {
      items: items.map((item) => ({
        id: item.id,
        originalUsername: item.deletedOriginalUsername,
        originalNickname: item.deletedOriginalNickname,
        originalEmail: item.deletedOriginalEmail,
        deletedAt: item.deletedAt?.toISOString() ?? null,
        articleCount: item._count.articles,
        commentCount: item._count.articleComments,
      })),
      total,
      page: actualPage,
      pageSize,
      totalPages,
    };
  }

  async getDeletedUserContent(actor: AuthenticatedUser, id: number) {
    this.assertManager(actor);
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: { not: null } },
      select: {
        id: true,
        deletedOriginalUsername: true,
        deletedOriginalNickname: true,
        deletedOriginalEmail: true,
        deletedAt: true,
      },
    });
    if (!user) throw new NotFoundException("已注销账号不存在。");
    const [articles, comments] = await Promise.all([
      this.prisma.article.findMany({
        where: { authorId: id },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          publishedAt: true,
        },
      }),
      this.prisma.articleComment.findMany({
        where: { authorId: id },
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          articleId: true,
          article: { select: { title: true } },
          body: true,
          status: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      user: {
        id: user.id,
        originalUsername: user.deletedOriginalUsername,
        originalNickname: user.deletedOriginalNickname,
        originalEmail: user.deletedOriginalEmail,
        deletedAt: user.deletedAt?.toISOString() ?? null,
      },
      articles: articles.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
        publishedAt: item.publishedAt?.toISOString() ?? null,
      })),
      comments: comments.map((item) => ({
        ...item,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  private async processExport(id: number): Promise<void> {
    if (this.exportJobs.has(id)) return;
    this.exportJobs.add(id);
    try {
      const claimed = await this.prisma.dataExportJob.updateMany({
        where: { id, status: DataExportJobStatus.queued },
        data: { status: DataExportJobStatus.processing },
      });
      if (!claimed.count) return;
      const job = await this.prisma.dataExportJob.findUnique({
        where: { id },
        select: { userId: true, expiresAt: true },
      });
      if (!job) return;
      const payload = await this.buildExportPayload(job.userId);
      await this.prisma.dataExportJob.update({
        where: { id },
        data: {
          status: DataExportJobStatus.completed,
          payload: payload as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
      await this.recordAudit(job.userId, "data_export_completed", {
        jobId: id,
      });
    } catch (error) {
      this.logger.error(`Data export ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.prisma.dataExportJob
        .update({
          where: { id },
          data: {
            status: DataExportJobStatus.failed,
            errorMessage: "导出生成失败，请稍后重试。",
          },
        })
        .catch(() => undefined);
    } finally {
      this.exportJobs.delete(id);
    }
  }

  private async buildExportPayload(userId: number): Promise<Record<string, unknown>> {
    const [user, articles, comments, favorites, subscriptions, collections, topics, ledgers, loginEvents, devices] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          nickname: true,
          email: true,
          profileBio: true,
          preferredLocale: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.article.findMany({
        where: { authorId: userId },
        select: {
          id: true,
          title: true,
          slug: true,
          summary: true,
          content: true,
          contentFormat: true,
          category: true,
          tags: true,
          visibility: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.articleComment.findMany({
        where: { authorId: userId },
        select: {
          id: true,
          articleId: true,
          parentId: true,
          body: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.articleFavorite.findMany({
        where: { userId },
        select: { articleId: true, createdAt: true },
      }),
      this.prisma.userSubscription.findMany({
        where: { subscriberId: userId },
        select: { authorId: true, notifyNewArticles: true, createdAt: true },
      }),
      this.prisma.articleCollectionSubscription.findMany({
        where: { userId },
        select: { collectionId: true, createdAt: true },
      }),
      this.prisma.articleTopicSubscription.findMany({
        where: { userId },
        select: { topicId: true, createdAt: true },
      }),
      this.prisma.userReputationLedger.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: {
          reason: true,
          eventKey: true,
          experienceDelta: true,
          pointDelta: true,
          pendingPointDelta: true,
          createdAt: true,
        },
      }),
      this.prisma.loginSecurityEvent.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
        select: {
          type: true,
          riskLevel: true,
          summary: true,
          ip: true,
          deviceLabel: true,
          createdAt: true,
        },
      }),
      this.prisma.knownLoginDevice.findMany({
        where: { userId },
        orderBy: { firstSeenAt: "asc" },
        select: {
          label: true,
          firstIp: true,
          lastIp: true,
          firstSeenAt: true,
          lastSeenAt: true,
          trustedAt: true,
        },
      }),
    ]);
    const serializeDates = (items: Array<Record<string, unknown>>) => items.map((item) => Object.fromEntries(Object.entries(item).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value])));
    return {
      exportedAt: new Date().toISOString(),
      profile: user ? serializeDates([user as unknown as Record<string, unknown>])[0] : null,
      articles: serializeDates(articles as unknown as Array<Record<string, unknown>>),
      comments: serializeDates(comments as unknown as Array<Record<string, unknown>>),
      favorites: serializeDates(favorites as unknown as Array<Record<string, unknown>>),
      subscriptions: serializeDates(subscriptions as unknown as Array<Record<string, unknown>>),
      collectionSubscriptions: serializeDates(collections as unknown as Array<Record<string, unknown>>),
      topicSubscriptions: serializeDates(topics as unknown as Array<Record<string, unknown>>),
      points: {
        balance: userId
          ? await this.prisma.user.findUnique({
              where: { id: userId },
              select: { points: true, experience: true },
            })
          : null,
        ledger: serializeDates(ledgers as unknown as Array<Record<string, unknown>>),
      },
      loginRecords: {
        events: serializeDates(loginEvents as unknown as Array<Record<string, unknown>>),
        devices: serializeDates(devices as unknown as Array<Record<string, unknown>>),
      },
    };
  }

  private async runCleanup(): Promise<void> {
    const now = new Date();
    await this.prisma.dataExportJob.updateMany({
      where: { status: DataExportJobStatus.completed, expiresAt: { lte: now } },
      data: { status: DataExportJobStatus.expired, payload: Prisma.JsonNull },
    });
    const due = await this.prisma.user.findMany({
      where: {
        status: UserStatus.deletion_pending,
        deletionScheduledAt: { lte: now },
      },
      take: 20,
      select: { id: true, username: true, nickname: true, email: true },
    });
    for (const user of due) await this.finalizeDeletion(user).catch((error) => this.logger.error(`Account deletion ${user.id} failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  private async finalizeDeletion(user: { id: number; username: string; nickname: string; email: string }): Promise<void> {
    const suffix = `${user.id}-${randomBytes(4).toString("hex")}`;
    await this.prisma.user.updateMany({
      where: { id: user.id, status: UserStatus.deletion_pending },
      data: {
        username: `deleted-${suffix}`.slice(0, 32),
        nickname: "已注销用户",
        email: `deleted-${suffix}@invalid.local`.slice(0, 191),
        passwordHash: randomBytes(48).toString("base64"),
        profileBio: "",
        searchText: "",
        searchPinyin: "",
        avatarStoredName: null,
        avatarOriginalName: null,
        avatarMimeType: null,
        avatarSizeBytes: null,
        isAdministrator: false,
        isSuperAdmin: false,
        status: UserStatus.disabled,
        deletedAt: new Date(),
        deletedOriginalUsername: user.username,
        deletedOriginalNickname: user.nickname,
        deletedOriginalEmail: user.email,
        deletionRequestedAt: null,
        deletionScheduledAt: null,
        authVersion: { increment: 1 },
      },
    });
    await this.recordAudit(user.id, "account_deleted", {
      originalUsername: user.username,
    });
  }

  private async consumeRecoveryCode(id: number, hashes: Prisma.JsonValue | null, code: string): Promise<boolean> {
    if (!Array.isArray(hashes)) return false;
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) return false;
    const hash = this.hash(normalizedCode);
    const remaining = hashes.filter((item): item is string => typeof item === "string" && item !== hash);
    if (remaining.length === hashes.length) return false;
    await this.prisma.userTotpCredential.update({
      where: { userId: id },
      data: { recoveryCodeHashes: remaining as Prisma.InputJsonValue },
    });
    return true;
  }

  private async scheduleDeletion(user: AuthenticatedUser, context: RefreshSessionContext) {
    const requestedAt = new Date();
    const scheduledAt = new Date(requestedAt.getTime() + DELETION_COOLING_OFF_MS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        status: UserStatus.deletion_pending,
        deletionRequestedAt: requestedAt,
        deletionScheduledAt: scheduledAt,
      },
    });
    await this.recordAudit(user.id, "account_deletion_requested", { scheduledAt: scheduledAt.toISOString() }, context);
    return {
      pending: true,
      requestedAt: requestedAt.toISOString(),
      scheduledAt: scheduledAt.toISOString(),
      coolingOffDays: 7,
    };
  }

  private requireSensitiveAction(value: string): SensitiveAction {
    try {
      return parseSensitiveAction(value);
    } catch {
      throw new BadRequestException("不支持的安全操作。");
    }
  }

  private async assertNotDeletionPending(userId: number): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true },
    });
    if (user?.status === UserStatus.deletion_pending) throw new ForbiddenException("账号正在注销冷静期内，请先撤回注销申请。");
  }

  private async recordAudit(userId: number, action: string, metadata?: Prisma.InputJsonValue, context?: RefreshSessionContext): Promise<void> {
    await this.prisma.privacyAuditRecord.create({
      data: {
        userId,
        action,
        metadata,
        ip: context?.ip,
        userAgent: context?.userAgent,
      },
    });
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private generateRecoveryCode(): string {
    return Array.from({ length: RECOVERY_CODE_LENGTH }, () => RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)]).join("");
  }

  private assertManager(actor: AuthenticatedUser): void {
    if (!actor.isSuperAdmin && !actor.isAdministrator) throw new ForbiddenException("需要管理员权限。");
  }
}
