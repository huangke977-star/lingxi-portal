import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";

export class RequestAccountDeletionDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  verificationToken!: string;
}

export class SensitiveActionPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;
}

export class SensitiveActionCodeDto {
  @IsString()
  @Matches(/^[A-Za-z0-9]{6}$/)
  code!: string;
}

export class SensitiveActionEmailVerifyDto extends SensitiveActionCodeDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  challengeToken!: string;
}

export class SensitiveActionTokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(512)
  verificationToken!: string;
}

export class TotpDisablePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;
}

export class TotpCodeDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  @Matches(/^[A-Za-z0-9]{6}$/)
  code!: string;
}

export class ListDeletedUsersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class PrivacyAuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}

export class TotpLoginDto {
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  @Matches(/^[A-Za-z0-9]{6}$/)
  code?: string;
}
