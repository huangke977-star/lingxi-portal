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

export const ANNOUNCEMENT_AUDIENCES = ["public", "authenticated", "role_restricted"] as const;
export const ANNOUNCEMENT_MUTABLE_STATUSES = ["draft", "scheduled", "published", "archived"] as const;

export class CreateAnnouncementDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  summary?: string;

  @IsString()
  @MaxLength(20_000)
  content!: string;

  @IsOptional()
  @IsIn(ANNOUNCEMENT_AUDIENCES)
  audience?: (typeof ANNOUNCEMENT_AUDIENCES)[number];

  @IsOptional()
  @IsIn(ANNOUNCEMENT_MUTABLE_STATUSES)
  status?: (typeof ANNOUNCEMENT_MUTABLE_STATUSES)[number];

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  pinOrder?: number;

  @IsOptional()
  @IsBoolean()
  pushEnabled?: boolean;

  @IsOptional()
  @IsString()
  scheduledAt?: string | null;

  @IsOptional()
  @IsString()
  expiresAt?: string | null;

  @IsOptional()
  @IsString({ each: true })
  roleCodes?: string[];
}
export class UpdateAnnouncementDto extends CreateAnnouncementDto {}

export class ListAnnouncementsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 12;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(["draft", "scheduled", "published", "expired", "archived"])
  status?: "draft" | "scheduled" | "published" | "expired" | "archived";
}
