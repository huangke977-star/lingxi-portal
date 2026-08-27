import { Type } from "class-transformer";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  MinLength,
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

export class AutosaveArticleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  summary?: string;

  @IsOptional()
  @IsString()
  content?: string;

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
  @IsString({ each: true })
  roleCodes?: string[];

}

export class ArticleScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  publishAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unpublishAt?: string | null;
}

export class ArticleTemplateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

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
  @IsString({ each: true })
  roleCodes?: string[];
}

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
  @IsString()
  @MaxLength(32)
  authorUsername?: string;

  @IsOptional()
  @IsIn(ARTICLE_STATUSES)
  status?: ArticleStatusValue;

  @IsOptional()
  @IsIn(["latest", "popular", "pinned", "recommended", "views", "likes", "favorites", "comments"])
  sort: "latest" | "popular" | "pinned" | "recommended" | "views" | "likes" | "favorites" | "comments" = "latest";
}

export class UpdateReadingProgressDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  progress!: number;
}

export class ListArticleCommentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cursor?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  pageSize = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  focusId?: number;
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

export class RedeemArticleResourceDto {
  @IsString()
  @MaxLength(80)
  blockKey!: string;
}

export class ReportArticleDto extends ReportArticleCommentDto {}

export class ModerateArticleReportDto {
  @IsIn(["resolved", "rejected"])
  status!: "resolved" | "rejected";

  @IsOptional()
  @IsIn(["blocked", "deleted"])
  articleStatus?: "blocked" | "deleted";

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  resolution?: string;
}

export class CreateArticleAppealDto {
  @IsString()
  @MinLength(2)
  @MaxLength(1000)
  reason!: string;
}

export class ModerateArticleAppealDto {
  @IsIn(["approved", "rejected"])
  status!: "approved" | "rejected";

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  resolution!: string;
}

export class UpdateArticlePublishRestrictionDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  permanent?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  endsAt?: string;
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
