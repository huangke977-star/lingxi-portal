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
import { LoginSecurityEventType } from "../generated/prisma/client";
import { AccountPrivacyService } from "../account-privacy/account-privacy.service";
import { PrismaService } from "../prisma/prisma.service";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture, AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { RenamePasskeyDto, VerifyPasskeyLoginDto, VerifyPasskeyRegistrationDto } from "./dto/passkey.dto";

interface TotpLoginChallenge {
  userId: number;
  deviceFingerprint: string;
  deviceVerifiedByEmail: boolean;
  attempts: number;
}

interface PasskeyChallenge {
  userId?: number;
  expectedChallenge: string;
  deviceFingerprint: string;
  attempts: number;
}

@Injectable()
export class AuthService {
  private readonly loginFailureTtlSeconds = 15 * 60;
  private readonly loginFailureLimit = 5;
  private readonly totpLoginChallengeTtlSeconds = 5 * 60;
  private readonly totpLoginAttemptLimit = 5;
  private readonly passkeyChallengeTtlSeconds = 5 * 60;
  private readonly passkeyAttemptLimit = 5;

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
  ): Promise<{
    options: PublicKeyCredentialCreationOptionsJSON;
    challengeToken: string;
    expiresAt: string;
  }> {
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

  async deletePasskey(user: AuthenticatedUser, id: number) {
    const deleted = await this.prismaService!.webAuthnCredential.deleteMany({
      where: { id, userId: user.id },
    });
    if (!deleted.count)
      throw new BadRequestException("通行密钥不存在。\nPasskey not found.");
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

  private async completePasskeyLogin(
    userId: number,
    context: RefreshSessionContext,
  ): Promise<LoginResponse> {
    const user = await this.usersService.findActiveById(userId);
    const securityConfiguration =
      await this.securityConfiguration.getConfiguration();
    if (
      securityConfiguration.smtpEnabled &&
      securityConfiguration.untrustedDeviceEmailVerificationEnabled &&
      !(await this.accountSecurity.isTrustedDevice(user.id, context))
    ) {
      return this.accountSecurity.requestDeviceLoginVerification(user, context);
    }
    if (
      (await this.accountPrivacy.verifyTotpForLogin(user.id)) === "required"
    ) {
      return this.requestTotpLoginVerification(user.id, context, false);
    }
    return this.completeLogin(user.id, context, false);
  }

  private async requirePasskeyChallenge(
    kind: "registration" | "login",
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
    kind: "registration" | "login",
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
    kind: "registration" | "login",
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
