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
  @IsIn(["all", "articles", "users", "navigation", "tools"])
  scope?: "all" | "articles" | "users" | "navigation" | "tools" = "all";

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;
}
