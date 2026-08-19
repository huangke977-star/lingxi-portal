import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class SearchQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  q!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  pageSize = 12;

  @IsOptional()
  @IsIn(["all", "articles", "users", "navigation", "tools", "topics", "collections", "groups", "announcements"])
  scope?: "all" | "articles" | "users" | "navigation" | "tools" | "topics" | "collections" | "groups" | "announcements" = "all";

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @IsIn(["relevance", "latest", "popular"])
  sort?: "relevance" | "latest" | "popular" = "relevance";
}

export class RecordSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  keyword!: string;
}

export class HotSearchQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
}
