import { Transform, Type } from "class-transformer";
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class RequestAccountDeletionDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword!: string;
}

export class TotpCodeDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(6)
  @MaxLength(12)
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
  @MaxLength(12)
  code?: string;
}
