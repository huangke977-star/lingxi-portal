import { Transform, Type } from "class-transformer";
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class UpdateSecurityConfigurationDto {
  @IsOptional() @IsBoolean() smtpEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(255) smtpHost?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) smtpPort?: number;
  @IsOptional() @IsBoolean() smtpSecure?: boolean;
  @IsOptional() @IsString() @MaxLength(255) smtpUsername?: string;
  @IsOptional() @IsString() @MaxLength(500) smtpPassword?: string;
  @IsOptional() @IsBoolean() clearSmtpPassword?: boolean;
  @IsOptional() @IsString() @MaxLength(120) smtpFromName?: string;
  @IsOptional() @IsEmail() @MaxLength(191) smtpFromEmail?: string;
  @IsOptional() @IsBoolean() registrationEmailVerificationEnabled?: boolean;
  @IsOptional() @IsBoolean() passwordRecoveryEnabled?: boolean;
  @IsOptional() @IsString() @MaxLength(255) turnstileSiteKey?: string;
  @IsOptional() @IsString() @MaxLength(500) turnstileSecret?: string;
  @IsOptional() @IsBoolean() clearTurnstileSecret?: boolean;
  @IsOptional() @IsBoolean() turnstileRegistrationEnabled?: boolean;
  @IsOptional() @IsBoolean() turnstileLoginEnabled?: boolean;
  @IsOptional() @IsBoolean() turnstileRecoveryEnabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) loginFailureTurnstileThreshold?: number;
}

export class RegistrationCodeDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(191)
  email!: string;

  @IsOptional() @IsString() @MaxLength(2048) turnstileToken?: string;
}

export class PasswordRecoveryRequestDto extends RegistrationCodeDto {}

export class PasswordRecoveryResetDto {
  @IsString() @MinLength(20) @MaxLength(512) token!: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
  @IsOptional() @IsString() @MaxLength(2048) turnstileToken?: string;
}

export class ConfirmEmailVerificationDto {
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsString() @MinLength(6) @MaxLength(6) code!: string;
}

export class UpdateSecurityPreferencesDto {
  @IsBoolean() loginAlertsEnabled!: boolean;
  @IsBoolean() emailAlertsEnabled!: boolean;
  @IsBoolean() newDeviceAlertsEnabled!: boolean;
}

export class SecurityAdminQueryDto {
  @IsOptional() @IsIn(["mail", "verification", "risk"]) tab: "mail" | "verification" | "risk" = "mail";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 10;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
}
