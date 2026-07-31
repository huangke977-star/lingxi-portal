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

export const SITE_THEME_IDS = ["sakura-mist", "cloud-blue", "night-purple", "custom"] as const;
export const ARTICLE_TAXONOMY_KINDS = ["category", "tag"] as const;
export const SITE_ARTICLE_VISIBILITIES = ["public", "authenticated", "role_restricted", "private"] as const;

export class UpdateSiteSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  siteName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  browserTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  logoPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  pwaIconPath?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  defaultBackgroundUrl?: string;

  @IsOptional()
  @IsIn(SITE_THEME_IDS)
  defaultThemeId?: (typeof SITE_THEME_IDS)[number];

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  defaultAccent?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  defaultSurface?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  defaultForeground?: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  defaultMuted?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(38)
  @Max(76)
  defaultCardAlpha?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(36)
  defaultGlassBlur?: number;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  defaultGlassTint?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  defaultGlassTintAlpha?: number;

  @IsOptional()
  @IsBoolean()
  registrationOpen?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  defaultRoleCode?: string;

  @IsOptional()
  @IsBoolean()
  installPageEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  apkHistoryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  apkAutoCleanupEnabled?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  apkRetentionCount?: number;

  @IsOptional()
  @IsIn(SITE_ARTICLE_VISIBILITIES)
  defaultArticleVisibility?: (typeof SITE_ARTICLE_VISIBILITIES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  articleImageMaxSizeMb?: number;

  @IsOptional()
  @IsBoolean()
  commentsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  reportsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyArticleLiked?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyArticleFavorited?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyArticleCommented?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyCommentReplied?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyAuthorSubscribed?: boolean;

  @IsOptional()
  @IsBoolean()
  notifySubscriptionPublished?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyFriendRequest?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyCommentReport?: boolean;

  @IsOptional()
  @IsBoolean()
  notifySystem?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  templateArticleLiked?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  templateArticleFavorited?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  templateArticleCommented?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  templateCommentReplied?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  templateAuthorSubscribed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  templateSubscriptionPublished?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  templateFriendRequest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  templateCommentReportHandled?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  templateCommentAuthorModerated?: string;
}

export class UpsertArticleTaxonomyDto {
  @IsIn(ARTICLE_TAXONOMY_KINDS)
  kind!: (typeof ARTICLE_TAXONOMY_KINDS)[number];

  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/)
  color?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
