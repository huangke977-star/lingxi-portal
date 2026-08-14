import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export const SUGGESTION_STATUSES = ["pending", "scheduled", "in_progress", "completed", "rejected"] as const;

export class ListSuggestionsQueryDto {
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
  pageSize = 8;
}

export class CreateSuggestionDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class ReviewSuggestionDto {
  @IsIn(SUGGESTION_STATUSES)
  status!: (typeof SUGGESTION_STATUSES)[number];
}

export class ReplySuggestionDto {
  @IsString()
  @MaxLength(2000)
  content!: string;
}
