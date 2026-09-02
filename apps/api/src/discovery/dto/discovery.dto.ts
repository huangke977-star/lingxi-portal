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

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class ListSubscriptionFeedQueryDto extends ListDiscoveryQueryDto {
  @IsOptional()
  @IsIn(["latest", "unread", "popular"])
  sort: "latest" | "unread" | "popular" = "latest";
}

export class CompleteOnboardingDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(3)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  topicIds: number[] = [];

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(6)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  authorIds: number[] = [];
}

export class ListRecommendationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  batch = 0;
}

export class RecommendationFeedbackDto {
  @IsIn(["article", "topic", "collection", "author", "group"])
  targetType!: "article" | "topic" | "collection" | "author" | "group";

  @Type(() => Number)
  @IsInt()
  @Min(1)
  targetId!: number;
}

export class ListResourceCatalogQueryDto extends ListDiscoveryQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q = "";

  @IsOptional()
  @IsIn(["latest", "popular", "price"])
  sort: "latest" | "popular" | "price" = "latest";
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
  @IsString()
  @MaxLength(512)
  coverPath?: string;

  @IsOptional()
  @IsIn(["public", "authenticated", "private"])
  visibility?: "public" | "authenticated" | "private";

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  articleIds?: number[];
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
  @IsString()
  @MaxLength(512)
  coverPath?: string;

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

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  articleIds?: number[];
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
  @IsOptional()
  @IsBoolean()
  notifyNewArticles?: boolean;

  @IsOptional()
  @IsIn(["instant", "daily", "muted"])
  frequency?: "instant" | "daily" | "muted";
}

export class SubscribeTagDto {
  @IsString()
  @MaxLength(80)
  tag!: string;
}

export class UpdateSubscriptionFrequencyDto {
  @IsIn(["instant", "daily", "muted"])
  frequency!: "instant" | "daily" | "muted";
}

export class UpdateProfileSettingsDto {
  @IsOptional()
  @IsIn(["public", "authenticated", "friends", "private"])
  profileAccess?: "public" | "authenticated" | "friends" | "private";

  @IsOptional()
  @IsBoolean()
  searchable?: boolean;

  @IsOptional()
  @IsIn(["everyone", "none"])
  friendRequestPolicy?: "everyone" | "none";

  @IsOptional()
  @IsIn(["everyone", "request", "friends", "none"])
  directMessagePolicy?: "everyone" | "request" | "friends" | "none";

  @IsOptional()
  @IsIn(["everyone", "friends", "none"])
  groupInvitationPolicy?: "everyone" | "friends" | "none";

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
