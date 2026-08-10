import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class ListDiscoveryQueryDto {
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
}

export class ListSubscriptionFeedQueryDto extends ListDiscoveryQueryDto {
  @IsOptional()
  @IsIn(["latest", "unread", "popular"])
  sort: "latest" | "unread" | "popular" = "latest";
}

export class ListCollectionsQueryDto extends ListDiscoveryQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q = "";
}

export class CreateArticleCollectionDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsIn(["public", "authenticated", "private"])
  visibility?: "public" | "authenticated" | "private";
}

export class UpdateArticleCollectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsIn(["public", "authenticated", "private"])
  visibility?: "public" | "authenticated" | "private";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ReorderContentItemsDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids!: number[];
}

export class CreateArticleTopicDto {
  @IsString()
  @MaxLength(80)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  coverPath?: string;

  @IsOptional()
  @IsIn(["public", "authenticated", "role_restricted"])
  visibility?: "public" | "authenticated" | "role_restricted";

  @IsOptional()
  @IsIn(["active", "disabled"])
  status?: "active" | "disabled";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString({ each: true })
  roleCodes?: string[];
}

export class UpdateArticleTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  coverPath?: string;

  @IsOptional()
  @IsIn(["public", "authenticated", "role_restricted"])
  visibility?: "public" | "authenticated" | "role_restricted";

  @IsOptional()
  @IsIn(["active", "disabled"])
  status?: "active" | "disabled";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsString({ each: true })
  roleCodes?: string[];
}

export class UpdateAuthorSubscriptionDto {
  @IsBoolean()
  notifyNewArticles!: boolean;
}

export class UpdateProfileSettingsDto {
  @IsOptional()
  @IsBoolean()
  showBio?: boolean;

  @IsOptional()
  @IsBoolean()
  showJoinedAt?: boolean;

  @IsOptional()
  @IsBoolean()
  showStats?: boolean;

  @IsOptional()
  @IsBoolean()
  showFollowingCount?: boolean;

  @IsOptional()
  @IsBoolean()
  showPinnedContent?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pinnedArticleId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pinnedCollectionId?: number;
}
