import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type { RemoteProvider } from "../system-status.types";

const MEDIA_BACKUP_JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "partial",
  "failed",
] as const;
const MEDIA_BACKUP_PROVIDERS = ["oss", "r2"] as const;
const MEDIA_CATEGORIES = [
  "backgrounds",
  "site-assets",
  "android-releases",
  "avatars",
  "articles",
  "chat",
] as const;

export class MediaBackupJobQueryDto {
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

  @IsOptional()
  @IsIn(MEDIA_BACKUP_JOB_STATUSES)
  status?: (typeof MEDIA_BACKUP_JOB_STATUSES)[number];
}

export class MediaBackupFileQueryDto {
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

  @IsOptional()
  @IsIn(MEDIA_CATEGORIES)
  category?: (typeof MEDIA_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class RestoreMediaBackupFileDto {
  @IsString()
  @MaxLength(512)
  confirmation!: string;

  @IsOptional()
  @IsIn(MEDIA_BACKUP_PROVIDERS)
  provider?: RemoteProvider;
}

export class RestoreMissingStorageIssueDto {
  @IsOptional()
  @IsIn(MEDIA_BACKUP_PROVIDERS)
  provider?: RemoteProvider;
}

export class ConfirmStorageIssueUnrecoverableDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
