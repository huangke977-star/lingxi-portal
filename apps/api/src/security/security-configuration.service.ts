import { BadRequestException, Injectable } from "@nestjs/common";
import type { SecurityConfiguration } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateGoogleOAuthConfigurationDto, UpdateSecurityConfigurationDto } from "./dto/security.dto";
import { SecretCryptoService } from "./secret-crypto.service";

@Injectable()
export class SecurityConfigurationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretCryptoService,
  ) {}

  async getConfiguration(): Promise<SecurityConfiguration> {
    return this.prisma.securityConfiguration.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
  }

  async getPublicPolicy() {
    const config = await this.getConfiguration();
    const mailServiceEnabled = config.smtpEnabled;
    return {
      mailServiceEnabled,
      registrationEmailVerificationEnabled: mailServiceEnabled && config.registrationEmailVerificationEnabled,
      passwordRecoveryEnabled: mailServiceEnabled && config.passwordRecoveryEnabled,
      untrustedDeviceEmailVerificationEnabled: mailServiceEnabled && config.untrustedDeviceEmailVerificationEnabled,
      turnstile: {
        siteKey: config.turnstileSiteKey ?? "",
        registrationEnabled: config.turnstileRegistrationEnabled,
        loginEnabled: config.turnstileLoginEnabled,
        recoveryEnabled: mailServiceEnabled && config.passwordRecoveryEnabled && config.turnstileRecoveryEnabled,
        loginFailureThreshold: config.loginFailureTurnstileThreshold,
      },
    };
  }

  async getAdminConfiguration() {
    return this.toAdminResponse(await this.getConfiguration());
  }

  async getGoogleOAuthConfig(): Promise<{
    enabled: boolean;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    source: "database" | "environment";
  }> {
    const config = await this.getConfiguration();
    const managed = config.googleOauthManaged;
    const clientId = managed
      ? config.googleOauthClientId?.trim() ?? ""
      : process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
    const clientSecret = managed
      ? config.googleOauthClientSecretEncrypted
        ? this.crypto.decrypt(config.googleOauthClientSecretEncrypted)
        : ""
      : process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
    const redirectUri = managed
      ? config.googleOauthRedirectUri?.trim() ?? ""
      : process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || this.defaultGoogleRedirectUri();
    return {
      enabled: managed
        ? config.googleOauthEnabled && Boolean(clientId && clientSecret && redirectUri)
        : Boolean(clientId && clientSecret && redirectUri),
      clientId,
      clientSecret,
      redirectUri: redirectUri || this.defaultGoogleRedirectUri(),
      source: managed ? "database" : "environment",
    };
  }

  async getAdminGoogleOAuthConfiguration() {
    const config = await this.getConfiguration();
    const google = await this.getGoogleOAuthConfig();
    return {
      managed: config.googleOauthManaged,
      enabled: google.enabled,
      clientId: google.clientId,
      clientSecretConfigured: Boolean(google.clientSecret),
      redirectUri: google.redirectUri,
      source: google.source,
      encryptionConfigured: this.crypto.isConfigured(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }

  async updateGoogleOAuth(dto: UpdateGoogleOAuthConfigurationDto) {
    const current = await this.getConfiguration();
    const clientId = dto.clientId.trim();
    const redirectUri = dto.redirectUri.trim();
    let clientSecretEncrypted = current.googleOauthClientSecretEncrypted;
    if (dto.clientSecret?.trim()) {
      clientSecretEncrypted = this.crypto.encrypt(dto.clientSecret.trim());
    } else if (!current.googleOauthManaged && process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() && this.crypto.isConfigured()) {
      clientSecretEncrypted = this.crypto.encrypt(process.env.GOOGLE_OAUTH_CLIENT_SECRET.trim());
    }
    const next = {
      googleOauthManaged: true,
      googleOauthEnabled: dto.enabled,
      googleOauthClientId: clientId || null,
      googleOauthClientSecretEncrypted: clientSecretEncrypted,
      googleOauthRedirectUri: redirectUri || null,
    };
    this.validateGoogle(next);
    const saved = await this.prisma.securityConfiguration.update({
      where: { id: 1 },
      data: next,
    });
    return this.getAdminGoogleOAuthConfigurationFrom(saved);
  }

  async update(dto: UpdateSecurityConfigurationDto) {
    const current = await this.getConfiguration();
    const smtpPasswordEncrypted = dto.clearSmtpPassword
      ? null
      : dto.smtpPassword?.trim()
        ? this.crypto.encrypt(dto.smtpPassword)
        : current.smtpPasswordEncrypted;
    const turnstileSecretEncrypted = dto.clearTurnstileSecret
      ? null
      : dto.turnstileSecret?.trim()
        ? this.crypto.encrypt(dto.turnstileSecret)
        : current.turnstileSecretEncrypted;

    const smtpEnabled = dto.smtpEnabled ?? current.smtpEnabled;
    const next = {
      smtpEnabled,
      smtpHost: this.optionalText(dto.smtpHost, current.smtpHost),
      smtpPort: dto.smtpPort ?? current.smtpPort,
      smtpSecure: dto.smtpSecure ?? current.smtpSecure,
      smtpUsername: this.optionalText(dto.smtpUsername, current.smtpUsername),
      smtpPasswordEncrypted,
      smtpFromName: dto.smtpFromName?.trim() || current.smtpFromName,
      smtpFromEmail: this.optionalText(dto.smtpFromEmail, current.smtpFromEmail),
      registrationEmailVerificationEnabled: smtpEnabled
        ? (dto.registrationEmailVerificationEnabled ?? current.registrationEmailVerificationEnabled)
        : false,
      passwordRecoveryEnabled: smtpEnabled ? (dto.passwordRecoveryEnabled ?? current.passwordRecoveryEnabled) : false,
      untrustedDeviceEmailVerificationEnabled: smtpEnabled
        ? (dto.untrustedDeviceEmailVerificationEnabled ?? current.untrustedDeviceEmailVerificationEnabled)
        : false,
      turnstileSiteKey: this.optionalText(dto.turnstileSiteKey, current.turnstileSiteKey),
      turnstileSecretEncrypted,
      turnstileRegistrationEnabled: dto.turnstileRegistrationEnabled ?? current.turnstileRegistrationEnabled,
      turnstileLoginEnabled: dto.turnstileLoginEnabled ?? current.turnstileLoginEnabled,
      turnstileRecoveryEnabled: smtpEnabled ? (dto.turnstileRecoveryEnabled ?? current.turnstileRecoveryEnabled) : false,
      loginFailureTurnstileThreshold: dto.loginFailureTurnstileThreshold ?? current.loginFailureTurnstileThreshold,
      googleOauthManaged: dto.googleOauthManaged ?? current.googleOauthManaged,
      googleOauthEnabled: dto.googleOauthEnabled ?? current.googleOauthEnabled,
      googleOauthClientId: this.optionalText(
        dto.googleOauthClientId,
        current.googleOauthManaged ? current.googleOauthClientId : process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || current.googleOauthClientId,
      ),
      googleOauthClientSecretEncrypted: dto.googleOauthClientSecret?.trim()
        ? this.crypto.encrypt(dto.googleOauthClientSecret.trim())
        : current.googleOauthClientSecretEncrypted,
      googleOauthRedirectUri: this.optionalText(
        dto.googleOauthRedirectUri,
        current.googleOauthManaged ? current.googleOauthRedirectUri : process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() || current.googleOauthRedirectUri,
      ),
    };
    this.validate(next);
    const saved = await this.prisma.securityConfiguration.update({
      where: { id: 1 },
      data: next,
    });
    return this.toAdminResponse(saved);
  }

  decryptSmtpPassword(config: SecurityConfiguration): string {
    if (!config.smtpPasswordEncrypted) return "";
    return this.crypto.decrypt(config.smtpPasswordEncrypted);
  }

  decryptTurnstileSecret(config: SecurityConfiguration): string {
    if (!config.turnstileSecretEncrypted) return "";
    return this.crypto.decrypt(config.turnstileSecretEncrypted);
  }

  private validate(
    config: Pick<
      SecurityConfiguration,
      | "smtpEnabled"
      | "smtpHost"
      | "smtpUsername"
      | "smtpPasswordEncrypted"
      | "smtpFromEmail"
      | "registrationEmailVerificationEnabled"
      | "passwordRecoveryEnabled"
      | "untrustedDeviceEmailVerificationEnabled"
      | "turnstileSiteKey"
      | "turnstileSecretEncrypted"
      | "turnstileRegistrationEnabled"
      | "turnstileLoginEnabled"
      | "turnstileRecoveryEnabled"
      | "googleOauthManaged"
      | "googleOauthEnabled"
      | "googleOauthClientId"
      | "googleOauthClientSecretEncrypted"
      | "googleOauthRedirectUri"
    >,
  ): void {
    const mailRequired =
      config.smtpEnabled || config.registrationEmailVerificationEnabled || config.passwordRecoveryEnabled || config.untrustedDeviceEmailVerificationEnabled;
    if (mailRequired && (!config.smtpEnabled || !config.smtpHost || !config.smtpUsername || !config.smtpPasswordEncrypted || !config.smtpFromEmail)) {
      throw new BadRequestException("启用邮件功能前请完整配置 SMTP 主机、账号、密码和发件地址。");
    }
    const turnstileRequired = config.turnstileRegistrationEnabled || config.turnstileLoginEnabled || config.turnstileRecoveryEnabled;
    if (turnstileRequired && (!config.turnstileSiteKey || !config.turnstileSecretEncrypted)) {
      throw new BadRequestException("启用 Turnstile 前请完整配置 Site Key 和 Secret Key。");
    }
    this.validateGoogle(config);
  }

  private validateGoogle(config: Pick<SecurityConfiguration, "googleOauthManaged" | "googleOauthEnabled" | "googleOauthClientId" | "googleOauthClientSecretEncrypted" | "googleOauthRedirectUri">): void {
    if (!config.googleOauthManaged || !config.googleOauthEnabled) return;
    if (!config.googleOauthClientId || !config.googleOauthClientSecretEncrypted || !config.googleOauthRedirectUri) {
      throw new BadRequestException("启用 Google 登录前请完整配置 Client ID、Client Secret 和回调地址。\nConfigure the Google client ID, client secret, and redirect URI before enabling Google sign-in.");
    }
    try {
      const redirect = new URL(config.googleOauthRedirectUri);
      if (!redirect.hostname || !["http:", "https:"].includes(redirect.protocol) || (redirect.protocol === "http:" && redirect.hostname !== "localhost")) throw new Error("invalid");
    } catch {
      throw new BadRequestException("Google 回调地址必须是有效的 HTTPS 地址（本地开发可使用 localhost）。\nThe Google redirect URI must be a valid HTTPS URL (localhost is allowed for development).");
    }
  }

  private async toAdminResponse(config: SecurityConfiguration) {
    const google = await this.getGoogleOAuthConfig();
    return {
      smtpEnabled: config.smtpEnabled,
      smtpHost: config.smtpHost ?? "",
      smtpPort: config.smtpPort,
      smtpSecure: config.smtpSecure,
      smtpUsername: config.smtpUsername ?? "",
      smtpPasswordConfigured: Boolean(config.smtpPasswordEncrypted),
      smtpFromName: config.smtpFromName,
      smtpFromEmail: config.smtpFromEmail ?? "",
      registrationEmailVerificationEnabled: config.registrationEmailVerificationEnabled,
      passwordRecoveryEnabled: config.passwordRecoveryEnabled,
      untrustedDeviceEmailVerificationEnabled: config.untrustedDeviceEmailVerificationEnabled,
      turnstileSiteKey: config.turnstileSiteKey ?? "",
      turnstileSecretConfigured: Boolean(config.turnstileSecretEncrypted),
      turnstileRegistrationEnabled: config.turnstileRegistrationEnabled,
      turnstileLoginEnabled: config.turnstileLoginEnabled,
      turnstileRecoveryEnabled: config.turnstileRecoveryEnabled,
      loginFailureTurnstileThreshold: config.loginFailureTurnstileThreshold,
      googleOauthManaged: config.googleOauthManaged,
      googleOauthEnabled: google.enabled,
      googleOauthClientId: google.clientId,
      googleOauthClientSecretConfigured: Boolean(google.clientSecret),
      googleOauthRedirectUri: google.redirectUri,
      googleOauthSource: google.source,
      encryptionConfigured: this.crypto.isConfigured(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }

  private getAdminGoogleOAuthConfigurationFrom(config: SecurityConfiguration) {
    const managed = config.googleOauthManaged;
    return {
      managed,
      enabled: managed && config.googleOauthEnabled && Boolean(config.googleOauthClientId && config.googleOauthClientSecretEncrypted && config.googleOauthRedirectUri),
      clientId: config.googleOauthClientId ?? "",
      clientSecretConfigured: Boolean(config.googleOauthClientSecretEncrypted),
      redirectUri: config.googleOauthRedirectUri ?? this.defaultGoogleRedirectUri(),
      source: managed ? "database" as const : "environment" as const,
      encryptionConfigured: this.crypto.isConfigured(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }

  private optionalText(value: string | undefined, current: string | null): string | null {
    return value === undefined ? current : value.trim() || null;
  }

  private defaultGoogleRedirectUri(): string {
    return `${(process.env.WEB_ORIGIN || "http://localhost:3000").replace(/\/$/, "")}/api/auth/google/callback`;
  }
}
