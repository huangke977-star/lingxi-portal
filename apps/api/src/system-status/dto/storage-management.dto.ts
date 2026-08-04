import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";

const STORAGE_CATEGORIES = ["backgrounds", "site-assets", "android-releases", "avatars", "articles", "chat"] as const;
const STORAGE_ISSUE_KINDS = ["missing", "orphan", "metadata_mismatch"] as const;

export class StorageIssueQueryDto {
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
  @IsIn(STORAGE_ISSUE_KINDS)
  kind?: (typeof STORAGE_ISSUE_KINDS)[number];

  @IsOptional()
  @IsIn(STORAGE_CATEGORIES)
  category?: (typeof STORAGE_CATEGORIES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class StorageTrashQueryDto {
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
  @IsIn(STORAGE_CATEGORIES)
  category?: (typeof STORAGE_CATEGORIES)[number];
}

export class UpdateStorageManagementConfigurationDto {
  @IsBoolean()
  automaticScanEnabled!: boolean;

  @IsString()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  scanTime!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  trashRetentionDays!: number;

  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(95)
  warningThresholdPercent!: number;
}
