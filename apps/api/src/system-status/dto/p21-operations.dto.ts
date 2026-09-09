import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class StartRecoveryDrillDto {
  @IsIn(["local", "oss", "r2"])
  provider!: "local" | "oss" | "r2";
}

export class UpdateAuditRetentionPolicyDto {
  @IsBoolean()
  cleanupEnabled!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(3650)
  businessDays!: number;

  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(3650)
  securityDays!: number;

  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(3650)
  serverDays!: number;
}

export class OperationalRunQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(48)
  kind?: string;

  @IsOptional()
  @IsIn(["running", "passed", "failed", "blocked"])
  status?: "running" | "passed" | "failed" | "blocked";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class OperationalAlertQueryDto {
  @IsOptional()
  @IsIn(["open", "acknowledged", "resolved"])
  status?: "open" | "acknowledged" | "resolved";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
