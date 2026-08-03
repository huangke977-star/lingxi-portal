import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type { RemoteProvider } from "../system-status.types";

export class RestoreBackupDto {
  @IsString()
  @MaxLength(220)
  confirmation!: string;
}

export class UpdateBackupConfigurationDto {
  @IsBoolean()
  automaticEnabled!: boolean;

  @IsString()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  scheduleTime!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  localRetentionDays!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  remoteRetentionDays!: number;

  @IsBoolean()
  ossEnabled!: boolean;

  @IsString()
  @MaxLength(80)
  ossRegion!: string;

  @IsString()
  @MaxLength(255)
  ossEndpoint!: string;

  @IsString()
  @MaxLength(128)
  ossBucket!: string;

  @IsString()
  @MaxLength(255)
  ossPrefix!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ossAccessKeyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ossAccessKeySecret?: string;

  @IsOptional()
  @IsBoolean()
  clearOssCredentials?: boolean;

  @IsBoolean()
  r2Enabled!: boolean;

  @IsString()
  @MaxLength(64)
  r2AccountId!: string;

  @IsString()
  @MaxLength(128)
  r2Bucket!: string;

  @IsString()
  @MaxLength(255)
  r2Prefix!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  r2AccessKeyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  r2SecretAccessKey?: string;

  @IsOptional()
  @IsBoolean()
  clearR2Credentials?: boolean;
}

export class TestBackupProviderDto {
  @IsIn(["oss", "r2"])
  provider!: RemoteProvider;
}
