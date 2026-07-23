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

export const ARTICLE_STATUSES = [
  "draft",
  "published",
  "unpublished",
  "blocked",
  "deleted",
] as const;
export type ArticleStatusValue = (typeof ARTICLE_STATUSES)[number];

export const ARTICLE_VISIBILITIES = [
  "public",
  "authenticated",
  "role_restricted",
  "private",
] as const;
export type ArticleVisibilityValue = (typeof ARTICLE_VISIBILITIES)[number];

export const ARTICLE_COMMENT_STATUSES = ["active", "blocked", "deleted"] as const;
export type ArticleCommentStatusValue = (typeof ARTICLE_COMMENT_STATUSES)[number];

export class CreateArticleDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  summary?: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;

  @IsOptional()
  @IsString()
  @MaxLength(7)
  titleColor?: string;

  @IsOptional()
  @IsIn(ARTICLE_VISIBILITIES)
  visibility?: ArticleVisibilityValue;

  @IsOptional()
  @IsIn(ARTICLE_STATUSES)
  status?: ArticleStatusValue;

  @IsOptional()
  @IsString({ each: true })
  roleCodes?: string[];
}

export class UpdateArticleDto extends CreateArticleDto {}

export class ListArticlesQueryDto {
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
  pageSize = 10;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsIn(ARTICLE_STATUSES)
  status?: ArticleStatusValue;

  @IsOptional()
  @IsIn(["latest", "popular", "pinned"])
  sort: "latest" | "popular" | "pinned" = "latest";
}

export class CreateArticleCommentDto {
  @IsString()
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  parentId?: number;
}

export class ModerateArticleDto {
  @IsOptional()
  @IsIn(ARTICLE_STATUSES)
  status?: ArticleStatusValue;

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pinOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(7)
  titleColor?: string;

  @IsOptional()
  @IsIn(ARTICLE_VISIBILITIES)
  visibility?: ArticleVisibilityValue;

  @IsOptional()
  @IsString({ each: true })
  roleCodes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  blockedReason?: string;
}

export class ModerateArticleCommentDto {
  @IsIn(ARTICLE_COMMENT_STATUSES)
  status!: ArticleCommentStatusValue;
}

export const ARTICLE_COMMENT_REPORT_REASONS = [
  "spam",
  "harassment",
  "illegal",
  "privacy",
  "misinformation",
  "other",
] as const;

export class ReportArticleCommentDto {
  @IsIn(ARTICLE_COMMENT_REPORT_REASONS)
  reason!: (typeof ARTICLE_COMMENT_REPORT_REASONS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  detail?: string;
}

export class ModerateArticleCommentReportDto {
  @IsIn(["resolved", "rejected"])
  status!: "resolved" | "rejected";

  @IsOptional()
  @IsIn(ARTICLE_COMMENT_STATUSES)
  commentStatus?: ArticleCommentStatusValue;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolution?: string;
}
