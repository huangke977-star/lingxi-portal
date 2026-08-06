import { BadRequestException, Injectable } from "@nestjs/common";
import type { SecurityConfiguration } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UpdateSecurityConfigurationDto } from "./dto/security.dto";
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
    return {
      registrationEmailVerificationEnabled: config.registrationEmailVerificationEnabled,
      passwordRecoveryEnabled: config.passwordRecoveryEnabled,
      turnstile: {
        siteKey: config.turnstileSiteKey ?? "",
        registrationEnabled: config.turnstileRegistrationEnabled,
        loginEnabled: config.turnstileLoginEnabled,
        recoveryEnabled: config.turnstileRecoveryEnabled,
        loginFailureThreshold: config.loginFailureTurnstileThreshold,
      },
    };
  }

  async getAdminConfiguration() {
    return this.toAdminResponse(await this.getConfiguration());
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

    const next = {
      smtpEnabled: dto.smtpEnabled ?? current.smtpEnabled,
      smtpHost: this.optionalText(dto.smtpHost, current.smtpHost),
      smtpPort: dto.smtpPort ?? current.smtpPort,
      smtpSecure: dto.smtpSecure ?? current.smtpSecure,
      smtpUsername: this.optionalText(dto.smtpUsername, current.smtpUsername),
      smtpPasswordEncrypted,
      smtpFromName: dto.smtpFromName?.trim() || current.smtpFromName,
      smtpFromEmail: this.optionalText(dto.smtpFromEmail, current.smtpFromEmail),
      registrationEmailVerificationEnabled: dto.registrationEmailVerificationEnabled ?? current.registrationEmailVerificationEnabled,
      passwordRecoveryEnabled: dto.passwordRecoveryEnabled ?? current.passwordRecoveryEnabled,
      turnstileSiteKey: this.optionalText(dto.turnstileSiteKey, current.turnstileSiteKey),
      turnstileSecretEncrypted,
      turnstileRegistrationEnabled: dto.turnstileRegistrationEnabled ?? current.turnstileRegistrationEnabled,
      turnstileLoginEnabled: dto.turnstileLoginEnabled ?? current.turnstileLoginEnabled,
      turnstileRecoveryEnabled: dto.turnstileRecoveryEnabled ?? current.turnstileRecoveryEnabled,
      loginFailureTurnstileThreshold: dto.loginFailureTurnstileThreshold ?? current.loginFailureTurnstileThreshold,
    };
    this.validate(next);
    const saved = await this.prisma.securityConfiguration.update({ where: { id: 1 }, data: next });
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

  private validate(config: Pick<SecurityConfiguration,
    "smtpEnabled" | "smtpHost" | "smtpUsername" | "smtpPasswordEncrypted" | "smtpFromEmail" |
    "registrationEmailVerificationEnabled" | "passwordRecoveryEnabled" | "turnstileSiteKey" |
    "turnstileSecretEncrypted" | "turnstileRegistrationEnabled" | "turnstileLoginEnabled" | "turnstileRecoveryEnabled"
  >): void {
    const mailRequired = config.smtpEnabled || config.registrationEmailVerificationEnabled || config.passwordRecoveryEnabled;
    if (mailRequired && (!config.smtpEnabled || !config.smtpHost || !config.smtpUsername || !config.smtpPasswordEncrypted || !config.smtpFromEmail)) {
      throw new BadRequestException("启用邮件功能前请完整配置 SMTP 主机、账号、密码和发件地址。");
    }
    const turnstileRequired = config.turnstileRegistrationEnabled || config.turnstileLoginEnabled || config.turnstileRecoveryEnabled;
    if (turnstileRequired && (!config.turnstileSiteKey || !config.turnstileSecretEncrypted)) {
      throw new BadRequestException("启用 Turnstile 前请完整配置 Site Key 和 Secret Key。");
    }
  }

  private toAdminResponse(config: SecurityConfiguration) {
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
      turnstileSiteKey: config.turnstileSiteKey ?? "",
      turnstileSecretConfigured: Boolean(config.turnstileSecretEncrypted),
      turnstileRegistrationEnabled: config.turnstileRegistrationEnabled,
      turnstileLoginEnabled: config.turnstileLoginEnabled,
      turnstileRecoveryEnabled: config.turnstileRecoveryEnabled,
      loginFailureTurnstileThreshold: config.loginFailureTurnstileThreshold,
      encryptionConfigured: this.crypto.isConfigured(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }

  private optionalText(value: string | undefined, current: string | null): string | null {
    return value === undefined ? current : value.trim() || null;
  }
}
