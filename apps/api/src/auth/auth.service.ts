import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException, forwardRef, Inject, Optional } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import { RedisService } from "../redis/redis.service";
import { SiteSettingsService } from "../site-settings/site-settings.service";
import { UsersService } from "../users/users.service";
import { AuthenticatedUser, AuthResponse, AuthSessionSummary, DeviceLoginResponse, LoginResponse, RefreshSessionContext } from "./auth.types";
import { DeviceLoginVerificationDto, LoginDto, TotpLoginVerificationDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { RegisterDto } from "./dto/register.dto";
import { PasswordService } from "./password.service";
import { RefreshTokenService } from "./refresh-token.service";
import { AccountSecurityService } from "../security/account-security.service";
import { SecurityConfigurationService } from "../security/security-configuration.service";
import { TurnstileService } from "../security/turnstile.service";
import { PasswordRecoveryResetDto } from "../security/dto/security.dto";
import { ExternalAuthProvider, LoginSecurityEventType, Prisma } from "../generated/prisma/client";
import { AccountPrivacyService } from "../account-privacy/account-privacy.service";
import { PrismaService } from "../prisma/prisma.service";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture, AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { RenamePasskeyDto, VerifyPasskeyDeletionDto, VerifyPasskeyLoginDto, VerifyPasskeyRegistrationDto } from "./dto/passkey.dto";
import { parseSensitiveAction, SensitiveAction } from "../security/sensitive-action";
import { IntegrationsService } from "../integrations/integrations.service";

interface TotpLoginChallenge {
  userId: number;
  deviceFingerprint: string;
  deviceVerifiedByEmail: boolean;
  attempts: number;
}

type PasskeyChallengeKind = "registration" | "login" | "delete" | "totp-disable" | "sensitive";

interface PasskeyChallenge {
  userId?: number;
  targetPasskeyId?: number;
  action?: SensitiveAction;
  expectedChallenge: string;
  deviceFingerprint: string;
  attempts: number;
}

interface GoogleOAuthState {
  codeVerifier: string;
  deviceFingerprint: string;
  ip: string;
  userAgent: string;
  trustedDeviceToken?: string;
  returnTo: string;
}

interface GoogleProfile {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

@Injectable()
export class AuthService {
  private readonly loginFailureTtlSeconds = 15 * 60;
  private readonly loginFailureLimit = 5;
  private readonly totpLoginChallengeTtlSeconds = 5 * 60;
  private readonly totpLoginAttemptLimit = 5;
  private readonly passkeyChallengeTtlSeconds = 5 * 60;
  private readonly passkeyAttemptLimit = 5;
  private readonly oauthStateTtlSeconds = 10 * 60;
  private readonly oauthResultTtlSeconds = 90;

  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly refreshTokenService: RefreshTokenService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly siteSettingsService: SiteSettingsService,
    private readonly accountSecurity: AccountSecurityService,
    private readonly securityConfiguration: SecurityConfigurationService,
    private readonly turnstile: TurnstileService,
    @Inject(forwardRef(() => AccountPrivacyService))
    private readonly accountPrivacy: AccountPrivacyService,
    @Optional() private readonly integrations?: IntegrationsService,
    @Optional() private readonly prismaService?: PrismaService,
  ) {}

  async register(dto: RegisterDto, context: RefreshSessionContext): Promise<AuthResponse> {
    const registrationPolicy = await this.siteSettingsService.getRegistrationPolicy();
    if (!registrationPolicy.registrationOpen) {
      throw new ForbiddenException("Registration is currently closed.");
    }

    const username = dto.username.trim();
    const nickname = dto.nickname.trim();
    const email = dto.email.trim().toLowerCase();
    const securityConfiguration = await this.securityConfiguration.getConfiguration();
    const registrationEmailVerificationEnabled = securityConfiguration.smtpEnabled && securityConfiguration.registrationEmailVerificationEnabled;

    if ((await this.usersService.findForLogin(username)) || (await this.usersService.findForLogin(email))) {
      throw new ConflictException("Username or email already exists.");
    }

    if (registrationEmailVerificationEnabled) {
      if (!dto.verificationCode) throw new BadRequestException("请输入邮箱验证码。");
      await this.accountSecurity.consumeRegistrationCode(email, dto.verificationCode);
    } else {
      await this.turnstile.verify(dto.turnstileToken, context.ip, securityConfiguration.turnstileRegistrationEnabled);
    }

    const passwordHash = await this.passwordService.hashPassword(dto.password);
    const user = await this.usersService.createUser({
      username,
      nickname,
      email,
      passwordHash,
      roleCode: registrationPolicy.defaultRoleCode,
      emailVerifiedAt: registrationEmailVerificationEnabled ? new Date() : null,
    });

    if (registrationEmailVerificationEnabled && context.trustedDeviceToken) {
      await this.accountSecurity.trustCurrentDevice(user.id, context);
    }
    await this.accountSecurity.recordRegistrationLogin(user, context);
    void this.integrations?.emit("user.registered", {
      userId: user.id,
      username: user.username,
      nickname: user.nickname,
    }, `user:${user.id}`).catch(() => undefined);
    return this.createAuthResponse(user, context);
  }

  async login(dto: LoginDto, context: RefreshSessionContext): Promise<LoginResponse> {
    const account = dto.account.trim();
    const failureKey = this.loginFailureKey(account, context.ip);
    const failures = Number((await this.redis.get(failureKey)) ?? "0");
    const securityConfiguration = await this.securityConfiguration.getConfiguration();
    if (securityConfiguration.turnstileLoginEnabled && failures >= securityConfiguration.loginFailureTurnstileThreshold) {
      await this.turnstile.verify(dto.turnstileToken, context.ip, true);
    }
    await this.assertNotLocked(failureKey);

    const user = await this.usersService.findForLogin(account);
    if (!user) {
      await this.recordLoginFailure(failureKey);
    }

    if (user?.status !== "active") {
      throw new ForbiddenException("User is disabled.");
    }

    const passwordMatches = await this.passwordService.verifyPassword(dto.password, user.passwordHash);
    if (!passwordMatches) {
      await this.recordLoginFailure(failureKey, user.id, context);
    }

    await this.redis.del(failureKey);
    if (securityConfiguration.smtpEnabled && securityConfiguration.untrustedDeviceEmailVerificationEnabled && !(await this.accountSecurity.isTrustedDevice(user.id, context))) {
      return this.accountSecurity.requestDeviceLoginVerification(user, context);
    }
    if ((await this.accountPrivacy.verifyTotpForLogin(user.id)) === "required") {
      return this.requestTotpLoginVerification(user.id, context, false);
    }
    return this.completeLogin(user.id, context, false);
  }

  async beginPasskeyRegistration(
    user: AuthenticatedUser,
    context: RefreshSessionContext,
    verificationToken: string,
  ): Promise<{
    options: PublicKeyCredentialCreationOptionsJSON;
    challengeToken: string;
    expiresAt: string;
  }> {
    await this.accountSecurity.consumeSensitiveActionGrant(user.id, "passkey_registration", verificationToken, context);
    const credentials = await this.prismaService!.webAuthnCredential.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
      orderBy: { createdAt: "asc" },
    });
    const options = await generateRegistrationOptions({
      rpName: this.passkeyRpName(),
      rpID: this.passkeyRpId(),
      userName: user.username,
      userID: new Uint8Array(Buffer.from(String(user.id))),
      userDisplayName: user.nickname || user.username,
      attestationType: "none",
      timeout: 60_000,
      excludeCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: this.passkeyTransports(credential.transports),
      })),
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
    });
    const challengeToken = randomBytes(32).toString("base64url");
    await this.redis.set(
      this.passkeyChallengeKey("registration", challengeToken),
      JSON.stringify({
        userId: user.id,
        expectedChallenge: options.challenge,
        deviceFingerprint: this.loginDeviceFingerprint(context),
        attempts: 0,
      } satisfies PasskeyChallenge),
      this.passkeyChallengeTtlSeconds,
    );
    return {
      options,
      challengeToken,
      expiresAt: new Date(
        Date.now() + this.passkeyChallengeTtlSeconds * 1000,
      ).toISOString(),
    };
  }

  async finishPasskeyRegistration(
    user: AuthenticatedUser,
    dto: VerifyPasskeyRegistrationDto,
    context: RefreshSessionContext,
  ) {
    const challenge = await this.requirePasskeyChallenge(
      "registration",
      dto.challengeToken,
      context,
      user.id,
    );
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: dto.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge.expectedChallenge,
        expectedOrigin: this.passkeyExpectedOrigins(),
        expectedRPID: this.passkeyRpId(),
        requireUserVerification: true,
      });
    } catch {
      await this.recordPasskeyFailure(
        "registration",
        dto.challengeToken,
        challenge,
      );
      throw new BadRequestException(
        "通行密钥注册失败，请重试。\nPasskey registration failed. Please try again.",
      );
    }
    if (!verified.verified || !verified.registrationInfo) {
      await this.recordPasskeyFailure(
        "registration",
        dto.challengeToken,
        challenge,
      );
      throw new BadRequestException(
        "通行密钥注册失败，请重试。\nPasskey registration failed. Please try again.",
      );
    }
    const credential = verified.registrationInfo.credential;
    try {
      await this.prismaService!.webAuthnCredential.create({
        data: {
          userId: user.id,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          counter: credential.counter,
          transports: credential.transports ?? undefined,
          name: this.normalizePasskeyName(dto.name),
        },
      });
    } catch (error) {
      if (this.isPrismaUniqueError(error)) {
        throw new ConflictException(
          "该通行密钥已经绑定。\nThis passkey is already registered.",
        );
      }
      throw error;
    }
    await this.redis.del(
      this.passkeyChallengeKey("registration", dto.challengeToken),
    );
    return { success: true as const };
  }

  async listPasskeys(user: AuthenticatedUser) {
    const credentials = await this.prismaService!.webAuthnCredential.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, createdAt: true, lastUsedAt: true },
    });
    return credentials.map((credential) => ({
      id: credential.id,
      name: credential.name,
      createdAt: credential.createdAt.toISOString(),
      lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    }));
  }

  async renamePasskey(
    user: AuthenticatedUser,
    id: number,
    dto: RenamePasskeyDto,
  ) {
    const credential = await this.prismaService!.webAuthnCredential.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!credential)
      throw new BadRequestException("通行密钥不存在。\nPasskey not found.");
    await this.prismaService!.webAuthnCredential.update({
      where: { id },
      data: { name: this.normalizePasskeyName(dto.name) },
    });
    return { success: true as const };
  }

  async beginPasskeyDeletion(
    user: AuthenticatedUser,
    targetId: number,
    context: RefreshSessionContext,
  ): Promise<{
    options: PublicKeyCredentialRequestOptionsJSON;
    challengeToken: string;
    expiresAt: string;
  }> {
    await this.requirePasskey(user.id, targetId);
    const credentials = await this.prismaService!.webAuthnCredential.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const options = await generateAuthenticationOptions({
      rpID: this.passkeyRpId(),
      userVerification: "required",
      timeout: 60_000,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: this.passkeyTransports(credential.transports),
      })),
    });
    const challengeToken = randomBytes(32).toString("base64url");
    await this.redis.set(
      this.passkeyChallengeKey("delete", challengeToken),
      JSON.stringify({
        userId: user.id,
        targetPasskeyId: targetId,
        expectedChallenge: options.challenge,
        deviceFingerprint: this.loginDeviceFingerprint(context),
        attempts: 0,
      } satisfies PasskeyChallenge),
      this.passkeyChallengeTtlSeconds,
    );
    return {
      options,
      challengeToken,
      expiresAt: new Date(Date.now() + this.passkeyChallengeTtlSeconds * 1000).toISOString(),
    };
  }

  async finishPasskeyDeletion(
    user: AuthenticatedUser,
    targetId: number,
    dto: VerifyPasskeyDeletionDto,
    context: RefreshSessionContext,
  ) {
    const challenge = await this.requirePasskeyChallenge("delete", dto.challengeToken, context, user.id);
    if (challenge.targetPasskeyId !== targetId) {
      throw new BadRequestException("通行密钥信息不匹配，请重试。\nThis passkey request does not match this session.");
    }
    const credentialId = typeof (dto.response as { id?: unknown }).id === "string" ? (dto.response as { id: string }).id : "";
    if (!credentialId) {
      await this.recordPasskeyFailure("delete", dto.challengeToken, challenge);
      throw new BadRequestException("通行密钥验证失败，请重试。\nPasskey verification failed. Please try again.");
    }
    const stored = await this.prismaService!.webAuthnCredential.findFirst({
      where: { credentialId, userId: user.id },
    });
    if (!stored) {
      await this.recordPasskeyFailure("delete", dto.challengeToken, challenge);
      throw new UnauthorizedException("通行密钥验证失败。\nPasskey verification failed.");
    }
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response: dto.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.expectedChallenge,
        expectedOrigin: this.passkeyExpectedOrigins(),
        expectedRPID: this.passkeyRpId(),
        requireUserVerification: true,
        credential: {
          id: stored.credentialId,
          publicKey: Buffer.from(stored.publicKey, "base64url"),
          counter: stored.counter,
          transports: this.passkeyTransports(stored.transports),
        },
      });
    } catch {
      await this.recordPasskeyFailure("delete", dto.challengeToken, challenge);
      throw new UnauthorizedException("通行密钥验证失败，请重试。\nPasskey verification failed. Please try again.");
    }
    if (!verified.verified) {
      await this.recordPasskeyFailure("delete", dto.challengeToken, challenge);
      throw new UnauthorizedException("通行密钥验证失败，请重试。\nPasskey verification failed.");
    }
    await this.prismaService!.$transaction(async (transaction) => {
      await transaction.webAuthnCredential.update({
        where: { id: stored.id },
        data: {
          counter: Math.max(stored.counter, verified.authenticationInfo.newCounter),
          lastUsedAt: new Date(),
        },
      });
      const deleted = await transaction.webAuthnCredential.deleteMany({
        where: { id: targetId, userId: user.id },
      });
      if (!deleted.count) throw new BadRequestException("通行密钥不存在。\nPasskey not found.");
    });
    await this.redis.del(this.passkeyChallengeKey("delete", dto.challengeToken));
    return { success: true as const };
  }

  async deletePasskeyWithPassword(user: AuthenticatedUser, targetId: number, currentPassword: string) {
    await this.requirePasskey(user.id, targetId);
    const storedUser = await this.usersService.findForLogin(user.username);
    if (!storedUser || !(await this.passwordService.verifyPassword(currentPassword, storedUser.passwordHash))) {
      throw new UnauthorizedException("当前密码不正确。\nThe current password is incorrect.");
    }
    return this.deletePasskeyAfterVerification(user.id, targetId);
  }

  async deletePasskeyWithTotp(user: AuthenticatedUser, targetId: number, code: string) {
    await this.requirePasskey(user.id, targetId);
    if (!(await this.accountPrivacy.verifyCurrentTotp(user.id, code))) {
      throw new UnauthorizedException("双因素验证码不正确。\nThe authenticator code is incorrect.");
    }
    return this.deletePasskeyAfterVerification(user.id, targetId);
  }

  async requestPasskeyDeletionEmail(user: AuthenticatedUser, targetId: number, context: RefreshSessionContext) {
    await this.requirePasskey(user.id, targetId);
    return this.accountSecurity.requestPasskeyDeletionVerification(user, targetId, context);
  }

  async deletePasskeyWithEmail(
    user: AuthenticatedUser,
    targetId: number,
    challengeToken: string,
    code: string,
  ) {
    await this.requirePasskey(user.id, targetId);
    await this.accountSecurity.consumePasskeyDeletionVerification(user, targetId, challengeToken, code);
    return this.deletePasskeyAfterVerification(user.id, targetId);
  }

  async beginTotpDisablePasskey(user: AuthenticatedUser, context: RefreshSessionContext): Promise<{
    options: PublicKeyCredentialRequestOptionsJSON;
    challengeToken: string;
    expiresAt: string;
  }> {
    const overview = await this.accountPrivacy.getOverview(user);
    if (!overview.totp.enabled) throw new BadRequestException("当前未启用双因素认证。\nTwo-factor authentication is not enabled.");
    const credentials = await this.prismaService!.webAuthnCredential.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const options = await generateAuthenticationOptions({
      rpID: this.passkeyRpId(),
      userVerification: "required",
      timeout: 60_000,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: this.passkeyTransports(credential.transports),
      })),
    });
    const challengeToken = randomBytes(32).toString("base64url");
    await this.redis.set(
      this.passkeyChallengeKey("totp-disable", challengeToken),
      JSON.stringify({
        userId: user.id,
        expectedChallenge: options.challenge,
        deviceFingerprint: this.loginDeviceFingerprint(context),
        attempts: 0,
      } satisfies PasskeyChallenge),
      this.passkeyChallengeTtlSeconds,
    );
    return {
      options,
      challengeToken,
      expiresAt: new Date(Date.now() + this.passkeyChallengeTtlSeconds * 1000).toISOString(),
    };
  }

  async finishTotpDisablePasskey(
    user: AuthenticatedUser,
    dto: VerifyPasskeyDeletionDto,
    context: RefreshSessionContext,
  ) {
    const challenge = await this.requirePasskeyChallenge("totp-disable", dto.challengeToken, context, user.id);
    const credentialId = typeof (dto.response as { id?: unknown }).id === "string" ? (dto.response as { id: string }).id : "";
    if (!credentialId) {
      await this.recordPasskeyFailure("totp-disable", dto.challengeToken, challenge);
      throw new BadRequestException("通行密钥验证失败，请重试。\nPasskey verification failed. Please try again.");
    }
    const stored = await this.prismaService!.webAuthnCredential.findFirst({
      where: { credentialId, userId: user.id },
    });
    if (!stored) {
      await this.recordPasskeyFailure("totp-disable", dto.challengeToken, challenge);
      throw new UnauthorizedException("通行密钥验证失败。\nPasskey verification failed.");
    }
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response: dto.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.expectedChallenge,
        expectedOrigin: this.passkeyExpectedOrigins(),
        expectedRPID: this.passkeyRpId(),
        requireUserVerification: true,
        credential: {
          id: stored.credentialId,
          publicKey: Buffer.from(stored.publicKey, "base64url"),
          counter: stored.counter,
          transports: this.passkeyTransports(stored.transports),
        },
      });
    } catch {
      await this.recordPasskeyFailure("totp-disable", dto.challengeToken, challenge);
      throw new UnauthorizedException("通行密钥验证失败，请重试。\nPasskey verification failed. Please try again.");
    }
    if (!verified.verified) {
      await this.recordPasskeyFailure("totp-disable", dto.challengeToken, challenge);
      throw new UnauthorizedException("通行密钥验证失败。\nPasskey verification failed.");
    }
    await this.prismaService!.webAuthnCredential.update({
      where: { id: stored.id },
      data: {
        counter: Math.max(stored.counter, verified.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
    await this.redis.del(this.passkeyChallengeKey("totp-disable", dto.challengeToken));
    return this.accountPrivacy.disableTotpAfterVerification(user, context);
  }

  async beginSensitiveActionPasskey(user: AuthenticatedUser, action: string, context: RefreshSessionContext): Promise<{
    options: PublicKeyCredentialRequestOptionsJSON;
    challengeToken: string;
    expiresAt: string;
  }> {
    const normalizedAction = this.requireSensitiveAction(action);
    const credentials = await this.prismaService!.webAuthnCredential.findMany({
      where: { userId: user.id },
      select: { credentialId: true, transports: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!credentials.length) throw new BadRequestException("当前账号没有可用的通行密钥。\nNo passkey is available for this account.");
    const options = await generateAuthenticationOptions({
      rpID: this.passkeyRpId(),
      userVerification: "required",
      timeout: 60_000,
      allowCredentials: credentials.map((credential) => ({
        id: credential.credentialId,
        transports: this.passkeyTransports(credential.transports),
      })),
    });
    const challengeToken = randomBytes(32).toString("base64url");
    await this.redis.set(
      this.passkeyChallengeKey("sensitive", challengeToken),
      JSON.stringify({
        userId: user.id,
        action: normalizedAction,
        expectedChallenge: options.challenge,
        deviceFingerprint: this.loginDeviceFingerprint(context),
        attempts: 0,
      } satisfies PasskeyChallenge),
      this.passkeyChallengeTtlSeconds,
    );
    return {
      options,
      challengeToken,
      expiresAt: new Date(Date.now() + this.passkeyChallengeTtlSeconds * 1000).toISOString(),
    };
  }

  async finishSensitiveActionPasskey(user: AuthenticatedUser, action: string, dto: VerifyPasskeyDeletionDto, context: RefreshSessionContext) {
    const normalizedAction = this.requireSensitiveAction(action);
    const challenge = await this.requirePasskeyChallenge("sensitive", dto.challengeToken, context, user.id);
    if (challenge.action !== normalizedAction) {
      throw new BadRequestException("安全验证信息不匹配，请重试。\nThe security verification does not match this action.");
    }
    const credentialId = typeof (dto.response as { id?: unknown }).id === "string" ? (dto.response as { id: string }).id : "";
    if (!credentialId) {
      await this.recordPasskeyFailure("sensitive", dto.challengeToken, challenge);
      throw new BadRequestException("通行密钥验证失败，请重试。\nPasskey verification failed. Please try again.");
    }
    const stored = await this.prismaService!.webAuthnCredential.findFirst({ where: { credentialId, userId: user.id } });
    if (!stored) {
      await this.recordPasskeyFailure("sensitive", dto.challengeToken, challenge);
      throw new UnauthorizedException("通行密钥验证失败。\nPasskey verification failed.");
    }
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response: dto.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.expectedChallenge,
        expectedOrigin: this.passkeyExpectedOrigins(),
        expectedRPID: this.passkeyRpId(),
        requireUserVerification: true,
        credential: {
          id: stored.credentialId,
          publicKey: Buffer.from(stored.publicKey, "base64url"),
          counter: stored.counter,
          transports: this.passkeyTransports(stored.transports),
        },
      });
    } catch {
      await this.recordPasskeyFailure("sensitive", dto.challengeToken, challenge);
      throw new UnauthorizedException("通行密钥验证失败，请重试。\nPasskey verification failed. Please try again.");
    }
    if (!verified.verified) {
      await this.recordPasskeyFailure("sensitive", dto.challengeToken, challenge);
      throw new UnauthorizedException("通行密钥验证失败。\nPasskey verification failed.");
    }
    await this.prismaService!.webAuthnCredential.update({
      where: { id: stored.id },
      data: {
        counter: Math.max(stored.counter, verified.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });
    await this.redis.del(this.passkeyChallengeKey("sensitive", dto.challengeToken));
    return {
      success: true as const,
      verificationToken: await this.accountSecurity.issueSensitiveActionGrant(user.id, normalizedAction, context),
    };
  }

  private async requirePasskey(userId: number, id: number) {
    const credential = await this.prismaService!.webAuthnCredential.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!credential) throw new BadRequestException("通行密钥不存在。\nPasskey not found.");
  }

  private async deletePasskeyAfterVerification(userId: number, id: number) {
    const deleted = await this.prismaService!.webAuthnCredential.deleteMany({
      where: { id, userId },
    });
    if (!deleted.count) throw new BadRequestException("通行密钥不存在。\nPasskey not found.");
    return { success: true as const };
  }

  async beginPasskeyLogin(context: RefreshSessionContext): Promise<{
    options: PublicKeyCredentialRequestOptionsJSON;
    challengeToken: string;
    expiresAt: string;
  }> {
    const options = await generateAuthenticationOptions({
      rpID: this.passkeyRpId(),
      userVerification: "required",
      timeout: 60_000,
    });
    const challengeToken = randomBytes(32).toString("base64url");
    await this.redis.set(
      this.passkeyChallengeKey("login", challengeToken),
      JSON.stringify({
        expectedChallenge: options.challenge,
        deviceFingerprint: this.loginDeviceFingerprint(context),
        attempts: 0,
      } satisfies PasskeyChallenge),
      this.passkeyChallengeTtlSeconds,
    );
    return {
      options,
      challengeToken,
      expiresAt: new Date(
        Date.now() + this.passkeyChallengeTtlSeconds * 1000,
      ).toISOString(),
    };
  }

  async finishPasskeyLogin(
    dto: VerifyPasskeyLoginDto,
    context: RefreshSessionContext,
  ): Promise<LoginResponse> {
    const challenge = await this.requirePasskeyChallenge(
      "login",
      dto.challengeToken,
      context,
    );
    const credentialId =
      typeof (dto.response as { id?: unknown }).id === "string"
        ? (dto.response as { id: string }).id
        : "";
    if (!credentialId) {
      await this.recordPasskeyFailure("login", dto.challengeToken, challenge);
      throw new BadRequestException(
        "通行密钥验证失败，请重试。\nPasskey verification failed. Please try again.",
      );
    }
    const stored = await this.prismaService!.webAuthnCredential.findUnique({
      where: { credentialId },
      include: { user: { select: { id: true, status: true } } },
    });
    if (!stored || stored.user.status !== "active") {
      await this.recordPasskeyFailure("login", dto.challengeToken, challenge);
      throw new UnauthorizedException(
        "通行密钥验证失败。\nPasskey verification failed.",
      );
    }
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response: dto.response as unknown as AuthenticationResponseJSON,
        expectedChallenge: challenge.expectedChallenge,
        expectedOrigin: this.passkeyExpectedOrigins(),
        expectedRPID: this.passkeyRpId(),
        requireUserVerification: true,
        credential: {
          id: stored.credentialId,
          publicKey: Buffer.from(stored.publicKey, "base64url"),
          counter: stored.counter,
          transports: this.passkeyTransports(stored.transports),
        },
      });
    } catch {
      await this.recordPasskeyFailure("login", dto.challengeToken, challenge);
      throw new UnauthorizedException(
        "通行密钥验证失败，请重试。\nPasskey verification failed. Please try again.",
      );
    }
    if (!verified.verified) {
      await this.recordPasskeyFailure("login", dto.challengeToken, challenge);
      throw new UnauthorizedException(
        "通行密钥验证失败，请重试。\nPasskey verification failed. Please try again.",
      );
    }
    await this.prismaService!.webAuthnCredential.update({
      where: { id: stored.id },
      data: {
        counter: Math.max(
          stored.counter,
          verified.authenticationInfo.newCounter,
        ),
        lastUsedAt: new Date(),
      },
    });
    await this.redis.del(this.passkeyChallengeKey("login", dto.challengeToken));
    return this.completePasskeyLogin(stored.user.id, context);
  }

  getExternalAuthProviders() {
    return { google: { enabled: Boolean(this.googleClientId() && this.googleClientSecret()), provider: "google" as const } };
  }

  async startGoogleLogin(context: RefreshSessionContext, returnTo?: string): Promise<string> {
    if (!this.getExternalAuthProviders().google.enabled) throw new BadRequestException("Google 登录尚未配置。\nGoogle sign-in is not configured.");
    const state = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const stateData: GoogleOAuthState = { codeVerifier, deviceFingerprint: this.loginDeviceFingerprint(context), ip: context.ip, userAgent: context.userAgent, trustedDeviceToken: context.trustedDeviceToken, returnTo: this.safeReturnTo(returnTo) };
    await this.redis.set(this.oauthStateKey(state), JSON.stringify(stateData), this.oauthStateTtlSeconds);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.googleClientId());
    url.searchParams.set("redirect_uri", this.googleRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  }

  async finishGoogleLogin(code: string, state: string): Promise<{ redirectToken: string; returnTo: string }> {
    const raw = await this.redis.getdel(this.oauthStateKey(state));
    if (!raw) throw new BadRequestException("Google 登录请求已失效，请重新开始。\nThe Google sign-in request expired.");
    let stateData: GoogleOAuthState;
    try { stateData = JSON.parse(raw) as GoogleOAuthState; } catch { throw new BadRequestException("Google 登录请求无效。\nInvalid Google sign-in request."); }
    const tokens = await this.exchangeGoogleCode(code, stateData.codeVerifier);
    const profile = await this.fetchGoogleProfile(tokens.access_token);
    const subject = profile.sub?.trim(); const email = profile.email?.trim().toLowerCase();
    if (!subject || !email) throw new BadRequestException("Google 未返回可用的账号信息。\nGoogle did not return a usable identity.");
    const context: RefreshSessionContext = { ip: stateData.ip, userAgent: stateData.userAgent, trustedDeviceToken: stateData.trustedDeviceToken };
    const identity = await this.prismaService!.externalAuthIdentity.findUnique({ where: { provider_subject: { provider: ExternalAuthProvider.google, subject } }, select: { userId: true } });
    let result: LoginResponse;
    if (identity) {
      await this.prismaService!.externalAuthIdentity.update({ where: { provider_subject: { provider: ExternalAuthProvider.google, subject } }, data: { email, emailVerified: profile.email_verified === true, profile: this.oauthProfileJson(profile), lastLoginAt: new Date() } });
      result = await this.completeExternalLogin(identity.userId, context);
    } else {
      const existing = await this.prismaService!.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        const pendingToken = randomBytes(32).toString("base64url");
        await this.redis.set(`oauth_pending:${this.hashToken(pendingToken)}`, JSON.stringify({ provider: "google", subject, email, profile: this.oauthProfileJson(profile) }), this.oauthStateTtlSeconds);
        return { redirectToken: await this.storeOAuthResult({ oauthLinkRequired: true as const, pendingToken, email }), returnTo: stateData.returnTo };
      }
      const username = await this.generateGoogleUsername(email.split("@")[0]);
      const nickname = this.normalizeGoogleNickname(profile.name || email.split("@")[0]);
      const created = await this.usersService.createUser({ username, nickname, email, passwordHash: await this.passwordService.hashPassword(randomBytes(32).toString("base64url")), emailVerifiedAt: profile.email_verified === true ? new Date() : null });
      await this.prismaService!.externalAuthIdentity.create({ data: { userId: created.id, provider: ExternalAuthProvider.google, subject, email, emailVerified: profile.email_verified === true, profile: this.oauthProfileJson(profile), lastLoginAt: new Date() } });
      result = await this.completeLogin(created.id, context, false);
    }
    return { redirectToken: await this.storeOAuthResult(result), returnTo: stateData.returnTo };
  }

  async consumeOAuthResult(token: string): Promise<LoginResponse | { oauthLinkRequired: true; pendingToken: string; email: string }> {
    const raw = await this.redis.getdel(`oauth_result:${this.hashToken(token)}`);
    if (!raw) throw new BadRequestException("登录结果已失效，请重新开始。\nThe sign-in result expired.");
    return JSON.parse(raw) as LoginResponse | { oauthLinkRequired: true; pendingToken: string; email: string };
  }

  async bindPendingGoogleIdentity(user: AuthenticatedUser, pendingToken: string, password: string) {
    const raw = await this.redis.getdel(`oauth_pending:${this.hashToken(pendingToken)}`);
    if (!raw) throw new BadRequestException("绑定请求已失效，请重新开始。\nThe linking request expired.");
    const pending = JSON.parse(raw) as { provider: "google"; subject: string; email: string; profile: Prisma.JsonObject };
    if (pending.email !== user.email.toLowerCase()) throw new ForbiddenException("Google 邮箱与当前账号不一致。\nGoogle email does not match this account.");
    const account = await this.usersService.findForLogin(user.username);
    if (!account || !(await this.passwordService.verifyPassword(password, account.passwordHash))) throw new UnauthorizedException("当前密码不正确。\nThe current password is incorrect.");
    await this.prismaService!.externalAuthIdentity.create({ data: { userId: user.id, provider: ExternalAuthProvider.google, subject: pending.subject, email: pending.email, emailVerified: true, profile: pending.profile } });
    return { success: true as const };
  }

  private async completeExternalLogin(userId: number, context: RefreshSessionContext): Promise<LoginResponse> {
    const user = await this.usersService.findActiveById(userId);
    if (await this.accountSecurity.isTrustedDevice(userId, context)) return this.completeLogin(userId, context, false);
    const config = await this.securityConfiguration.getConfiguration();
    if (config.smtpEnabled && config.untrustedDeviceEmailVerificationEnabled) return this.accountSecurity.requestDeviceLoginVerification(user, context);
    if ((await this.accountPrivacy.verifyTotpForLogin(userId)) === "required") return this.requestTotpLoginVerification(userId, context, false);
    return this.completeLogin(userId, context, false);
  }

  private async exchangeGoogleCode(code: string, codeVerifier: string): Promise<{ access_token: string }> {
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: this.googleClientId(), client_secret: this.googleClientSecret(), redirect_uri: this.googleRedirectUri(), grant_type: "authorization_code", code_verifier: codeVerifier }), signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new BadRequestException("Google 授权交换失败，请重试。\nGoogle authorization exchange failed.");
    const payload = await response.json() as { access_token?: string };
    if (!payload.access_token) throw new BadRequestException("Google 未返回访问凭据。\nGoogle did not return an access token.");
    return { access_token: payload.access_token };
  }

  private async fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new BadRequestException("Google 账号信息读取失败，请重试。\nCould not read the Google profile.");
    return response.json() as Promise<GoogleProfile>;
  }

  private async storeOAuthResult(value: LoginResponse | { oauthLinkRequired: true; pendingToken: string; email: string }): Promise<string> { const token = randomBytes(32).toString("base64url"); await this.redis.set(`oauth_result:${this.hashToken(token)}`, JSON.stringify(value), this.oauthResultTtlSeconds); return token; }
  private oauthStateKey(state: string) { return `oauth_google_state:${this.hashToken(state)}`; }
  private hashToken(value: string) { return createHash("sha256").update(value).digest("hex"); }
  private googleClientId() { return process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || ""; }
  private googleClientSecret() { return process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || ""; }
  private googleRedirectUri() { return process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || `${(process.env.WEB_ORIGIN || "http://localhost:3000").replace(/\/$/, "")}/api/auth/google/callback`; }
  private safeReturnTo(value?: string) { return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard"; }
  private oauthProfileJson(profile: GoogleProfile): Prisma.InputJsonObject { return { sub: profile.sub || "", name: profile.name || "", picture: profile.picture || "", emailVerified: profile.email_verified === true }; }
  private normalizeGoogleNickname(value: string) { return Array.from(value.trim() || "Google 用户").slice(0, 32).join(""); }
  private async generateGoogleUsername(localPart: string): Promise<string> { const base = (localPart.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "google_user").slice(0, 24); for (let index = 0; index < 100; index += 1) { const suffix = index ? `_${index + 1}` : ""; const candidate = `${base.slice(0, 32 - suffix.length)}${suffix}`; if (!(await this.usersService.findForLogin(candidate))) return candidate; } return `google_${randomBytes(5).toString("hex")}`; }

  private async completePasskeyLogin(
    userId: number,
    context: RefreshSessionContext,
  ): Promise<AuthResponse> {
    // A passkey already completed required user verification on the authenticator.
    // Do not apply the password-login email or TOTP challenge a second time.
    return this.completeLogin(userId, context, false);
  }

  private async requirePasskeyChallenge(
    kind: PasskeyChallengeKind,
    token: string,
    context: RefreshSessionContext,
    userId?: number,
  ): Promise<PasskeyChallenge> {
    const raw = await this.redis.get(this.passkeyChallengeKey(kind, token));
    if (!raw)
      throw new BadRequestException(
        "通行密钥操作已失效，请重试。\nThis passkey operation has expired. Please try again.",
      );
    let challenge: PasskeyChallenge;
    try {
      challenge = JSON.parse(raw) as PasskeyChallenge;
    } catch {
      await this.redis.del(this.passkeyChallengeKey(kind, token));
      throw new BadRequestException(
        "通行密钥操作已失效，请重试。\nThis passkey operation has expired. Please try again.",
      );
    }
    if (
      challenge.deviceFingerprint !== this.loginDeviceFingerprint(context) ||
      (userId !== undefined && challenge.userId !== userId)
    ) {
      throw new BadRequestException(
        "通行密钥信息不匹配，请重试。\nThis passkey request does not match this session.",
      );
    }
    return challenge;
  }

  private async recordPasskeyFailure(
    kind: PasskeyChallengeKind,
    token: string,
    challenge: PasskeyChallenge,
  ): Promise<void> {
    const attempts = challenge.attempts + 1;
    const key = this.passkeyChallengeKey(kind, token);
    if (attempts >= this.passkeyAttemptLimit) {
      await this.redis.del(key);
      return;
    }
    await this.redis.set(
      key,
      JSON.stringify({ ...challenge, attempts }),
      this.passkeyChallengeTtlSeconds,
    );
  }

  private passkeyChallengeKey(
    kind: PasskeyChallengeKind,
    token: string,
  ): string {
    return `passkey_${kind}_challenge:${createHash("sha256").update(token).digest("hex")}`;
  }

  private passkeyRpName(): string {
    return process.env.PASSKEY_RP_NAME?.trim() || "HLOVET";
  }

  private passkeyRpId(): string {
    const configured = process.env.PASSKEY_RP_ID?.trim();
    if (configured) return configured.replace(/^https?:\/\//, "").split("/")[0];
    try {
      return new URL(
        (process.env.WEB_ORIGIN ?? "http://localhost:3000")
          .split(",")[0]
          .trim(),
      ).hostname;
    } catch {
      const siteDomain = process.env.SITE_DOMAIN?.trim();
      if (siteDomain)
        return siteDomain.replace(/^https?:\/\//, "").split("/")[0];
      return "localhost";
    }
  }

  private passkeyExpectedOrigins(): string[] {
    const configured = [process.env.PASSKEY_ORIGIN, process.env.WEB_ORIGIN]
      .flatMap((value) => (value ?? "").split(","))
      .map((value) => value.trim().replace(/\/$/, ""))
      .filter(Boolean);
    const origins = new Set(configured);
    const rpId = this.passkeyRpId();
    origins.add(`https://${rpId}`);
    if (rpId === "localhost") origins.add("http://localhost:3000");
    return [...origins];
  }

  private passkeyTransports(
    value: unknown,
  ): AuthenticatorTransportFuture[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const allowed = new Set<AuthenticatorTransportFuture>([
      "ble",
      "hybrid",
      "internal",
      "nfc",
      "usb",
      "smart-card",
    ]);
    return value.filter(
      (item): item is AuthenticatorTransportFuture =>
        typeof item === "string" &&
        allowed.has(item as AuthenticatorTransportFuture),
    );
  }

  private normalizePasskeyName(value: string | undefined): string {
    const name = value?.trim() || "通行密钥";
    return Array.from(name).slice(0, 120).join("");
  }

  private requireSensitiveAction(value: string): SensitiveAction {
    try {
      return parseSensitiveAction(value);
    } catch {
      throw new BadRequestException("不支持的安全操作。\nUnsupported sensitive action.");
    }
  }

  private isPrismaUniqueError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: unknown }).code === "P2002"
    );
  }

  async verifyDeviceLogin(dto: DeviceLoginVerificationDto, context: RefreshSessionContext): Promise<DeviceLoginResponse> {
    const verified = await this.accountSecurity.consumeDeviceLoginVerification(dto.challengeToken, dto.code, context);
    if ((await this.accountPrivacy.verifyTotpForLogin(verified.userId)) === "required") {
      return this.requestTotpLoginVerification(verified.userId, context, true);
    }
    return this.completeLogin(verified.userId, context, true);
  }

  async verifyTotpLogin(dto: TotpLoginVerificationDto, context: RefreshSessionContext): Promise<AuthResponse> {
    const challenge = await this.requireTotpLoginChallenge(dto.challengeToken, context);
    const valid = await this.accountPrivacy.verifyTotpForLogin(challenge.userId, dto.code);
    if (valid !== true) {
      await this.recordTotpLoginFailure(dto.challengeToken, challenge);
      throw new UnauthorizedException("双因素验证码无效。");
    }

    await this.redis.del(this.totpLoginChallengeKey(dto.challengeToken));
    return this.completeLogin(challenge.userId, context, challenge.deviceVerifiedByEmail);
  }

  async refresh(refreshToken: string, context: RefreshSessionContext): Promise<AuthResponse> {
    const rotated = await this.refreshTokenService.rotate(refreshToken, context);
    return {
      user: rotated.user,
      accessToken: await this.signAccessToken(rotated.user, rotated.tokenId),
      refreshToken: rotated.refreshToken,
    };
  }

  async logout(refreshToken: string): Promise<{ success: true }> {
    await this.refreshTokenService.revoke(refreshToken);
    return { success: true };
  }

  async listSessions(userId: number, sessionId: string | null, context: RefreshSessionContext): Promise<{ sessions: AuthSessionSummary[] }> {
    return {
      sessions: await this.refreshTokenService.listSessions(userId, sessionId, context),
    };
  }

  async revokeOtherSessions(userId: number, sessionId: string | null): Promise<{ revokedSessions: number }> {
    return {
      revokedSessions: await this.refreshTokenService.revokeOtherSessions(userId, sessionId),
    };
  }

  async revokeAllSessions(userId: number): Promise<{ revokedSessions: number }> {
    return {
      revokedSessions: await this.refreshTokenService.revokeAllSessions(userId),
    };
  }

  async revokeSession(userId: number, currentSessionId: string | null, targetSessionId: string): Promise<{ success: true; current: boolean }> {
    return this.refreshTokenService.revokeSession(userId, currentSessionId, targetSessionId);
  }

  me(user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  async changePassword(user: AuthenticatedUser, sessionId: string | null, dto: ChangePasswordDto, context: RefreshSessionContext): Promise<{ success: true; revokedSessions: number }> {
    const storedUser = await this.usersService.findForLogin(user.username);
    if (!storedUser) {
      throw new BadRequestException("Current password is incorrect.");
    }

    const currentPasswordMatches = await this.passwordService.verifyPassword(dto.currentPassword, storedUser.passwordHash);
    if (!currentPasswordMatches) {
      throw new BadRequestException("Current password is incorrect.");
    }

    const passwordIsUnchanged = await this.passwordService.verifyPassword(dto.newPassword, storedUser.passwordHash);
    if (passwordIsUnchanged) {
      throw new BadRequestException("New password must be different.");
    }

    await this.usersService.updateOwnPassword(user.id, dto.newPassword);
    const revokedSessions = await this.refreshTokenService.revokeOtherSessions(user.id, sessionId);
    await this.accountSecurity.recordPasswordEvent(user.id, LoginSecurityEventType.password_changed, context);
    return { success: true, revokedSessions };
  }

  async resetPassword(dto: PasswordRecoveryResetDto, context: RefreshSessionContext): Promise<{ success: true; revokedSessions: number }> {
    const securityConfiguration = await this.securityConfiguration.getConfiguration();
    if (!securityConfiguration.smtpEnabled || !securityConfiguration.passwordRecoveryEnabled) {
      throw new BadRequestException("密码找回当前未启用。");
    }
    await this.turnstile.verify(dto.turnstileToken, context.ip, securityConfiguration.turnstileRecoveryEnabled);
    const request = await this.accountSecurity.consumePasswordResetToken(dto.token);
    await this.usersService.updateOwnPassword(request.userId, dto.newPassword, true);
    const revokedSessions = await this.refreshTokenService.revokeAllSessions(request.userId);
    await this.accountSecurity.recordPasswordEvent(request.userId, LoginSecurityEventType.password_reset, context);
    return { success: true, revokedSessions };
  }

  private async createAuthResponse(user: AuthenticatedUser, context: RefreshSessionContext): Promise<AuthResponse> {
    const refresh = await this.refreshTokenService.issue(user.id, context);
    return {
      user: this.toPublicUser(user),
      accessToken: await this.signAccessToken(user, refresh.tokenId),
      refreshToken: refresh.refreshToken,
    };
  }

  private async completeLogin(userId: number, context: RefreshSessionContext, deviceVerifiedByEmail: boolean): Promise<AuthResponse> {
    const user = await this.usersService.findActiveById(userId);
    await this.usersService.markLoginSuccess(user.id);
    if (deviceVerifiedByEmail) {
      await this.accountSecurity.recordVerifiedDeviceLogin(user, context);
    } else {
      await this.accountSecurity.recordLogin(user, context);
    }
    return this.createAuthResponse(user, context);
  }

  private async requestTotpLoginVerification(
    userId: number,
    context: RefreshSessionContext,
    deviceVerifiedByEmail: boolean,
  ): Promise<{
    totpVerificationRequired: true;
    challengeToken: string;
    expiresAt: string;
  }> {
    const challengeToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.totpLoginChallengeTtlSeconds * 1000);
    const challenge: TotpLoginChallenge = {
      userId,
      deviceFingerprint: this.loginDeviceFingerprint(context),
      deviceVerifiedByEmail,
      attempts: 0,
    };
    await this.redis.set(this.totpLoginChallengeKey(challengeToken), JSON.stringify(challenge), this.totpLoginChallengeTtlSeconds);
    return {
      totpVerificationRequired: true,
      challengeToken,
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async requireTotpLoginChallenge(challengeToken: string, context: RefreshSessionContext): Promise<TotpLoginChallenge> {
    const raw = await this.redis.get(this.totpLoginChallengeKey(challengeToken));
    if (!raw) throw new BadRequestException("双因素认证已失效，请重新登录。");
    let challenge: TotpLoginChallenge;
    try {
      challenge = JSON.parse(raw) as TotpLoginChallenge;
    } catch {
      await this.redis.del(this.totpLoginChallengeKey(challengeToken));
      throw new BadRequestException("双因素认证已失效，请重新登录。");
    }
    if (challenge.deviceFingerprint !== this.loginDeviceFingerprint(context)) {
      throw new BadRequestException("双因素认证信息不匹配，请重新登录。");
    }
    return challenge;
  }

  private async recordTotpLoginFailure(challengeToken: string, challenge: TotpLoginChallenge): Promise<void> {
    const attempts = challenge.attempts + 1;
    const key = this.totpLoginChallengeKey(challengeToken);
    if (attempts >= this.totpLoginAttemptLimit) {
      await this.redis.del(key);
      return;
    }
    await this.redis.set(key, JSON.stringify({ ...challenge, attempts }), this.totpLoginChallengeTtlSeconds);
  }

  private loginDeviceFingerprint(context: RefreshSessionContext): string {
    return createHash("sha256")
      .update(context.trustedDeviceToken?.trim() || context.deviceId?.trim() || context.userAgent)
      .digest("hex");
  }

  private totpLoginChallengeKey(challengeToken: string): string {
    return `login_totp_challenge:${createHash("sha256").update(challengeToken).digest("hex")}`;
  }

  private async signAccessToken(user: AuthenticatedUser, sessionId: string): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        username: user.username,
        sid: sessionId,
        av: user.authVersion ?? 0,
      },
      {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-access-token-secret",
        expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ?? "15m") as JwtSignOptions["expiresIn"],
      },
    );
  }

  private toPublicUser(user: AuthenticatedUser): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      status: user.status,
      isSuperAdmin: user.isSuperAdmin,
      isAdministrator: user.isAdministrator,
      avatarUrl: user.avatarUrl,
      profileBio: user.profileBio,
      locale: user.locale,
      createdAt: user.createdAt,
      appearance: user.appearance,
      role: user.role,
    };
  }

  private async assertNotLocked(failureKey: string): Promise<void> {
    const failures = Number((await this.redis.get(failureKey)) ?? "0");
    if (failures >= this.loginFailureLimit) {
      throw new ForbiddenException("Too many failed login attempts.");
    }
  }

  private async recordLoginFailure(failureKey: string, userId?: number, context?: RefreshSessionContext): Promise<never> {
    const failures = await this.redis.incr(failureKey);
    if (failures === 1) {
      await this.redis.expire(failureKey, this.loginFailureTtlSeconds);
    }

    if (failures >= this.loginFailureLimit) {
      if (userId && context) await this.accountSecurity.recordBlockedLogin(userId, context);
      throw new ForbiddenException("Too many failed login attempts.");
    }

    throw new UnauthorizedException("Invalid credentials.");
  }

  private loginFailureKey(account: string, ip: string): string {
    return `login_fail:${account.toLowerCase()}:${ip}`;
  }
}
